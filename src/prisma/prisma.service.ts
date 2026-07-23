import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    (this as unknown as { $on: (event: string, cb: (e: unknown) => void) => void }).$on(
      'error',
      (event) => this.logger.error(event),
    );
    (this as unknown as { $on: (event: string, cb: (e: unknown) => void) => void }).$on(
      'warn',
      (event) => this.logger.warn(event),
    );
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
