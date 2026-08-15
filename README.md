# Escrow Africa — Backend

This repository contains the backend services for Escrow Africa, implemented as a NestJS-based Nx monorepo. It powers the auth, wallet, escrow, dispute, notification, and gateway layers that support the platform.

## Architecture Overview

The backend is organized as a set of apps and shared libraries:

- [apps/api-gateway](apps/api-gateway) — central gateway that exposes the public API and proxies requests to downstream services
- [apps/auth-service](apps/auth-service) — authentication, user registration, OTP verification, and account-related flows
- [apps/dispute-service](apps/dispute-service) — dispute creation and lifecycle management
- [apps/escrow-service](apps/escrow-service) — escrow transaction creation and settlement logic
- [apps/notification-service](apps/notification-service) — email and notification delivery
- [apps/wallet-service](apps/wallet-service) — wallet balance and transaction operations
- [apps/agent-service](apps/agent-service) — additional service support for agent-oriented workflows

Shared infrastructure is grouped under [libs](libs), including reusable abstractions for Kafka, PostgreSQL, MongoDB, and Redis integrations.

## Key Technologies

- NestJS + TypeScript
- Nx monorepo tooling
- Prisma with PostgreSQL
- Kafka messaging support
- Passport/JWT-based authentication
- Cloudinary, multer, and nodemailer for media and notification support

## Database

The Prisma schema lives in [prisma/schema.prisma](prisma/schema.prisma), and migrations are stored in [prisma/migrations](prisma/migrations).

Common Prisma commands:

```bash
npx prisma generate
npx prisma migrate status --schema=prisma/schema.prisma
npx prisma migrate deploy --schema=prisma/schema.prisma
```

## Environment Variables

The gateway and services rely on environment configuration for ports and downstream service URLs. Typical values include:

```bash
PORT=3000
AUTH_API_URL=http://localhost:3001
DISPUTE_API_URL=http://localhost:3002
ESCROW_API_URL=http://localhost:3003
NOTIFICATION_API_URL=http://localhost:3004
WALLET_API_URL=http://localhost:3005
AGENT_API_URL=http://localhost:3006
```

## Getting Started

Install dependencies from the repo root:

```bash
npm install
```

Run a single service in development:

```bash
npm run serve:auth
```

Run all backend services together:

```bash
npm run serve:all
```

## Available Scripts

```bash
npm run serve:auth
npm run serve:dispute
npm run serve:escrow
npm run serve:notification
npm run serve:wallet
npm run serve:agent
npm run serve:all
npm run start:gateway
npm run start:all
```

## Notes

- The API gateway runs on port 3000 by default and proxies traffic to the microservices.
- Nx is used to manage project targets and service execution.
- Linting and testing can be run per project with Nx commands such as `npx nx lint <project>` and `npx nx test <project>`.
