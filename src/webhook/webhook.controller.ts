import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { MetaWebhookPayload } from './dto/meta-webhook-payload.interface';
import { verifyMetaSignature } from './webhook.signature.util';
import { WebhookService } from './webhook.service';

/**
 * Receives Meta's webhook handshake (GET) and event payloads (POST) for
 * Page comments and Page/Instagram Messenger DMs. Public endpoint - Meta
 * itself calls this once a webhook subscription is configured in the App
 * Dashboard, so the POST body is verified via X-Hub-Signature-256 rather
 * than the x-api-key scheme used by the ingest endpoint (Meta doesn't send
 * custom headers we control).
 */
@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly webhookService: WebhookService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebhookController.name);
  }

  /** Meta's verification handshake, performed once when the webhook URL is saved in the App Dashboard. */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && verifyToken === this.appConfig.meta.webhookVerifyToken) {
      return challenge;
    }
    throw new UnauthorizedException('Webhook verify token mismatch');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): Promise<{ received: true }> {
    const valid = verifyMetaSignature(request.rawBody, signature, this.appConfig.meta.appSecret);
    if (!valid) {
      throw new UnauthorizedException('Invalid X-Hub-Signature-256');
    }

    const payload = request.body as MetaWebhookPayload;
    await this.webhookService.handlePayload(payload);
    return { received: true };
  }
}
