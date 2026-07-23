import { MediaType } from './media-type.enum';

/** Payload carried through every stage of the BullMQ pipeline for a single post. */
export interface PostJobPayload {
  jobId: string; // PublishJob.id (Prisma)
  folderName: string;
  folderPath: string; // current absolute path (moves as it transitions state)
}

export type AiGenerationJobPayload = PostJobPayload;

export interface MediaProcessingJobPayload extends PostJobPayload {
  mediaType: MediaType;
  mediaPath: string;
}

export interface PublishingJobPayload extends PostJobPayload {
  mediaType: MediaType;
  processedMediaPath: string;
}

export interface ArchivingJobPayload extends PostJobPayload {
  success: boolean;
  failureReason?: string;
}

export type PublishStageName =
  'VALIDATION' | 'AI_GENERATION' | 'MEDIA_PROCESSING' | 'PUBLISHING' | 'ARCHIVING';

export interface RetryJobPayload extends PostJobPayload {
  stage: PublishStageName;
  attempt: number;
  error: string;
  originalPayload: Record<string, unknown>;
}
