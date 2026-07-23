import { Injectable, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import * as path from 'path';
import { PinoLogger } from 'nestjs-pino';
import { PublishStage } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { MailService } from '../mail/mail.service';
import { PostValidationException } from '../shared/exceptions/app.exceptions';
import { SEO_FILENAME } from '../shared/constants/queue.constants';
import { FilesystemUtil } from '../shared/utils/filesystem.util';
import { PostMetaUtil } from '../shared/utils/post-meta.util';
import { PostMeta, PostSourceType } from '../shared/interfaces/post-meta.interface';
import { PublishJobRepository } from '../queue/publish-job.repository';
import { AiGenerationProducer } from '../queue/producers/ai-generation.producer';
import { ArchivingProducer } from '../queue/producers/archiving.producer';
import { PostValidatorService } from './post-validator.service';

const CRON_JOB_NAME = 'woodivo-social-publisher-pending-scan';
const SOURCE_TYPES: readonly PostSourceType[] = ['PRODUCT', 'BLOG', 'OTHER'];

/**
 * Watches social-posts/pending/ on a configurable cron schedule. Each tick
 * picks at most ONE folder per content type (PRODUCT, BLOG, OTHER) - so a
 * large batch of bulk-submitted products can never starve blog posts (or
 * vice versa) out of a run; each type gets its own turn. Every folder is
 * still processed fully independently and wrapped in its own try/catch, so
 * one bad post can never stop the rest of the tick or future ticks.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private isTickRunning = false;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly postValidator: PostValidatorService,
    private readonly jobRepository: PublishJobRepository,
    private readonly aiGenerationProducer: AiGenerationProducer,
    private readonly archivingProducer: ArchivingProducer,
    private readonly mailService: MailService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SchedulerService.name);
  }

  onModuleInit(): void {
    if (!this.appConfig.scheduler.enabled) {
      this.logger.warn('Scheduler is disabled via SCHEDULER_ENABLED=false');
      return;
    }

    const job = new CronJob(
      this.appConfig.scheduler.cronExpression,
      () => {
        void this.tick();
      },
      null,
      false,
      this.appConfig.scheduler.timezone,
    );
    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
    job.start();

    this.logger.info(
      {
        cronExpression: this.appConfig.scheduler.cronExpression,
        timezone: this.appConfig.scheduler.timezone,
      },
      'Scheduler started watching pending/ folder',
    );
  }

  private async tick(): Promise<void> {
    await this.runTick();
  }

  /**
   * Processes pending folders immediately instead of waiting for the next
   * cron slot - used by POST /posts/trigger-now for "Post Now" submissions.
   * Returns triggered: false if a tick (cron or manual) was already running,
   * so the caller knows nothing new happened rather than assuming success.
   */
  async triggerNow(): Promise<{ triggered: boolean }> {
    if (this.isTickRunning) {
      return { triggered: false };
    }
    await this.runTick();
    return { triggered: true };
  }

  private async runTick(): Promise<void> {
    if (this.isTickRunning) {
      return;
    }
    this.isTickRunning = true;

    try {
      await this.processPendingFolders();
    } catch (error) {
      this.logger.error(
        { error: (error as Error).message },
        'Unhandled error during scheduler tick',
      );
    } finally {
      this.isTickRunning = false;
    }
  }

  private async processPendingFolders(): Promise<void> {
    const { pendingDir, processingDir } = this.appConfig.socialPosts;

    await FilesystemUtil.ensureDir(pendingDir);
    await FilesystemUtil.ensureDir(processingDir);

    const folderNames = (await FilesystemUtil.listSubdirectories(pendingDir)).sort();
    if (folderNames.length === 0) {
      return;
    }

    const picks = await this.pickOnePerSourceType(pendingDir, folderNames);

    for (const pick of picks) {
      try {
        await this.processOneFolder(pick.folderName, pick.meta);
      } catch (error) {
        // Isolates one folder's unexpected failure from the other picks in
        // this same tick - each pick is otherwise fully independent.
        this.logger.error(
          { folderName: pick.folderName, error: (error as Error).message },
          'Unexpected error while processing a pending folder',
        );
      }
    }
  }

  /**
   * Reads each pending folder's .social-meta.json and returns one folder per
   * source type: an urgent-flagged folder (see IngestController's `urgent`
   * field) wins over a non-urgent one regardless of alphabetical order;
   * otherwise the alphabetically-first folder of that type is picked.
   */
  private async pickOnePerSourceType(
    pendingDir: string,
    folderNames: string[],
  ): Promise<Array<{ folderName: string; meta: PostMeta }>> {
    const buckets = new Map<PostSourceType, { folderName: string; meta: PostMeta }>();

    for (const folderName of folderNames) {
      const meta = await PostMetaUtil.read(path.join(pendingDir, folderName));
      const current = buckets.get(meta.sourceType);
      if (!current) {
        buckets.set(meta.sourceType, { folderName, meta });
      } else if (meta.urgent && !current.meta.urgent) {
        buckets.set(meta.sourceType, { folderName, meta });
      }
    }

    return SOURCE_TYPES.map((type) => buckets.get(type)).filter(
      (pick): pick is { folderName: string; meta: PostMeta } => Boolean(pick),
    );
  }

  private async processOneFolder(folderName: string, meta: PostMeta): Promise<void> {
    const { pendingDir, processingDir } = this.appConfig.socialPosts;
    const sourcePath = path.join(pendingDir, folderName);
    const destinationPath = path.join(processingDir, folderName);

    try {
      await FilesystemUtil.moveDirectory(sourcePath, destinationPath);
    } catch (error) {
      this.logger.error(
        { folderName, error: (error as Error).message },
        'Failed to move pending folder into processing/ - will retry next tick',
      );
      return;
    }

    try {
      await this.postValidator.validate(destinationPath);
    } catch (error) {
      await this.handleValidationFailure(folderName, destinationPath, meta, error as Error);
      return;
    }

    const seoRawText = await FilesystemUtil.readTextFile(path.join(destinationPath, SEO_FILENAME));
    const job = await this.jobRepository.createProcessing(
      folderName,
      destinationPath,
      seoRawText,
      meta,
    );

    await this.aiGenerationProducer.enqueue({
      jobId: job.id,
      folderName,
      folderPath: destinationPath,
    });

    this.logger.info(
      { jobId: job.id, folderName, sourceType: meta.sourceType },
      'Post accepted and queued for AI generation',
    );
  }

  private async handleValidationFailure(
    folderName: string,
    folderPath: string,
    meta: PostMeta,
    error: Error,
  ): Promise<void> {
    const reason =
      error instanceof PostValidationException
        ? error.message
        : `Unexpected validation error: ${error.message}`;

    this.logger.error({ folderName, reason }, 'Post failed validation');

    const seoPath = path.join(folderPath, SEO_FILENAME);
    const seoRawText = (await FilesystemUtil.pathExists(seoPath))
      ? await FilesystemUtil.readTextFile(seoPath)
      : '';

    const job = await this.jobRepository.createProcessing(folderName, folderPath, seoRawText, meta);
    await this.jobRepository.markFailed(job.id, PublishStage.VALIDATION, reason);

    await this.mailService.sendFailureNotification({
      jobId: job.id,
      folderName,
      stage: 'VALIDATION',
      reason,
      attempts: 1,
      occurredAt: new Date(),
    });

    await this.archivingProducer.enqueueFailure({
      jobId: job.id,
      folderName,
      folderPath,
    });
  }
}
