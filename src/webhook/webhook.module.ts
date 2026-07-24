import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AutoReplyModule } from '../auto-reply/auto-reply.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [ConfigModule, AutoReplyModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
