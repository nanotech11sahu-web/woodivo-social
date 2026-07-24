import { Injectable, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PinoLogger } from 'nestjs-pino';
import { PublishJob, PostSourceType } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PublishJobRepository } from '../queue/publish-job.repository';
import { AiGenerationProducer } from '../queue/producers/ai-generation.producer';

const CRON_JOB_NAME = 'woodivo-social-publisher-pending-scan';
const SOURCE_TYPES: readonly PostSourceType[] = [
  PostSourceType.PRODUCT,
  PostSourceType.BLOG,
  PostSourceType.CUSTOM,
  PostSourceType.OTHER,
];

/**
 * Picks up PENDING jobs from MongoDB on a configurable cron schedule. Each
 * tick picks at most ONE job per content type (PRODUCT, BLOG, CUSTOM, OTHER) -
 * so a large batch of bulk-submitted products can never starve blog posts (or
 * vice versa) out of a run; each type gets its own turn. Every job is
 * processed independently and wrapped in its own try/catch, so one bad post
 * can never stop the rest of the tick or future ticks.
 *
 * Nothing here touches local disk: media already lives in Cloudinary (see
 * IngestController) and job state lives in MongoDB, so a container restart
 * between submission and pickup loses nothing.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private isTickRunning = false;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly jobRepository: PublishJobRepository,
    private readonly aiGenerationProducer: AiGenerationProducer,
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
      'Scheduler started',
    );
  }

  private async tick(): Promise<void> {
    await this.runTick();
  }

  /**
   * Processes pending jobs immediately instead of waiting for the next cron
   * slot - used by POST /posts/trigger-now for "Post Now" submissions.
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
      await this.processPendingJobs();
    } catch (error) {
      this.logger.error(
        { error: (error as Error).message },
        'Unhandled error during scheduler tick',
      );
    } finally {
      this.isTickRunning = false;
    }
  }

  private async processPendingJobs(): Promise<void> {
    const pending = await this.jobRepository.findPending();
    if (pending.length === 0) {
      return;
    }

    const picks = this.pickOnePerSourceType(pending);

    for (const job of picks) {
      try {
        await this.processOneJob(job);
      } catch (error) {
        // Isolates one job's unexpected failure from the other picks in this
        // same tick - each pick is otherwise fully independent.
        this.logger.error(
          { jobId: job.id, error: (error as Error).message },
          'Unexpected error while processing a pending job',
        );
      }
    }
  }

  /**
   * `pending` is already ordered urgent-first then oldest-first (see
   * PublishJobRepository.findPending), so the first job seen for a given
   * source type is automatically the urgent one if any exist, otherwise the
   * oldest non-urgent one.
   */
  private pickOnePerSourceType(pending: PublishJob[]): PublishJob[] {
    const buckets = new Map<PostSourceType, PublishJob>();
    for (const job of pending) {
      if (!buckets.has(job.sourceType)) {
        buckets.set(job.sourceType, job);
      }
    }
    return SOURCE_TYPES.map((type) => buckets.get(type)).filter((job): job is PublishJob =>
      Boolean(job),
    );
  }

  private async processOneJob(job: PublishJob): Promise<void> {
    await this.jobRepository.markProcessing(job.id);

    await this.aiGenerationProducer.enqueue({ jobId: job.id, reference: job.reference });

    this.logger.info(
      { jobId: job.id, reference: job.reference, sourceType: job.sourceType },
      'Post accepted and queued for AI generation',
    );
  }
}
