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
 * Public entry point for media handling. Delegates to Sharp (images) or
 * FFmpeg (video) based on mediaType. processMany() drives carousel posts -
 * each item (including its watermark) is processed independently so a
 * carousel is simply an ordered list of single-item results.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly imageProcessor: ImageProcessorService,
    private readonly videoProcessor: VideoProcessorService,
  ) {}

  async processSingle(buffer: Buffer, mediaType: MediaType): Promise<ProcessedMedia> {
    if (mediaType === MediaType.IMAGE) {
      const result = await this.imageProcessor.process(buffer);
      return { mediaType: MediaType.IMAGE, ...result };
    }
    const result = await this.videoProcessor.process(buffer);
    return { mediaType: MediaType.VIDEO, ...result };
  }

  async processMany(
    items: Array<{ buffer: Buffer; mediaType: MediaType }>,
  ): Promise<ProcessedMedia[]> {
    const results: ProcessedMedia[] = [];
    for (const item of items) {
      results.push(await this.processSingle(item.buffer, item.mediaType));
    }
    return results;
  }
}
