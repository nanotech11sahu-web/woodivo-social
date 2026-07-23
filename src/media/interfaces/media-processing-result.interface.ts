export interface ProcessedMediaResult {
  outputPath: string;
  originalSizeBytes: number;
  processedSizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
  format: string;
}

/** A single item in a (potentially multi-item) carousel post. */
export interface MediaItem {
  sourcePath: string;
  mediaType: 'IMAGE' | 'VIDEO';
}
