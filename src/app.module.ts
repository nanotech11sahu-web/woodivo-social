import { Module } from '@nestjs/common';
import * as path from 'path';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ArchiveModule } from './archive/archive.module';
import { AiModule } from './ai/ai.module';
import { AppConfigService } from './config/app-config.service';
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

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => [
        {
          rootPath: path.resolve(process.cwd(), appConfig.publicMedia.dir),
          serveRoot: '/public-media',
        },
      ],
    }),
    ParserModule,
    AiModule,
    MediaModule,
    FacebookModule,
    InstagramModule,
    MailModule,
    ArchiveModule,
    QueueModule,
    SchedulerModule,
    HealthModule,
    IngestModule,
  ],
})
export class AppModule {}
