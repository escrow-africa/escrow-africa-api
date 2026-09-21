/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  // CORS is handled centrally by api-gateway, which is the only service browsers talk to directly.
  // Deployed as its own Render Private Service, not publicly reachable - PORT is whatever
  // Render assigns that service; 3002 remains the local-dev default only.
  const port = process.env.PORT || 3002;
  await app.listen(port as any);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
