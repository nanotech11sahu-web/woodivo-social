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
 * Takes an already-downloaded input file path (the caller streams it to disk
 * via CloudinaryService.downloadToFile - never as a Node Buffer, since source
 * video can be tens of MB and this runs on a 512MB instance). Output is
 * written to its own temp directory; the caller is responsible for deleting
 * the returned output file once it's uploaded back to Cloudinary. Nothing
 * here is ever expected to survive a restart.
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

  async process(inputPath: string): Promise<ProcessedVideoResult> {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woodivo-video-'));
    const outputPath = path.join(workDir, `output-${randomUUID()}.mp4`);

    try {
      const originalSizeBytes = (await fs.stat(inputPath)).size;
      const probeResult = await this.validate(inputPath, originalSizeBytes);
      const timeoutMs = this.appConfig.media.processingTimeoutMs;

      const stderrTail: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .videoBitrate(this.appConfig.media.videoTargetBitrateKbps)
          .outputOptions([
            '-preset veryfast',
            '-movflags +faststart',
            '-pix_fmt yuv420p',
            // Bounds both ffmpeg's own working-set (it scales with frame
            // buffer count/size) and CPU contention on a shared/small
            // instance - unrestricted, a 4K phone source can push the
            // encoder's own memory well past what's left after Node's heap.
            '-threads 2',
            // Reels/feed posts never need more than 1280 on the long edge;
            // downscaling before encode is the single biggest lever on
            // ffmpeg's peak memory for large phone-camera sources.
            // force_divisible_by=2 (not a manual trunc on the input bounds -
            // confirmed by a real failure: a 1088x1936 source landed on
            // 719x1280, because force_original_aspect_ratio=decrease
            // recomputes the non-bounded axis *after* the bounds are
            // applied, so rounding the bounds themselves doesn't guarantee
            // the recomputed axis is even) is what actually keeps both
            // final output dimensions even, which yuv420p requires.
            "-vf scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
          ])
          .output(outputPath);

        const timer = setTimeout(() => {
          command.kill('SIGKILL');
          reject(new Error(`Video processing timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        command
          .on('stderr', (line: string) => {
            stderrTail.push(line);
            if (stderrTail.length > 20) stderrTail.shift();
          })
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
        throw new MediaProcessingException(
          `Failed to process video: ${error.message}${stderrTail.length ? `\nffmpeg stderr (tail):\n${stderrTail.join('\n')}` : ''}`,
          true,
          { probeResult },
        );
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
