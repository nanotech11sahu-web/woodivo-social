import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { ArchiveService } from '../../archive/archive.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { ArchivingJobPayload } from '../../shared/interfaces/job-payloads.interface';
import { PublishJobRepository } from '../publish-job.repository';

/**
 * Final stage: moves the post folder out of `processing/` into `completed/`
 * or `failed/`. Job status/timestamps for the FAILED path are already set by
 * RetryProcessor before this runs - here we only need to persist the final
 * on-disk location.
 */
@Processor(QUEUE_NAMES.ARCHIVING)
export class ArchivingProcessor extends WorkerHost {
  constructor(
    private readonly archiveService: ArchiveService,
    private readonly jobRepository: PublishJobRepository,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(ArchivingProcessor.name);
  }

  async process(job: Job<ArchivingJobPayload>): Promise<void> {
    const { jobId, folderName, folderPath } = job.data;

    if (job.name === JOB_NAMES.ARCHIVE_COMPLETED) {
      const finalPath = await this.archiveService.archiveCompleted(folderPath, folderName);
      await this.jobRepository.markCompleted(jobId, finalPath);
      this.logger.info({ jobId, finalPath }, 'Post archived to completed/');
      return;
    }

    const finalPath = await this.archiveService.archiveFailed(folderPath, folderName);
    await this.jobRepository.updateFolderPath(jobId, finalPath);
    this.logger.info({ jobId, finalPath }, 'Post archived to failed/');
  }
}
