import { Injectable } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MediaProcessingException } from '../shared/exceptions/app.exceptions';
import { ProcessedVideoResult } from './interfaces/media-processing-result.interface';

interface ProbeResult {
  durationSec: number;
  width?: number;
  height?: number;
}

/**
 * Validates and processes video with FFmpeg: probes duration/dimensions,
 * enforces configured limits, then transcodes/compresses to a web-optimized
 * H.264/AAC MP4 within the target bitrate.
 *
 * FFmpeg needs real files, so the input buffer (downloaded from Cloudinary)
 * is written to the OS temp directory just for the duration of this one
 * call, and the caller is responsible for deleting the returned output file
 * once it's uploaded back to Cloudinary. Nothing here is ever expected to
 * survive a restart - it exists only for the few seconds this job is
 * actively running.
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

  private async validate(filePath: string, sizeBytes: number): Promise<ProbeResult> {
    let probeResult: ProbeResult;
    try {
      probeResult = await this.probe(filePath);
    } catch (error) {
      throw new MediaProcessingException(
        `File is not a valid or decodable video: ${(error as Error).message}`,
        false,
      );
    }

    if (!probeResult.durationSec || probeResult.durationSec <= 0) {
      throw new MediaProcessingException('Video has no readable duration', false);
    }

    if (probeResult.durationSec > this.appConfig.media.videoMaxDurationSec) {
      throw new MediaProcessingException(
        `Video duration (${probeResult.durationSec}s) exceeds maximum of ${this.appConfig.media.videoMaxDurationSec}s`,
        false,
        { durationSec: probeResult.durationSec },
      );
    }

    if (sizeBytes > this.appConfig.media.videoMaxSizeBytes) {
      throw new MediaProcessingException(
        `Video exceeds maximum allowed size of ${this.appConfig.media.videoMaxSizeBytes} bytes`,
        false,
        { sizeBytes },
      );
    }

    return probeResult;
  }

  async process(buffer: Buffer): Promise<ProcessedVideoResult> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woodivo-video-'));
    const inputPath = path.join(workDir, `input-${randomUUID()}`);
    const outputPath = path.join(workDir, `output-${randomUUID()}.mp4`);

    try {
      await fs.writeFile(inputPath, buffer);
      const originalSizeBytes = buffer.byteLength;
      const probeResult = await this.validate(inputPath, originalSizeBytes);
      const timeoutMs = this.appConfig.media.processingTimeoutMs;

      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg(inputPath)
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
          probeResult,
        });
      });

      const processedSizeBytes = (await fs.stat(outputPath)).size;

      this.logger.info({ originalSizeBytes, processedSizeBytes }, 'Video processed successfully');

      return {
        filePath: outputPath,
        cleanup: () => fs.rm(workDir, { recursive: true, force: true }),
        originalSizeBytes,
        processedSizeBytes,
        width: probeResult.width,
        height: probeResult.height,
        durationSec: probeResult.durationSec,
        format: 'mp4',
      };
    } catch (error) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
}
