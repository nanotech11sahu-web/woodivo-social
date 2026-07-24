import { Module } from '@nestjs/common';
import { ImageProcessorService } from './image-processor.service';
import { MediaService } from './media.service';
import { VideoProcessorService } from './video-processor.service';

@Module({
  providers: [ImageProcessorService, VideoProcessorService, MediaService],
  exports: [MediaService],
})
export class MediaModule {}
