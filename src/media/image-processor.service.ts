import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MediaProcessingException } from '../shared/exceptions/app.exceptions';
import { ProcessedImageResult } from './interfaces/media-processing-result.interface';

/**
 * Validates and processes still images with Sharp, entirely in memory:
 * verifies the buffer is a genuine, decodable image, then resizes (bounded
 * box, preserves aspect ratio, never upscales) and compresses to JPEG within
 * configured limits. No local disk involved.
 */
@Injectable()
export class ImageProcessorService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ImageProcessorService.name);
  }

  async validate(buffer: Buffer): Promise<sharp.Metadata> {
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch (error) {
      throw new MediaProcessingException(
        `File is not a valid or decodable image: ${(error as Error).message}`,
        false,
      );
    }

    if (!metadata.width || !metadata.height) {
      throw new MediaProcessingException('Image has no readable dimensions', false);
    }

    if (buffer.byteLength > this.appConfig.media.imageMaxSizeBytes) {
      throw new MediaProcessingException(
        `Image exceeds maximum allowed size of ${this.appConfig.media.imageMaxSizeBytes} bytes`,
        false,
        { sizeBytes: buffer.byteLength },
      );
    }

    return metadata;
  }

  async process(buffer: Buffer): Promise<ProcessedImageResult> {
    const metadata = await this.validate(buffer);
    const originalSizeBytes = buffer.byteLength;

    try {
      const pipeline = sharp(buffer)
        .rotate() // apply EXIF orientation
        .resize({
          width: this.appConfig.media.imageMaxWidth,
          height: this.appConfig.media.imageMaxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: this.appConfig.media.imageJpegQuality, mozjpeg: true });

      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

      this.logger.info(
        { originalSizeBytes, processedSizeBytes: info.size },
        'Image processed successfully',
      );

      return {
        buffer: data,
        originalSizeBytes,
        processedSizeBytes: info.size,
        width: info.width,
        height: info.height,
        format: info.format,
      };
    } catch (error) {
      throw new MediaProcessingException(
        `Failed to process image: ${(error as Error).message}`,
        true,
        { metadata },
      );
    }
  }
}
