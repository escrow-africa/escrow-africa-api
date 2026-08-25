/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { createProxyMiddleware } from 'http-proxy-middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.enableCors({
    origin: (process.env.FRONTEND_URL || 'http://localhost:3006').split(','),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  // Configure service base URLs centrally and expose to controllers via Express locals
  const server: any = app.getHttpAdapter().getInstance();
  const serviceBases = {
    auth: process.env.AUTH_API_URL,
    disputes: process.env.DISPUTE_API_URL,
    escrow: process.env.ESCROW_API_URL,
    // Mount key must match notification-service's @Controller('notifications') (plural) —
    // the singular key previously here meant any HTTP route added to that controller (there
    // were none until now, only Kafka @EventPattern handlers) would 404 through the gateway.
    notifications: process.env.NOTIFICATION_API_URL,
    wallet: process.env.WALLET_API_URL,
    agent: process.env.AGENT_API_URL,
    // WhatsappController lives inside dispute-service (@Controller('whatsapp')) alongside
    // DisputeController, but under a different route prefix — without this mount, inbound
    // Meta/360dialog webhook callbacks to /api/whatsapp/* 404 at the gateway and never reach
    // dispute-service, making the WhatsApp dispute bot (including the AI review trigger)
    // completely unreachable from outside the cluster.
    whatsapp: process.env.DISPUTE_API_URL,
  };
  server.locals.serviceBases = serviceBases;

  // Register proxy middleware for each service under /api/<service>
  Object.entries(serviceBases).forEach(([key, target]) => {
    if (!target) {
      // A missing target (e.g. AGENT_API_URL unset because that service isn't deployed in this
      // environment) must not take down the whole gateway - createProxyMiddleware() throws
      // synchronously on an undefined target, which previously crashed bootstrap() entirely and,
      // via concurrently -k, killed every other service along with it.
      console.warn(`Skipping proxy mount for ${key}: no target URL configured`);
      return;
    }
    console.log(`Setting up proxy for ${key} at /api/${key} -> ${target}`);
    if (String(target).endsWith('/api')) {
      console.warn(`Target for ${key} includes trailing /api — proxied paths may double-up. Consider removing /api from the target URL.`);
    }
    const mount = `/${globalPrefix}/${key}`;
    console.log(`Mounting proxy ${mount} -> ${target}`);
    const shouldStripApi = String(target).endsWith(`/${globalPrefix}`);
    server.use(
      mount,
      createProxyMiddleware({
        target,
        changeOrigin: true,
        ws: true,
        logLevel: 'warn',
        pathRewrite: shouldStripApi ? { [`^/${globalPrefix}`]: '' } : undefined,
        onProxyReq(proxyReq, req) {
          // ensure host header points to target
          proxyReq.setHeader('host', new URL(String(target)).host);
          // forward incoming Authorization header (if present) to downstream service
          const auth = (req as any).headers?.authorization || (req as any).headers?.Authorization;
          if (auth) {
            proxyReq.setHeader('authorization', String(auth));
          }
        },
      })
    );
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
