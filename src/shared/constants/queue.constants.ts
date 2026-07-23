export const QUEUE_NAMES = {
  AI_GENERATION: 'ai-generation',
  MEDIA_PROCESSING: 'media-processing',
  PUBLISHING: 'publishing',
  RETRY: 'retry',
  ARCHIVING: 'archiving',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  GENERATE_CONTENT: 'generate-content',
  PROCESS_MEDIA: 'process-media',
  PUBLISH_POST: 'publish-post',
  RETRY_STAGE: 'retry-stage',
  ARCHIVE_COMPLETED: 'archive-completed',
  ARCHIVE_FAILED: 'archive-failed',
} as const;

export const MEDIA_EXTENSIONS = {
  IMAGE: ['.jpg', '.jpeg', '.png', '.webp'],
  VIDEO: ['.mp4', '.mov', '.m4v'],
} as const;

export const SEO_FILENAME = 'seo.txt';

// Written into a post folder alongside seo.txt/media by IngestController,
// read by SchedulerService to group pending folders by content type.
export const POST_META_FILENAME = '.social-meta.json';
