import { MediaType } from './media-type.enum';

/** Payload carried through every stage of the BullMQ pipeline for a single post. */
export interface PostJobPayload {
  jobId: string; // PublishJob.id (Prisma)
  reference: string; // human-readable label for logs/emails, not a filesystem path
}

export type AiGenerationJobPayload = PostJobPayload;

export interface MediaProcessingJobPayload extends PostJobPayload {
  mediaType: MediaType;
  mediaUrl: string; // Cloudinary URL
}

export interface PublishingJobPayload extends PostJobPayload {
  mediaType: MediaType;
  processedMediaUrl: string; // Cloudinary URL
}

export type ArchivingJobPayload = PostJobPayload;

export type PublishStageName =
  'VALIDATION' | 'AI_GENERATION' | 'MEDIA_PROCESSING' | 'PUBLISHING' | 'ARCHIVING';

export interface RetryJobPayload extends PostJobPayload {
  stage: PublishStageName;
  attempt: number;
  error: string;
  originalPayload: Record<string, unknown>;
}
