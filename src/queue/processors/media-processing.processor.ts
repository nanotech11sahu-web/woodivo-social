import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LogLevel } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { MediaService } from '../../media/media.service';
import { MediaType } from '../../shared/interfaces/media-type.enum';
import { QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { MediaProcessingJobPayload } from '../../shared/interfaces/job-payloads.interface';
import { PublishJobRepository } from '../publish-job.repository';
import { PipelineFailureRecorder } from '../pipeline-failure-recorder.service';
import { PublishingProducer } from '../producers/publishing.producer';

/**
 * Stage 2: downloads the original media from Cloudinary, processes it
 * (Sharp for images, FFmpeg for video), uploads the processed result back to
 * Cloudinary, then enqueues the publishing job. Local disk is only ever
 * touched transiently for video (FFmpeg needs real files) - never anything
 * that needs to survive past this one job's execution.
 */
@Processor(QUEUE_NAMES.MEDIA_PROCESSING)
export class MediaProcessingProcessor extends WorkerHost {
  constructor(
    private readonly mediaService: MediaService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly jobRepository: PublishJobRepository,
    private readonly publishingProducer: PublishingProducer,
    private readonly failureRecorder: PipelineFailureRecorder,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(MediaProcessingProcessor.name);
  }

  async process(job: Job<MediaProcessingJobPayload>): Promise<void> {
    const { jobId, reference, mediaType, mediaUrl } = job.data;

    const originalBuffer = await this.cloudinaryService.downloadToBuffer(mediaUrl);
    const result = await this.mediaService.processSingle(originalBuffer, mediaType);

    const upload =
      result.mediaType === MediaType.IMAGE
        ? await this.cloudinaryService.uploadBuffer(result.buffer, 'image')
        : await (async () => {
            const uploaded = await this.cloudinaryService.uploadFile(result.filePath, 'video');
            await result.cleanup();
            return uploaded;
          })();

    await this.jobRepository.setProcessedMedia(jobId, upload.secureUrl, upload.publicId);
    await this.jobRepository.addLog(jobId, LogLevel.INFO, 'Media processed successfully', {
      originalSizeBytes: result.originalSizeBytes,
      processedSizeBytes: result.processedSizeBytes,
    });

    await this.publishingProducer.enqueue({
      jobId,
      reference,
      mediaType,
      processedMediaUrl: upload.secureUrl,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MediaProcessingJobPayload>, error: Error): Promise<void> {
    await this.failureRecorder.record(job, 'MEDIA_PROCESSING', error);
  }
}
