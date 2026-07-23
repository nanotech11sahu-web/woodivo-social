import { Injectable } from '@nestjs/common';
import * as path from 'path';
import sharp from 'sharp';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MediaProcessingException } from '../shared/exceptions/app.exceptions';
import { FilesystemUtil } from '../shared/utils/filesystem.util';
import { ProcessedMediaResult } from './interfaces/media-processing-result.interface';

/**
 * Validates and processes still images with Sharp: verifies the file is a
 * genuine, decodable image, then resizes (bounded box, preserves aspect
 * ratio, never upscales) and compresses to JPEG within configured limits.
 */
@Injectable()
export class ImageProcessorService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ImageProcessorService.name);
  }

  async validate(filePath: string): Promise<sharp.Metadata> {
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(filePath).metadata();
    } catch (error) {
      throw new MediaProcessingException(
        `File is not a valid or decodable image: ${(error as Error).message}`,
        false,
        { filePath },
      );
    }

    if (!metadata.width || !metadata.height) {
      throw new MediaProcessingException('Image has no readable dimensions', false, { filePath });
    }

    const sizeBytes = await FilesystemUtil.getFileSize(filePath);
    if (sizeBytes > this.appConfig.media.imageMaxSizeBytes) {
      throw new MediaProcessingException(
        `Image exceeds maximum allowed size of ${this.appConfig.media.imageMaxSizeBytes} bytes`,
        false,
        { filePath, sizeBytes },
      );
    }

    return metadata;
  }

  async process(filePath: string, outputDir: string): Promise<ProcessedMediaResult> {
    const metadata = await this.validate(filePath);
    const originalSizeBytes = await FilesystemUtil.getFileSize(filePath);

    await FilesystemUtil.ensureDir(outputDir);
    const outputPath = path.join(outputDir, `${path.parse(filePath).name}-processed.jpg`);

    try {
      const pipeline = sharp(filePath)
        .rotate() // apply EXIF orientation
        .resize({
          width: this.appConfig.media.imageMaxWidth,
          height: this.appConfig.media.imageMaxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: this.appConfig.media.imageJpegQuality, mozjpeg: true });

      const info = await pipeline.toFile(outputPath);

      this.logger.info(
        { filePath, outputPath, originalSizeBytes, processedSizeBytes: info.size },
        'Image processed successfully',
      );

      return {
        outputPath,
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
        { filePath, metadata },
      );
    }
  }
}
