import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { MediaType } from '../shared/interfaces/media-type.enum';
import { MEDIA_EXTENSIONS } from '../shared/constants/queue.constants';
import { MediaProcessingException } from '../shared/exceptions/app.exceptions';
import { ImageProcessorService } from './image-processor.service';
import { VideoProcessorService } from './video-processor.service';
import { MediaItem, ProcessedMediaResult } from './interfaces/media-processing-result.interface';

/**
 * Public entry point for media handling. Detects whether a file is an image
 * or video and delegates to the appropriate processor. Also exposes
 * processCarousel() for future multi-media posts - each item is processed
 * independently so a carousel is simply an ordered list of single-item results.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly imageProcessor: ImageProcessorService,
    private readonly videoProcessor: VideoProcessorService,
  ) {}

  detectMediaType(filePath: string): MediaType {
    const ext = path.extname(filePath).toLowerCase();
    if ((MEDIA_EXTENSIONS.IMAGE as readonly string[]).includes(ext)) {
      return MediaType.IMAGE;
    }
    if ((MEDIA_EXTENSIONS.VIDEO as readonly string[]).includes(ext)) {
      return MediaType.VIDEO;
    }
    throw new MediaProcessingException(`Unsupported media file extension: ${ext}`, false, {
      filePath,
    });
  }

  async processSingle(filePath: string, outputDir: string): Promise<ProcessedMediaResult> {
    const mediaType = this.detectMediaType(filePath);
    return mediaType === MediaType.IMAGE
      ? this.imageProcessor.process(filePath, outputDir)
      : this.videoProcessor.process(filePath, outputDir);
  }

  async processCarousel(items: MediaItem[], outputDir: string): Promise<ProcessedMediaResult[]> {
    const results: ProcessedMediaResult[] = [];
    for (const item of items) {
      results.push(await this.processSingle(item.sourcePath, outputDir));
    }
    return results;
  }
}
