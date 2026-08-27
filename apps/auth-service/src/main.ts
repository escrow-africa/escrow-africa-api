/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import * as bodyParser from 'body-parser';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  // CORS is handled centrally by api-gateway, which is the only service browsers talk to directly.
  // Increase body parser limits and handle aborted requests to reduce raw-body errors
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

  // Log when client aborts the request to make debugging easier
  app.use((_req: any, _res: any, next: any) => {
    app.useGlobalFilters(new AllExceptionsFilter());
    next();
  });
  // Deployed as its own Render Private Service, not publicly reachable - PORT is whatever
  // Render assigns that service; 3001 remains the local-dev default only.
  const port = process.env.PORT || 3001;
  await app.listen(port as any);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
