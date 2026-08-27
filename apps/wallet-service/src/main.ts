/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  // rawBody: true makes Nest populate req.rawBody with the exact bytes received, which
  // MonnifyController needs to verify the webhook's HMAC signature (a parsed-then-restringified
  // body will not byte-for-byte match what Monnify signed, so verification would always fail).
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  // CORS is handled centrally by api-gateway, which is the only service browsers talk to directly.
  // Deployed as its own Render Private Service, not publicly reachable - PORT is whatever
  // Render assigns that service; 3005 remains the local-dev default only. Monnify's webhook
  // (MonnifyController) is reached only via api-gateway's /api/monnify proxy mount.
  const port = process.env.PORT || 3005;
  await app.listen(port as any);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
