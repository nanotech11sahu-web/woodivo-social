import { Injectable } from '@nestjs/common';
import { MediaType } from '../shared/interfaces/media-type.enum';
import { ImageProcessorService } from './image-processor.service';
import { VideoProcessorService } from './video-processor.service';
import {
  ProcessedImageResult,
  ProcessedVideoResult,
} from './interfaces/media-processing-result.interface';

export type ProcessedMedia =
  | ({ mediaType: MediaType.IMAGE } & ProcessedImageResult)
  | ({ mediaType: MediaType.VIDEO } & ProcessedVideoResult);

/**
 * Public entry point for media handling. Delegates to Sharp (images, held in
 * memory - carousels are images-only and each item is capped at
 * IMAGE_MAX_SIZE_BYTES, small enough to be safe) or FFmpeg (video, always a
 * single item, streamed from an already-downloaded file path so the full
 * file is never held as a Node Buffer). processImages() drives carousel
 * posts - each item (including its watermark) is processed independently so
 * a carousel is simply an ordered list of single-item results.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly imageProcessor: ImageProcessorService,
    private readonly videoProcessor: VideoProcessorService,
  ) {}

  async processVideo(inputPath: string): Promise<ProcessedMedia> {
    const result = await this.videoProcessor.process(inputPath);
    return { mediaType: MediaType.VIDEO, ...result };
  }

  /** Sequential on purpose - keeps peak memory to one item's buffer instead of the whole carousel's. */
  async processImages(buffers: Buffer[]): Promise<ProcessedMedia[]> {
    const results: ProcessedMedia[] = [];
    for (const buffer of buffers) {
      const result = await this.imageProcessor.process(buffer);
      results.push({ mediaType: MediaType.IMAGE, ...result });
    }
    return results;
  }
}
