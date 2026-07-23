import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const appConfig = app.get(AppConfigService);
  await app.listen(appConfig.app.port);

  app.get(Logger).log(`${appConfig.app.appName} listening on port ${appConfig.app.port}`);
}

bootstrap();
