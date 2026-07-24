import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module';
import { AutoReplyModule } from './auto-reply/auto-reply.module';
import { ConfigModule } from './config/config.module';
import { FacebookModule } from './facebook/facebook.module';
import { HealthModule } from './health/health.module';
import { IngestModule } from './ingest/ingest.module';
import { InstagramModule } from './instagram/instagram.module';
import { LoggerModule } from './logger/logger.module';
import { MailModule } from './mail/mail.module';
import { MediaModule } from './media/media.module';
import { ParserModule } from './parser/parser.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    ParserModule,
    AiModule,
    MediaModule,
    FacebookModule,
    InstagramModule,
    MailModule,
    QueueModule,
    SchedulerModule,
    HealthModule,
    IngestModule,
    AutoReplyModule,
    WebhookModule,
  ],
})
export class AppModule {}
