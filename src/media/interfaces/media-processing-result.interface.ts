export interface ProcessedImageResult {
  buffer: Buffer;
  originalSizeBytes: number;
  processedSizeBytes: number;
  width?: number;
  height?: number;
  format: string;
}

export interface ProcessedVideoResult {
  /** Temp local file - FFmpeg needs a real file, but this is never held across a restart. */
  filePath: string;
  /** Removes the temp working directory (input + output files) - call after uploading. */
  cleanup: () => Promise<void>;
  originalSizeBytes: number;
  processedSizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  format: string;
}
