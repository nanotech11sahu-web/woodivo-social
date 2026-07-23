import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AppConfigService } from '../config/app-config.service';
import { ConfigModule } from '../config/config.module';
import { ArchiveModule } from '../archive/archive.module';
import { FacebookModule } from '../facebook/facebook.module';
import { InstagramModule } from '../instagram/instagram.module';
import { MailModule } from '../mail/mail.module';
import { MediaModule } from '../media/media.module';
import { ParserModule } from '../parser/parser.module';
import { QUEUE_NAMES } from '../shared/constants/queue.constants';
import { PipelineFailureRecorder } from './pipeline-failure-recorder.service';
import { PublishJobRepository } from './publish-job.repository';
import { AiGenerationProducer } from './producers/ai-generation.producer';
import { ArchivingProducer } from './producers/archiving.producer';
import { MediaProcessingProducer } from './producers/media-processing.producer';
import { PublishingProducer } from './producers/publishing.producer';
import { RetryProducer } from './producers/retry.producer';
import { AiGenerationProcessor } from './processors/ai-generation.processor';
import { ArchivingProcessor } from './processors/archiving.processor';
import { MediaProcessingProcessor } from './processors/media-processing.processor';
import { PublishingProcessor } from './processors/publishing.processor';
import { RetryProcessor } from './processors/retry.processor';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        connection: {
          host: appConfig.redis.host,
          port: appConfig.redis.port,
          password: appConfig.redis.password,
          db: appConfig.redis.db,
          tls: appConfig.redis.tls ? {} : undefined,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.AI_GENERATION },
      { name: QUEUE_NAMES.MEDIA_PROCESSING },
      { name: QUEUE_NAMES.PUBLISHING },
      { name: QUEUE_NAMES.RETRY },
      { name: QUEUE_NAMES.ARCHIVING },
    ),
    ParserModule,
    AiModule,
    MediaModule,
    FacebookModule,
    InstagramModule,
    ArchiveModule,
    MailModule,
  ],
  providers: [
    PublishJobRepository,
    PipelineFailureRecorder,
    AiGenerationProducer,
    MediaProcessingProducer,
    PublishingProducer,
    RetryProducer,
    ArchivingProducer,
    AiGenerationProcessor,
    MediaProcessingProcessor,
    PublishingProcessor,
    RetryProcessor,
    ArchivingProcessor,
  ],
  exports: [PublishJobRepository, AiGenerationProducer, ArchivingProducer],
})
export class QueueModule {}
