import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Protects the public POST /posts ingest endpoint. Woodivo's backend (a
 * separate deployment) must send this app's shared secret in the
 * `x-api-key` header - there is no other trust boundary on this route since
 * it's reachable from the public internet once deployed.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly appConfig: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.header('x-api-key');

    if (!providedKey || providedKey !== this.appConfig.ingest.apiKey) {
      throw new UnauthorizedException('Missing or invalid x-api-key header');
    }
    return true;
  }
}
