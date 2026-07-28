import { Injectable } from '@nestjs/common';
import {
  LogLevel,
  PostSourceType as PrismaPostSourceType,
  PublishJob,
  PublishJobStatus,
  PublishStage,
  SocialPlatform,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SocialContentResponseDto } from '../ai/dto/social-content-response.dto';
import { SeoData } from '../parser/interfaces/seo-fields.interface';
import { PostSourceType } from '../shared/interfaces/post-meta.interface';

export interface CreatePendingJobParams {
  reference: string;
  seoRawText: string;
  mediaType: 'IMAGE' | 'VIDEO';
  mediaUrls: string[];
  mediaPublicIds: string[];
  sourceType: PostSourceType;
  sourceId?: string;
  sourceTitle?: string;
  urgent: boolean;
  isReel?: boolean;
}

/**
 * Centralizes every Prisma read/write the publishing pipeline needs, so
 * queue processors depend on a single well-typed repository instead of
 * scattering raw Prisma calls across the codebase.
 */
@Injectable()
export class PublishJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Created immediately when a post is submitted (see IngestController) -
   * status PENDING until the scheduler picks it up. Media is already in
   * Cloudinary by this point, so this row (durable in MongoDB) is the only
   * thing that has to survive between submission and the scheduled slot.
   */
  createPending(params: CreatePendingJobParams): Promise<PublishJob> {
    return this.prisma.publishJob.create({
      data: {
        reference: params.reference,
        seoRawText: params.seoRawText,
        mediaType: params.mediaType,
        mediaUrls: params.mediaUrls,
        mediaPublicIds: params.mediaPublicIds,
        status: PublishJobStatus.PENDING,
        sourceType: params.sourceType as PrismaPostSourceType,
        sourceId: params.sourceId,
        sourceTitle: params.sourceTitle,
        urgent: params.urgent,
        isReel: params.isReel ?? false,
      },
    });
  }

  findById(jobId: string): Promise<PublishJob | null> {
    return this.prisma.publishJob.findUnique({ where: { id: jobId } });
  }

  /** All PENDING jobs, urgent first then oldest first - see SchedulerService for the per-type pick. */
  findPending(): Promise<PublishJob[]> {
    return this.prisma.publishJob.findMany({
      where: { status: PublishJobStatus.PENDING },
      orderBy: [{ urgent: 'desc' }, { createdAt: 'asc' }],
    });
  }

  markProcessing(jobId: string): Promise<PublishJob> {
    return this.prisma.publishJob.update({
      where: { id: jobId },
      data: { status: PublishJobStatus.PROCESSING, startedAt: new Date() },
    });
  }

  async listJobs(
    page: number,
    limit: number,
  ): Promise<{ items: Array<PublishJob & { publishingHistory: unknown[] }>; total: number }> {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.publishJob.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { publishingHistory: true },
      }),
      this.prisma.publishJob.count(),
    ]);
    return { items, total };
  }

  findByIdWithHistory(jobId: string) {
    return this.prisma.publishJob.findUnique({
      where: { id: jobId },
      include: { publishingHistory: true, retries: true },
    });
  }

  setStatus(jobId: string, status: PublishJobStatus): Promise<PublishJob> {
    return this.prisma.publishJob.update({ where: { id: jobId }, data: { status } });
  }

  setSeoParsed(jobId: string, seoParsed: SeoData): Promise<PublishJob> {
    return this.prisma.publishJob.update({
      where: { id: jobId },
      data: { seoParsed: seoParsed as unknown as object, status: PublishJobStatus.AI_GENERATING },
    });
  }

  setGeneratedContent(jobId: string, content: SocialContentResponseDto): Promise<PublishJob> {
    return this.prisma.publishJob.update({
      where: { id: jobId },
      data: {
        generatedContent: content as unknown as object,
        status: PublishJobStatus.MEDIA_PROCESSING,
      },
    });
  }

  setProcessedMedia(
    jobId: string,
    processedMediaUrls: string[],
    processedMediaPublicIds: string[],
  ): Promise<PublishJob> {
    return this.prisma.publishJob.update({
      where: { id: jobId },
      data: {
        processedMediaUrls,
        processedMediaPublicIds,
        status: PublishJobStatus.PUBLISHING,
      },
    });
  }

  markCompleted(jobId: string): Promise<PublishJob> {
    return this.prisma.publishJob.update({
      where: { id: jobId },
      data: { status: PublishJobStatus.COMPLETED, completedAt: new Date() },
    });
  }

  markFailed(jobId: string, stage: PublishStage, reason: string): Promise<PublishJob> {
    return this.prisma.publishJob.update({
      where: { id: jobId },
      data: {
        status: PublishJobStatus.FAILED,
        failedStage: stage,
        failureReason: reason,
        failedAt: new Date(),
      },
    });
  }

  /**
   * Reverts a job back to PENDING for the scheduler to pick up again - either
   * a manual retry (FAILED job, or one stuck in PROCESSING/an intermediate
   * stage with no forward progress) or the scheduler's own stale-job
   * recovery. Deliberately leaves seoParsed/generatedContent/processedMedia
   * alone: PublishingProcessor already treats "already published"/"already
   * commented" as work already done via getPublishedPlatforms/
   * getCommentedPlatforms, so a retry naturally resumes instead of
   * reposting to a platform that already has the post live.
   */
  resetForRetry(jobId: string): Promise<PublishJob> {
    return this.prisma.publishJob.update({
      where: { id: jobId },
      data: {
        status: PublishJobStatus.PENDING,
        failedStage: null,
        failureReason: null,
        failedAt: null,
        startedAt: null,
      },
    });
  }

  /**
   * Jobs that left PENDING (status flipped to PROCESSING, startedAt set) but
   * never produced a single log/retry/AI-response row - the signature of the
   * scheduler's markProcessing()->enqueue() succeeding at the DB write but the
   * BullMQ enqueue call failing (Redis blip) right after, silently orphaning
   * the job since that failure was only ever logged to stdout. Given no
   * cross-collection query in Prisma+Mongo relationMode, this fetches
   * candidates by age and filters by "has any log" in application code.
   */
  async findStuckProcessing(olderThanMs: number): Promise<PublishJob[]> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const candidates = await this.prisma.publishJob.findMany({
      where: { status: PublishJobStatus.PROCESSING, startedAt: { lt: cutoff } },
    });
    if (candidates.length === 0) return [];

    const logCounts = await Promise.all(
      candidates.map((job) =>
        this.prisma.postLog.count({ where: { jobId: job.id } }),
      ),
    );
    return candidates.filter((_, index) => logCounts[index] === 0);
  }

  addLog(jobId: string, level: LogLevel, message: string, context?: Record<string, unknown>) {
    return this.prisma.postLog.create({
      data: { jobId, level, message, context: context as unknown as object },
    });
  }

  addRetryHistory(params: {
    jobId: string;
    stage: PublishStage;
    attempt: number;
    maxAttempts: number;
    error: string;
    willRetry: boolean;
  }) {
    return this.prisma.retryHistory.create({ data: params });
  }

  addAiResponse(params: {
    jobId: string;
    provider: string;
    model?: string;
    prompt: string;
    rawResponse: string;
    parsedResponse?: Record<string, unknown>;
    isValid: boolean;
    attempt: number;
  }) {
    return this.prisma.aiResponse.create({
      data: {
        ...params,
        parsedResponse: params.parsedResponse as unknown as object,
      },
    });
  }

  addMetaResponse(params: {
    jobId: string;
    platform: SocialPlatform;
    endpoint: string;
    requestPayload: Record<string, unknown>;
    responsePayload: Record<string, unknown>;
    statusCode?: number;
    success: boolean;
    externalId?: string;
  }) {
    return this.prisma.metaResponse.create({
      data: {
        ...params,
        requestPayload: params.requestPayload as unknown as object,
        responsePayload: params.responsePayload as unknown as object,
      },
    });
  }

  async getPublishedPlatforms(jobId: string): Promise<SocialPlatform[]> {
    const rows = await this.prisma.publishingHistory.findMany({
      where: { jobId },
      select: { platform: true },
    });
    return rows.map((row) => row.platform);
  }

  async getExternalId(jobId: string, platform: SocialPlatform): Promise<string | null> {
    const row = await this.prisma.publishingHistory.findFirst({
      where: { jobId, platform },
      select: { externalId: true },
    });
    return row?.externalId ?? null;
  }

  /** Platforms where the first-comment has already been posted successfully for this job. */
  async getCommentedPlatforms(jobId: string): Promise<SocialPlatform[]> {
    const rows = await this.prisma.metaResponse.findMany({
      where: { jobId, endpoint: { endsWith: '/comments' }, success: true },
      select: { platform: true },
    });
    return rows.map((row) => row.platform);
  }

  addPublishingHistory(params: {
    jobId: string;
    platform: SocialPlatform;
    externalId: string;
    permalink?: string;
    caption: string;
  }) {
    return this.prisma.publishingHistory.create({ data: params });
  }
}
