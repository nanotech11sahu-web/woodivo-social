export type PostSourceType = 'PRODUCT' | 'BLOG' | 'OTHER';

/** Shape of the .social-meta.json file written into a post folder by IngestController. */
export interface PostMeta {
  sourceType: PostSourceType;
  sourceId?: string;
  sourceTitle?: string;
  /** Picked before any non-urgent post of the same sourceType (see SchedulerService). */
  urgent?: boolean;
}
