import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '../../shared/constants/queue.constants';
import { ArchivingJobPayload } from '../../shared/interfaces/job-payloads.interface';

@Injectable()
export class ArchivingProducer {
  constructor(@InjectQueue(QUEUE_NAMES.ARCHIVING) private readonly queue: Queue) {}

  async enqueueSuccess(payload: Omit<ArchivingJobPayload, 'success'>): Promise<void> {
    await this.queue.add(
      JOB_NAMES.ARCHIVE_COMPLETED,
      { ...payload, success: true },
      { attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true },
    );
  }

  async enqueueFailure(payload: Omit<ArchivingJobPayload, 'success'>): Promise<void> {
    await this.queue.add(
      JOB_NAMES.ARCHIVE_FAILED,
      { ...payload, success: false },
      { attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true },
    );
  }
}
