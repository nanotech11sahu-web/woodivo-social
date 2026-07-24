import { Injectable } from '@nestjs/common';
import { SocialPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordInboundEventParams {
  platform: SocialPlatform;
  eventType: string;
  externalId: string;
  senderId: string;
  text: string;
  matchedRuleId?: string;
  actionTaken?: string;
  rawPayload: unknown;
}

@Injectable()
export class InboundEventLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  record(params: RecordInboundEventParams) {
    return this.prisma.inboundEventLog.create({
      data: {
        ...params,
        rawPayload: params.rawPayload as object,
      },
    });
  }
}
