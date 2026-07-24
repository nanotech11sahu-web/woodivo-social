import { Injectable } from '@nestjs/common';
import { AutoReplyPlatform, AutoReplyRule, AutoReplyTrigger } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UpsertAutoReplyRuleParams {
  platform: AutoReplyPlatform;
  trigger: AutoReplyTrigger;
  keywords: string[];
  active?: boolean;
  priority?: number;
  replyComment?: string;
  replyDm?: string;
}

/**
 * Centralizes every Prisma read/write for AutoReplyRule, mirroring the
 * PublishJobRepository convention (one repository per Prisma model, no raw
 * Prisma calls scattered across services/controllers).
 */
@Injectable()
export class AutoReplyRuleRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(params: UpsertAutoReplyRuleParams): Promise<AutoReplyRule> {
    return this.prisma.autoReplyRule.create({ data: params });
  }

  update(id: string, params: Partial<UpsertAutoReplyRuleParams>): Promise<AutoReplyRule> {
    return this.prisma.autoReplyRule.update({ where: { id }, data: params });
  }

  remove(id: string): Promise<AutoReplyRule> {
    return this.prisma.autoReplyRule.delete({ where: { id } });
  }

  findById(id: string): Promise<AutoReplyRule | null> {
    return this.prisma.autoReplyRule.findUnique({ where: { id } });
  }

  findAll(): Promise<AutoReplyRule[]> {
    return this.prisma.autoReplyRule.findMany({ orderBy: { priority: 'asc' } });
  }

  /** Active rules for a trigger type, in match order (lowest priority number first). */
  findActiveByTrigger(trigger: AutoReplyTrigger): Promise<AutoReplyRule[]> {
    return this.prisma.autoReplyRule.findMany({
      where: { trigger, active: true },
      orderBy: { priority: 'asc' },
    });
  }
}
