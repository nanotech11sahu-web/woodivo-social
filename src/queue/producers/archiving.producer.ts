import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { ArchivingJobPayload } from '../../shared/interfaces/job-payloads.interface';

@Injectable()
export class ArchivingProducer {
  constructor(@InjectQueue(QUEUE_NAMES.ARCHIVING) private readonly queue: Queue) {}

  async enqueueSuccess(payload: ArchivingJobPayload): Promise<void> {
    await this.queue.add(JOB_NAMES.ARCHIVE_COMPLETED, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
    });
  }

  async enqueueFailure(payload: ArchivingJobPayload): Promise<void> {
    await this.queue.add(JOB_NAMES.ARCHIVE_FAILED, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
    });
  }
}
