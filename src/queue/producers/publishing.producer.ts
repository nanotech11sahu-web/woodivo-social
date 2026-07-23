import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfigService } from '../../config/app-config.service';
import { JOB_NAMES, QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { PublishingJobPayload } from '../../shared/interfaces/job-payloads.interface';

@Injectable()
export class PublishingProducer {
  constructor(
    @InjectQueue(QUEUE_NAMES.PUBLISHING) private readonly queue: Queue,
    private readonly appConfig: AppConfigService,
  ) {}

  async enqueue(payload: PublishingJobPayload): Promise<void> {
    const { maxRetries, backoffMs } = this.appConfig.queueRetry;
    await this.queue.add(JOB_NAMES.PUBLISH_POST, payload, {
      attempts: maxRetries,
      backoff: { type: 'exponential', delay: backoffMs },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
