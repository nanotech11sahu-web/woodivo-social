import { Module } from '@nestjs/common';
import { MetaModule } from '../meta/meta.module';
import { FacebookService } from './facebook.service';

@Module({
  imports: [MetaModule],
  providers: [FacebookService],
  exports: [FacebookService],
})
export class FacebookModule {}
