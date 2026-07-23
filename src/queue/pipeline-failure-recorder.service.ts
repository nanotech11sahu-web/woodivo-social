import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { PublishStage } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { RetryProducer } from './producers/retry.producer';
import { PostJobPayload, PublishStageName } from '../shared/interfaces/job-payloads.interface';

/**
 * Shared "on failed" handler invoked by every pipeline-stage processor
 * (AI generation, media processing, publishing). Enqueues a retry-tracking
 * job so RetryHistory bookkeeping and stage-exhaustion handling live in one
 * place (RetryProcessor) instead of being duplicated per stage.
 */
@Injectable()
export class PipelineFailureRecorder {
  constructor(
    private readonly retryProducer: RetryProducer,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PipelineFailureRecorder.name);
  }

  async record(job: Job<PostJobPayload>, stage: PublishStageName, error: Error): Promise<void> {
    this.logger.warn(
      { jobId: job.data.jobId, stage, attempt: job.attemptsMade, error: error.message },
      'Pipeline stage failed',
    );

    await this.retryProducer.enqueue({
      ...job.data,
      stage,
      attempt: job.attemptsMade,
      error: error.message,
      originalPayload: job.data as unknown as Record<string, unknown>,
    });
  }

  /** Maps a BullMQ queue stage name to the Prisma PublishStage enum. */
  static toPrismaStage(stage: PublishStageName): PublishStage {
    return PublishStage[stage];
  }
}
