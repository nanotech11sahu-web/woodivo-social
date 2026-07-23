import { Module } from '@nestjs/common';
import { MetaGraphClient } from './meta-graph.client';

@Module({
  providers: [MetaGraphClient],
  exports: [MetaGraphClient],
})
export class MetaModule {}
