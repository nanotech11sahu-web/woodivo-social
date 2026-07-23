import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { RetryJobPayload } from '../../shared/interfaces/job-payloads.interface';

/**
 * Records a failed attempt from any pipeline stage. Decoupled from the
 * originating queue so retry-history bookkeeping and stage-exhaustion
 * handling live in one place (see RetryProcessor).
 */
@Injectable()
export class RetryProducer {
  constructor(@InjectQueue(QUEUE_NAMES.RETRY) private readonly queue: Queue) {}

  async enqueue(payload: RetryJobPayload): Promise<void> {
    await this.queue.add(JOB_NAMES.RETRY_STAGE, payload, {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
