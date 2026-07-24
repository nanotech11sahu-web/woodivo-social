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
    const { jobId, reference, mediaType, mediaUrls } = job.data;

    const originalBuffers = await Promise.all(
      mediaUrls.map((url) => this.cloudinaryService.downloadToBuffer(url)),
    );
    const results = await this.mediaService.processMany(
      originalBuffers.map((buffer) => ({ buffer, mediaType })),
    );

    const uploads = await Promise.all(
      results.map((result) =>
        result.mediaType === MediaType.IMAGE
          ? this.cloudinaryService.uploadBuffer(result.buffer, 'image')
          : (async () => {
              const uploaded = await this.cloudinaryService.uploadFile(result.filePath, 'video');
              await result.cleanup();
              return uploaded;
            })(),
      ),
    );

    const processedMediaUrls = uploads.map((upload) => upload.secureUrl);
    const processedMediaPublicIds = uploads.map((upload) => upload.publicId);

    await this.jobRepository.setProcessedMedia(jobId, processedMediaUrls, processedMediaPublicIds);
    await this.jobRepository.addLog(jobId, LogLevel.INFO, 'Media processed successfully', {
      itemCount: results.length,
      originalSizeBytes: results.reduce((sum, r) => sum + r.originalSizeBytes, 0),
      processedSizeBytes: results.reduce((sum, r) => sum + r.processedSizeBytes, 0),
    });

    await this.publishingProducer.enqueue({
      jobId,
      reference,
      mediaType,
      processedMediaUrls,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MediaProcessingJobPayload>, error: Error): Promise<void> {
    await this.failureRecorder.record(job, 'MEDIA_PROCESSING', error);
  }
}
