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
  const port = 3005;
  // Bound to loopback only: this service is internal-only, reached exclusively through
  // api-gateway (including Monnify's webhook, proxied via the gateway's /api/monnify mount).
  // On Render, all 6 services in this container listen on their own port, and Render's port
  // auto-detection can't tell which one is "the" service - if this bound on all interfaces
  // (the listen() default), Render's scanner could lock onto it after a restart and route
  // external traffic here instead of to the gateway, exactly as happened in production.
  await app.listen(port as any, '127.0.0.1');
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
