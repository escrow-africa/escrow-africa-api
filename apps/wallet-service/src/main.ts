/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  // rawBody: true makes Nest populate req.rawBody with the exact bytes received, which
  // MonnifyController needs to verify the webhook's HMAC signature (a parsed-then-restringified
  // body will not byte-for-byte match what Monnify signed, so verification would always fail).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  // CORS is handled centrally by api-gateway, which is the only service browsers talk to directly.
  const port = 3005;
  await app.listen(port as any);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
