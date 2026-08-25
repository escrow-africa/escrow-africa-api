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
  const port = 3001;
  // Bound to loopback only: this service is internal-only, reached exclusively through
  // api-gateway. On Render, all 6 services in this container listen on their own port, and
  // Render's port auto-detection can't tell which one is "the" service - if this bound on all
  // interfaces (the listen() default), Render's scanner could lock onto it after a restart and
  // route external traffic here instead of to the gateway, exactly as happened in production.
  await app.listen(port as any, '127.0.0.1');
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
