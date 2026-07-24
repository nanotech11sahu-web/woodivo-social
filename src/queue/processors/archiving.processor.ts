import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { JOB_NAMES, QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { ArchivingJobPayload } from '../../shared/interfaces/job-payloads.interface';
import { PublishJobRepository } from '../publish-job.repository';

/**
 * Final stage: finalizes the job's status in MongoDB. No filesystem work at
 * all - there's no folder to move, since media lives in Cloudinary and job
 * state lives in the database from the moment the post was submitted.
 * FAILED status/timestamps are already set by RetryProcessor before this
 * runs; the archive-failed job here just marks the pipeline's bookkeeping
 * as finished.
 */
@Processor(QUEUE_NAMES.ARCHIVING)
export class ArchivingProcessor extends WorkerHost {
  constructor(
    private readonly jobRepository: PublishJobRepository,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(ArchivingProcessor.name);
  }

  async process(job: Job<ArchivingJobPayload>): Promise<void> {
    const { jobId } = job.data;

    if (job.name === JOB_NAMES.ARCHIVE_COMPLETED) {
      await this.jobRepository.markCompleted(jobId);
      this.logger.info({ jobId }, 'Post marked completed');
      return;
    }

    this.logger.info({ jobId }, 'Post archiving finalized as failed');
  }
}
