import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../mail/mail.service';
import { QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { RetryJobPayload } from '../../shared/interfaces/job-payloads.interface';
import { PublishJobRepository } from '../publish-job.repository';
import { PipelineFailureRecorder } from '../pipeline-failure-recorder.service';
import { ArchivingProducer } from '../producers/archiving.producer';

/**
 * Central bookkeeping point for every stage failure across the pipeline.
 * Records a RetryHistory row and, once the stage has exhausted its configured
 * retry budget, marks the job FAILED, sends a failure email, and routes it to
 * the archiving queue. A failure processed here NEVER throws back into the
 * scheduler - each post is isolated from every other.
 */
@Processor(QUEUE_NAMES.RETRY)
export class RetryProcessor extends WorkerHost {
  constructor(
    private readonly jobRepository: PublishJobRepository,
    private readonly mailService: MailService,
    private readonly archivingProducer: ArchivingProducer,
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(RetryProcessor.name);
  }

  async process(job: Job<RetryJobPayload>): Promise<void> {
    const { jobId, reference, stage, attempt, error } = job.data;
    const maxAttempts = this.appConfig.queueRetry.maxRetries;
    const willRetry = attempt < maxAttempts;

    try {
      await this.jobRepository.addRetryHistory({
        jobId,
        stage: PipelineFailureRecorder.toPrismaStage(stage),
        attempt,
        maxAttempts,
        error,
        willRetry,
      });

      if (willRetry) {
        this.logger.info({ jobId, stage, attempt, maxAttempts }, 'Stage will retry automatically');
        return;
      }

      this.logger.error(
        { jobId, stage, attempt },
        'Stage exhausted all retries - marking job as failed',
      );

      await this.jobRepository.markFailed(
        jobId,
        PipelineFailureRecorder.toPrismaStage(stage),
        error,
      );

      await this.mailService.sendFailureNotification({
        jobId,
        reference,
        stage,
        reason: error,
        attempts: attempt,
        occurredAt: new Date(),
      });

      await this.archivingProducer.enqueueFailure({ jobId, reference });
    } catch (bookkeepingError) {
      this.logger.error(
        { jobId, error: (bookkeepingError as Error).message },
        'Failed to record retry/failure bookkeeping - post remains in processing for manual review',
      );
    }
  }
}
