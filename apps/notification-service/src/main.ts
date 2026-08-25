/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { getKafkaClientConfig } from '@org/kafka';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  // CORS is handled centrally by api-gateway, which is the only service browsers talk to directly.

  // Without this, every @EventPattern handler in this service is dead code: ClientsModule
  // (used elsewhere for kafkaClient.emit) only wires an outbound producer, not an inbound
  // consumer. A distinct groupId per service is required so each service gets its own copy
  // of every broadcast event instead of competing for messages within a shared group.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        ...getKafkaClientConfig('notification-service'),
        retry: { retries: 30, maxRetryTime: 30000 },
      },
      consumer: {
        groupId: 'notification-service-consumer',
      },
    },
  });

  const port = 3004;
  // Bound to loopback only: this service is internal-only, reached exclusively through
  // api-gateway. On Render, all 6 services in this container listen on their own port, and
  // Render's port auto-detection can't tell which one is "the" service - if this bound on all
  // interfaces (the listen() default), Render's scanner could lock onto it after a restart and
  // route external traffic here instead of to the gateway, exactly as happened in production.
  await app.listen(port as any, '127.0.0.1');
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );

  // Kafka may be unavailable (e.g. broker not running locally) - a failed/slow connection
  // must not take down HTTP traffic, so this starts after listen() and its rejection is
  // caught rather than left to crash the process. Inbound events are simply dropped until
  // the broker becomes reachable and this reconnects.
  app.startAllMicroservices().catch((err) => {
    Logger.error(`Kafka consumer failed to start: ${err?.message || err}`);
  });
}

bootstrap();
