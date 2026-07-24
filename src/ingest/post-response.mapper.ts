import { PublishJob, PublishingHistory, RetryHistory } from '@prisma/client';

interface PlatformResult {
  platform: string;
  externalId: string;
  permalink: string | null;
  publishedAt: Date;
}

export interface PostSummaryResponse {
  id: string;
  reference: string;
  sourceType: string;
  sourceId: string | null;
  sourceTitle: string | null;
  status: string;
  failedStage: string | null;
  failureReason: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  platforms: PlatformResult[];
}

export interface PostDetailResponse extends PostSummaryResponse {
  seoParsed: unknown;
  generatedContent: unknown;
  retries: Array<{
    stage: string;
    attempt: number;
    maxAttempts: number;
    error: string;
    willRetry: boolean;
    createdAt: Date;
  }>;
}

function toPlatformResults(history: PublishingHistory[]): PlatformResult[] {
  return history.map((entry) => ({
    platform: entry.platform,
    externalId: entry.externalId,
    permalink: entry.permalink ?? null,
    publishedAt: entry.publishedAt,
  }));
}

export function toPostSummary(
  job: PublishJob & { publishingHistory: PublishingHistory[] },
): PostSummaryResponse {
  return {
    id: job.id,
    reference: job.reference,
    sourceType: job.sourceType,
    sourceId: job.sourceId ?? null,
    sourceTitle: job.sourceTitle ?? null,
    status: job.status,
    failedStage: job.failedStage ?? null,
    failureReason: job.failureReason ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    failedAt: job.failedAt ?? null,
    platforms: toPlatformResults(job.publishingHistory),
  };
}

export function toPostDetail(
  job: PublishJob & { publishingHistory: PublishingHistory[]; retries: RetryHistory[] },
): PostDetailResponse {
  return {
    ...toPostSummary(job),
    seoParsed: job.seoParsed,
    generatedContent: job.generatedContent,
    retries: job.retries.map((retry) => ({
      stage: retry.stage,
      attempt: retry.attempt,
      maxAttempts: retry.maxAttempts,
      error: retry.error,
      willRetry: retry.willRetry,
      createdAt: retry.createdAt,
    })),
  };
}
