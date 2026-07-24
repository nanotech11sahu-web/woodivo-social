import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfigService } from '../config/app-config.service';
import { ConfigModule } from '../config/config.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { QueueModule } from '../queue/queue.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { ApiKeyGuard } from './guards/api-key.guard';
import { IngestController } from './ingest.controller';

@Module({
  imports: [
    ConfigModule,
    CloudinaryModule,
    QueueModule,
    SchedulerModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => ({
        limits: { fileSize: appConfig.ingest.maxUploadBytes },
      }),
    }),
  ],
  controllers: [IngestController],
  providers: [ApiKeyGuard],
})
export class IngestModule {}
