import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicatorResult } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator {
  constructor(private readonly prisma: PrismaService) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$runCommandRaw({ ping: 1 });
      return { [key]: { status: 'up' } };
    } catch (error) {
      throw new HealthCheckError('Prisma database check failed', {
        [key]: { status: 'down', message: (error as Error).message },
      });
    }
  }
}
