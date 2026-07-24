import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  // rawBody: true so the webhook controller can verify Meta's
  // X-Hub-Signature-256 header against the exact bytes Meta sent, before any
  // JSON parsing/transformation happens.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const appConfig = app.get(AppConfigService);
  await app.listen(appConfig.app.port);

  app.get(Logger).log(`${appConfig.app.appName} listening on port ${appConfig.app.port}`);
}

bootstrap();
