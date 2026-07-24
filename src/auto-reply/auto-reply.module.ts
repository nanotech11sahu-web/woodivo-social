import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FacebookModule } from '../facebook/facebook.module';
import { InstagramModule } from '../instagram/instagram.module';
import { AutoReplyRuleRepository } from './auto-reply-rule.repository';
import { AutoReplyRulesAdminController } from './auto-reply-rules.admin.controller';
import { AutoReplyService } from './auto-reply.service';
import { InboundEventLogRepository } from './inbound-event-log.repository';

@Module({
  imports: [PrismaModule, FacebookModule, InstagramModule],
  controllers: [AutoReplyRulesAdminController],
  providers: [AutoReplyRuleRepository, InboundEventLogRepository, AutoReplyService],
  exports: [AutoReplyService, InboundEventLogRepository],
})
export class AutoReplyModule {}
