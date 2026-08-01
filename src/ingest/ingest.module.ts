import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as os from 'os';
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
        // Writes straight to the OS temp dir instead of Multer's default
        // memoryStorage - an in-memory Buffer per uploaded file (video can be
        // tens of MB, up to 10 files per carousel) was one of the direct
        // causes of OOM kills on the 512MB instance.
        storage: diskStorage({ destination: os.tmpdir() }),
        limits: { fileSize: appConfig.ingest.maxUploadBytes },
      }),
    }),
  ],
  controllers: [IngestController],
  providers: [ApiKeyGuard],
})
export class IngestModule {}
