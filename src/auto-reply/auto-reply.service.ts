import { Injectable } from '@nestjs/common';
import { AutoReplyPlatform, AutoReplyRule, AutoReplyTrigger, SocialPlatform } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { FacebookService } from '../facebook/facebook.service';
import { InstagramService } from '../instagram/instagram.service';
import { AutoReplyRuleRepository } from './auto-reply-rule.repository';

export interface InboundComment {
  platform: SocialPlatform;
  commentId: string;
  senderId: string;
  text: string;
}

export interface InboundMessage {
  platform: SocialPlatform;
  senderId: string;
  text: string;
}

export interface AutoReplyOutcome {
  matchedRuleId?: string;
  actionTaken: 'replied_comment' | 'sent_dm' | 'replied_dm' | 'no_match';
}

/**
 * Keyword-triggered engagement automation. Rules are evaluated in ascending
 * `priority` order and the first one whose keywords match wins - same
 * "first match wins, no partial fan-out" shape as the scheduler's per-bucket
 * job pick.
 */
@Injectable()
export class AutoReplyService {
  constructor(
    private readonly ruleRepository: AutoReplyRuleRepository,
    private readonly facebookService: FacebookService,
    private readonly instagramService: InstagramService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AutoReplyService.name);
  }

  async handleComment(comment: InboundComment): Promise<AutoReplyOutcome> {
    const rules = await this.ruleRepository.findActiveByTrigger(AutoReplyTrigger.COMMENT);
    const rule = this.findMatch(rules, comment.platform, comment.text);
    if (!rule) return { actionTaken: 'no_match' };

    let actionTaken: AutoReplyOutcome['actionTaken'] = 'no_match';

    if (rule.replyComment) {
      await this.replyToComment(comment.platform, comment.commentId, rule.replyComment);
      actionTaken = 'replied_comment';
    }

    if (rule.replyDm) {
      await this.sendDirectMessage(comment.platform, comment.senderId, rule.replyDm);
      actionTaken = actionTaken === 'replied_comment' ? actionTaken : 'sent_dm';
    }

    this.logger.info(
      { ruleId: rule.id, platform: comment.platform, actionTaken },
      'Auto-reply rule matched inbound comment',
    );

    return { matchedRuleId: rule.id, actionTaken };
  }

  async handleMessage(message: InboundMessage): Promise<AutoReplyOutcome> {
    const rules = await this.ruleRepository.findActiveByTrigger(AutoReplyTrigger.DM);
    const rule = this.findMatch(rules, message.platform, message.text);
    if (!rule || !rule.replyDm) return { actionTaken: 'no_match' };

    await this.sendDirectMessage(message.platform, message.senderId, rule.replyDm);

    this.logger.info(
      { ruleId: rule.id, platform: message.platform },
      'Auto-reply rule matched inbound DM',
    );

    return { matchedRuleId: rule.id, actionTaken: 'replied_dm' };
  }

  private findMatch(
    rules: AutoReplyRule[],
    platform: SocialPlatform,
    text: string,
  ): AutoReplyRule | undefined {
    const normalized = text.toLowerCase();
    return rules.find((rule) => {
      if (!this.platformMatches(rule.platform, platform)) return false;
      return rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
    });
  }

  private platformMatches(rulePlatform: AutoReplyPlatform, eventPlatform: SocialPlatform): boolean {
    if (rulePlatform === AutoReplyPlatform.BOTH) return true;
    return rulePlatform === (eventPlatform as unknown as AutoReplyPlatform);
  }

  private replyToComment(platform: SocialPlatform, commentId: string, message: string) {
    return platform === SocialPlatform.INSTAGRAM
      ? this.instagramService.replyToComment(commentId, message)
      : this.facebookService.replyToComment(commentId, message);
  }

  private sendDirectMessage(platform: SocialPlatform, recipientId: string, message: string) {
    return platform === SocialPlatform.INSTAGRAM
      ? this.instagramService.sendDirectMessage(recipientId, message)
      : this.facebookService.sendDirectMessage(recipientId, message);
  }
}
