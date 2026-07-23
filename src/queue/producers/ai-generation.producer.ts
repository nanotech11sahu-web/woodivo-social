import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfigService } from '../../config/app-config.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { AiGenerationJobPayload } from '../../shared/interfaces/job-payloads.interface';

@Injectable()
export class AiGenerationProducer {
  constructor(
    @InjectQueue(QUEUE_NAMES.AI_GENERATION) private readonly queue: Queue,
    private readonly appConfig: AppConfigService,
  ) {}

  async enqueue(payload: AiGenerationJobPayload): Promise<void> {
    const { maxRetries, backoffMs } = this.appConfig.queueRetry;
    await this.queue.add(JOB_NAMES.GENERATE_CONTENT, payload, {
      attempts: maxRetries,
      backoff: { type: 'exponential', delay: backoffMs },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
