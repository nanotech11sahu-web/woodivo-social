import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import * as path from 'path';
import { Job } from 'bullmq';
import { LogLevel } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { MediaService } from '../../media/media.service';
import { QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { MediaProcessingJobPayload } from '../../shared/interfaces/job-payloads.interface';
import { PublishJobRepository } from '../publish-job.repository';
import { PipelineFailureRecorder } from '../pipeline-failure-recorder.service';
import { PublishingProducer } from '../producers/publishing.producer';

/**
 * Stage 2: validates and processes the post's media file (Sharp for images,
 * FFmpeg for video) into a publish-ready asset, then enqueues the publishing job.
 */
@Processor(QUEUE_NAMES.MEDIA_PROCESSING)
export class MediaProcessingProcessor extends WorkerHost {
  constructor(
    private readonly mediaService: MediaService,
    private readonly jobRepository: PublishJobRepository,
    private readonly publishingProducer: PublishingProducer,
    private readonly failureRecorder: PipelineFailureRecorder,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(MediaProcessingProcessor.name);
  }

  async process(job: Job<MediaProcessingJobPayload>): Promise<void> {
    const { jobId, folderPath, mediaPath } = job.data;

    const processedDir = path.join(folderPath, '.processed');
    const result = await this.mediaService.processSingle(mediaPath, processedDir);

    await this.jobRepository.setProcessedMedia(jobId, result.outputPath);
    await this.jobRepository.addLog(jobId, LogLevel.INFO, 'Media processed successfully', {
      originalSizeBytes: result.originalSizeBytes,
      processedSizeBytes: result.processedSizeBytes,
    });

    await this.publishingProducer.enqueue({
      jobId,
      folderName: job.data.folderName,
      folderPath,
      mediaType: job.data.mediaType,
      processedMediaPath: result.outputPath,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MediaProcessingJobPayload>, error: Error): Promise<void> {
    await this.failureRecorder.record(job, 'MEDIA_PROCESSING', error);
  }
}
