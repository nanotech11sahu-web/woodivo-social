import { Injectable } from '@nestjs/common';
import { SocialPlatform } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { AutoReplyService } from '../auto-reply/auto-reply.service';
import { InboundEventLogRepository } from '../auto-reply/inbound-event-log.repository';
import { MetaWebhookPayload } from './dto/meta-webhook-payload.interface';

/**
 * Thin dispatcher: pulls {platform, eventType, externalId, senderId, text}
 * out of Meta's payload shape, always logs it to InboundEventLog (audit
 * trail, mirrors PostLog/MetaResponse on the outbound side), then hands off
 * to AutoReplyService for keyword matching.
 */
@Injectable()
export class WebhookService {
  constructor(
    private readonly autoReplyService: AutoReplyService,
    private readonly eventLog: InboundEventLogRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebhookService.name);
  }

  async handlePayload(payload: MetaWebhookPayload): Promise<void> {
    const platform: SocialPlatform =
      payload.object === 'instagram' ? SocialPlatform.INSTAGRAM : SocialPlatform.FACEBOOK;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === 'feed' || change.field === 'comments') {
          await this.handleCommentChange(platform, change.value, payload);
        }
      }

      for (const messagingEvent of entry.messaging ?? []) {
        if (messagingEvent.message?.text) {
          await this.handleMessage(platform, messagingEvent, payload);
        }
      }
    }
  }

  private async handleCommentChange(
    platform: SocialPlatform,
    value: { from?: { id: string }; message?: string; comment_id?: string; verb?: string },
    rawPayload: unknown,
  ): Promise<void> {
    // Only react to new top-level comments, not edits/deletes/reactions.
    if (value.verb && value.verb !== 'add') return;
    if (!value.comment_id || !value.message || !value.from?.id) return;

    const outcome = await this.autoReplyService.handleComment({
      platform,
      commentId: value.comment_id,
      senderId: value.from.id,
      text: value.message,
    });

    await this.eventLog.record({
      platform,
      eventType: 'comment',
      externalId: value.comment_id,
      senderId: value.from.id,
      text: value.message,
      matchedRuleId: outcome.matchedRuleId,
      actionTaken: outcome.actionTaken,
      rawPayload,
    });

    this.logger.info(
      { platform, commentId: value.comment_id, actionTaken: outcome.actionTaken },
      'Processed inbound comment webhook event',
    );
  }

  private async handleMessage(
    platform: SocialPlatform,
    event: { sender: { id: string }; message?: { mid: string; text?: string } },
    rawPayload: unknown,
  ): Promise<void> {
    if (!event.message?.text) return;

    const outcome = await this.autoReplyService.handleMessage({
      platform,
      senderId: event.sender.id,
      text: event.message.text,
    });

    await this.eventLog.record({
      platform,
      eventType: 'message',
      externalId: event.message.mid,
      senderId: event.sender.id,
      text: event.message.text,
      matchedRuleId: outcome.matchedRuleId,
      actionTaken: outcome.actionTaken,
      rawPayload,
    });

    this.logger.info(
      { platform, messageId: event.message.mid, actionTaken: outcome.actionTaken },
      'Processed inbound DM webhook event',
    );
  }
}
