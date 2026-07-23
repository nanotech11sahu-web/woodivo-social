import { Injectable } from '@nestjs/common';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MediaProcessingException } from '../shared/exceptions/app.exceptions';
import { FilesystemUtil } from '../shared/utils/filesystem.util';
import { ProcessedMediaResult } from './interfaces/media-processing-result.interface';

interface ProbeResult {
  durationSec: number;
  width?: number;
  height?: number;
}

/**
 * Validates and processes video files with FFmpeg: probes duration/dimensions,
 * enforces configured limits, then transcodes/compresses to a web-optimized
 * H.264/AAC MP4 within the target bitrate.
 */
@Injectable()
export class VideoProcessorService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VideoProcessorService.name);

    if (this.appConfig.media.ffmpegPath) {
      ffmpeg.setFfmpegPath(this.appConfig.media.ffmpegPath);
    }
    if (this.appConfig.media.ffprobePath) {
      ffmpeg.setFfprobePath(this.appConfig.media.ffprobePath);
    }
  }

  private probe(filePath: string): Promise<ProbeResult> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (error, metadata) => {
        if (error) {
          reject(error);
          return;
        }
        const videoStream = metadata.streams.find((stream) => stream.codec_type === 'video');
        resolve({
          durationSec: metadata.format.duration ?? 0,
          width: videoStream?.width,
          height: videoStream?.height,
        });
      });
    });
  }

  async validate(filePath: string): Promise<ProbeResult> {
    let probeResult: ProbeResult;
    try {
      probeResult = await this.probe(filePath);
    } catch (error) {
      throw new MediaProcessingException(
        `File is not a valid or decodable video: ${(error as Error).message}`,
        false,
        { filePath },
      );
    }

    if (!probeResult.durationSec || probeResult.durationSec <= 0) {
      throw new MediaProcessingException('Video has no readable duration', false, { filePath });
    }

    if (probeResult.durationSec > this.appConfig.media.videoMaxDurationSec) {
      throw new MediaProcessingException(
        `Video duration (${probeResult.durationSec}s) exceeds maximum of ${this.appConfig.media.videoMaxDurationSec}s`,
        false,
        { filePath, durationSec: probeResult.durationSec },
      );
    }

    const sizeBytes = await FilesystemUtil.getFileSize(filePath);
    if (sizeBytes > this.appConfig.media.videoMaxSizeBytes) {
      throw new MediaProcessingException(
        `Video exceeds maximum allowed size of ${this.appConfig.media.videoMaxSizeBytes} bytes`,
        false,
        { filePath, sizeBytes },
      );
    }

    return probeResult;
  }

  async process(filePath: string, outputDir: string): Promise<ProcessedMediaResult> {
    const probeResult = await this.validate(filePath);
    const originalSizeBytes = await FilesystemUtil.getFileSize(filePath);

    await FilesystemUtil.ensureDir(outputDir);
    const outputPath = path.join(outputDir, `${path.parse(filePath).name}-processed.mp4`);
    const timeoutMs = this.appConfig.media.processingTimeoutMs;

    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(filePath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoBitrate(this.appConfig.media.videoTargetBitrateKbps)
        .outputOptions(['-preset veryfast', '-movflags +faststart', '-pix_fmt yuv420p'])
        .output(outputPath);

      const timer = setTimeout(() => {
        command.kill('SIGKILL');
        reject(new Error(`Video processing timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      command
        .on('end', () => {
          clearTimeout(timer);
          resolve();
        })
        .on('error', (error: Error) => {
          clearTimeout(timer);
          reject(error);
        })
        .run();
    }).catch((error: Error) => {
      throw new MediaProcessingException(`Failed to process video: ${error.message}`, true, {
        filePath,
        probeResult,
      });
    });

    const processedSizeBytes = await FilesystemUtil.getFileSize(outputPath);

    this.logger.info(
      { filePath, outputPath, originalSizeBytes, processedSizeBytes },
      'Video processed successfully',
    );

    return {
      outputPath,
      originalSizeBytes,
      processedSizeBytes,
      width: probeResult.width,
      height: probeResult.height,
      durationSec: probeResult.durationSec,
      format: 'mp4',
    };
  }
}
