import { Module } from '@nestjs/common';
import { MetaModule } from '../meta/meta.module';
import { InstagramService } from './instagram.service';

@Module({
  imports: [MetaModule],
  providers: [InstagramService],
  exports: [InstagramService],
})
export class InstagramModule {}
