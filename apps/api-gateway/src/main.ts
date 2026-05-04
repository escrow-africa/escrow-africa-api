/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { createProxyMiddleware } from 'http-proxy-middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  app.enableCors();
  // Configure service base URLs centrally and expose to controllers via Express locals
  const server: any = app.getHttpAdapter().getInstance();
  const serviceBases = {
    auth: process.env.AUTH_API_URL,
    dispute: process.env.DISPUTE_API_URL,
    escrow: process.env.ESCROW_API_URL,
    notification: process.env.NOTIFICATION_API_URL,
    wallet: process.env.WALLET_API_URL,
  };
  server.locals.serviceBases = serviceBases;

  // Register proxy middleware for each service under /api/<service>
  Object.entries(serviceBases).forEach(([key, target]) => {
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
        onProxyReq(proxyReq, req, res) {
          // ensure host header points to target
          proxyReq.setHeader('host', new URL(String(target)).host);
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
