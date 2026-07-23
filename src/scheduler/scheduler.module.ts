import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MailModule } from '../mail/mail.module';
import { QueueModule } from '../queue/queue.module';
import { PostValidatorService } from './post-validator.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), QueueModule, MailModule],
  providers: [PostValidatorService, SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
