import { Module } from '@nestjs/common';
import { ImageProcessorService } from './image-processor.service';
import { MediaService } from './media.service';
import { PublicMediaService } from './public-media.service';
import { VideoProcessorService } from './video-processor.service';

@Module({
  providers: [ImageProcessorService, VideoProcessorService, MediaService, PublicMediaService],
  exports: [MediaService, PublicMediaService],
})
export class MediaModule {}
