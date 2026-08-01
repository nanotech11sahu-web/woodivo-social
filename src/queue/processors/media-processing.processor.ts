import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LogLevel } from '@prisma/client';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { PinoLogger } from 'nestjs-pino';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { MediaService, ProcessedMedia } from '../../media/media.service';
import { MediaType } from '../../shared/interfaces/media-type.enum';
import { QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { MediaProcessingJobPayload } from '../../shared/interfaces/job-payloads.interface';
import { PublishJobRepository } from '../publish-job.repository';
import { PipelineFailureRecorder } from '../pipeline-failure-recorder.service';
import { PublishingProducer } from '../producers/publishing.producer';

/**
 * Stage 2: downloads the original media from Cloudinary, processes it
 * (Sharp for images, FFmpeg for video), uploads the processed result back to
 * Cloudinary, then enqueues the publishing job. Video is always downloaded
 * straight to disk and never held as a full Node Buffer - on a 512MB
 * instance, buffering a multi-ten-MB source video in the JS heap on top of
 * ffmpeg's own subprocess memory is what was causing OOM kills.
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

    const results =
      mediaType === MediaType.VIDEO
        ? [await this.processVideoItem(mediaUrls[0])]
        : await this.processImageItems(mediaUrls);

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

  /** Downloads the single source video straight to disk, then hands the file path (never a Buffer) to FFmpeg. */
  private async processVideoItem(url: string): Promise<ProcessedMedia> {
    const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woodivo-video-src-'));
    const inputPath = path.join(downloadDir, `src-${randomUUID()}`);
    const removeDownloadDir = () => fs.rm(downloadDir, { recursive: true, force: true }).catch(() => undefined);

    try {
      await this.cloudinaryService.downloadToFile(url, inputPath);
      const result = await this.mediaService.processVideo(inputPath);
      await removeDownloadDir();
      return result;
    } catch (error) {
      await removeDownloadDir();
      throw error;
    }
  }

  /** Carousels are images-only and each item is capped small (IMAGE_MAX_SIZE_BYTES) - buffering is fine, but sequential to cap peak memory. */
  private async processImageItems(urls: string[]): Promise<ProcessedMedia[]> {
    const buffers: Buffer[] = [];
    for (const url of urls) {
      buffers.push(await this.cloudinaryService.downloadToBuffer(url));
    }
    return this.mediaService.processImages(buffers);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<MediaProcessingJobPayload>, error: Error): Promise<void> {
    await this.failureRecorder.record(job, 'MEDIA_PROCESSING', error);
  }
}
