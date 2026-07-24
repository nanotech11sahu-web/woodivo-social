import { Injectable } from '@nestjs/common';
import * as path from 'node:path';
import sharp from 'sharp';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MediaProcessingException } from '../shared/exceptions/app.exceptions';
import { ProcessedImageResult } from './interfaces/media-processing-result.interface';

const WATERMARK_SOURCE_PATH = path.join(__dirname, 'assets', 'watermark.png');
// Woodivo mark relative to the resized image's width, and a matching margin
// off the bottom-right corner - keeps it small and out of the way regardless
// of source image size.
const WATERMARK_WIDTH_RATIO = 0.12;
const WATERMARK_MARGIN_RATIO = 0.035;
// The bundled watermark.png has a plain white background (no alpha channel),
// so it's chroma-keyed to transparent here at load time rather than requiring
// a separately prepared transparent asset. Near-white pixels become fully
// transparent; a small softness band avoids a hard-edged cutout around the
// mark's anti-aliased edges.
const WHITE_KEY_THRESHOLD = 235;
const WHITE_KEY_SOFTNESS = 20;
// Baked into the keyed-out watermark's alpha so it reads as a subtle overlay
// rather than a solid sticker on top of product/blog photography.
const WATERMARK_OPACITY = 0.82;

/**
 * Validates and processes still images with Sharp, entirely in memory:
 * verifies the buffer is a genuine, decodable image, then resizes (bounded
 * box, preserves aspect ratio, never upscales), watermarks the Woodivo mark
 * into the bottom-right corner, and compresses to JPEG within configured
 * limits. No local disk involved.
 */
@Injectable()
export class ImageProcessorService {
  private transparentWatermarkCache: Promise<Buffer> | null = null;

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
      const resized = await sharp(buffer)
        .rotate() // apply EXIF orientation
        .resize({
          width: this.appConfig.media.imageMaxWidth,
          height: this.appConfig.media.imageMaxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer({ resolveWithObject: true });

      const watermarked = await this.applyWatermark(
        resized.data,
        resized.info.width,
        resized.info.height,
      );

      const { data, info } = await sharp(watermarked)
        .jpeg({ quality: this.appConfig.media.imageJpegQuality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

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

  /** Composites the Woodivo mark into the bottom-right corner of an already-resized image. */
  private async applyWatermark(
    imageBuffer: Buffer,
    imageWidth: number,
    imageHeight: number,
  ): Promise<Buffer> {
    const watermarkSource = await this.getTransparentWatermark();

    const targetWidth = Math.max(16, Math.round(imageWidth * WATERMARK_WIDTH_RATIO));
    const resizedWatermark = await sharp(watermarkSource)
      .resize({ width: targetWidth })
      .toBuffer({ resolveWithObject: true });

    const margin = Math.round(imageWidth * WATERMARK_MARGIN_RATIO);
    const left = Math.max(0, imageWidth - resizedWatermark.info.width - margin);
    const top = Math.max(0, imageHeight - resizedWatermark.info.height - margin);

    return sharp(imageBuffer)
      .composite([{ input: resizedWatermark.data, left, top }])
      .toBuffer();
  }

  /**
   * The bundled watermark.png ships with a plain white background (no alpha
   * channel), so this chroma-keys near-white pixels to transparent and bakes
   * in WATERMARK_OPACITY, once, then caches the result for the process
   * lifetime - every subsequent image reuses the same in-memory buffer
   * instead of re-decoding and re-keying the source PNG per call.
   */
  private async getTransparentWatermark(): Promise<Buffer> {
    if (!this.transparentWatermarkCache) {
      this.transparentWatermarkCache = this.buildTransparentWatermark();
    }
    return this.transparentWatermarkCache;
  }

  private async buildTransparentWatermark(): Promise<Buffer> {
    const { data, info } = await sharp(WATERMARK_SOURCE_PATH)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    for (let i = 0; i < data.length; i += 4) {
      const minChannel = Math.min(data[i], data[i + 1], data[i + 2]);
      let alpha = data[i + 3];

      if (minChannel >= WHITE_KEY_THRESHOLD + WHITE_KEY_SOFTNESS) {
        alpha = 0;
      } else if (minChannel >= WHITE_KEY_THRESHOLD) {
        const fade = (minChannel - WHITE_KEY_THRESHOLD) / WHITE_KEY_SOFTNESS;
        alpha = Math.round(alpha * (1 - fade));
      }

      data[i + 3] = Math.round(alpha * WATERMARK_OPACITY);
    }

    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png()
      .toBuffer();
  }
}
