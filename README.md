# Escrow Africa — Backend (Nx Monorepo)

This repository contains the backend services for the Escrow Africa platform implemented as a set of NestJS microservices in an Nx monorepo.

Key artifacts
- **Workspace config:** [nx.json](nx.json)
- **Root scripts & dependencies:** [package.json](package.json)
- **Database schema:** [prisma/schema.prisma](prisma/schema.prisma)

Overview
This workspace uses Nx to organize multiple NestJS services and shared libraries. Services are located under `apps/` and reusable packages under `libs/`. The project uses TypeScript, Prisma for Postgres, and additional integrations (Kafka, Redis, Mongo where applicable).

Architecture & Services
- **API gateway**: `apps/api-gateway` — Express-based NestJS app that reverse-proxies service routes to downstream services using environment-configured service URLs. Default port: 3000. See [apps/api-gateway/src/main.ts](apps/api-gateway/src/main.ts).
- **Auth service**: `apps/auth-service` — authentication, user management, OTP; default port: 3001. See [apps/auth-service/src/main.ts](apps/auth-service/src/main.ts).
- **Dispute service**: `apps/dispute-service` — dispute lifecycle management; default port: 3002.
- **Escrow service**: `apps/escrow-service` — core escrow flows and payments; default port: 3003. See [apps/escrow-service/src/main.ts](apps/escrow-service/src/main.ts).
- **Notification service**: `apps/notification-service` — emails, transactional notifications; default port: 3004.
- **Wallet service**: `apps/wallet-service` — user wallets and balances; default port: 3005.

Shared Libraries
- `libs/common` — minimal shared utilities and re-exports. See [libs/common/src/index.ts](libs/common/src/index.ts).
- `libs/kafka`, `libs/postgres`, `libs/mongodb`, `libs/redis` — scaffolds for infra integrations. Check each package for exports and usage.

Data Model (Prisma)
- The canonical Postgres data model lives in [prisma/schema.prisma](prisma/schema.prisma). Models include `User`, `Otp`, `Escrow`, `Payment`, `Transaction`, `Dispute`, `Wallet`. Enums cover statuses and types used across services.

Integrations & Dependencies
- **Databases:** Postgres (Prisma) is primary. `mongoose` is also present; verify which services use Mongo.
- **Messaging:** `kafkajs` is included; `libs/kafka` contains a packaged scaffold.
- **Cache / fast storage:** Redis library scaffold present under `libs/redis`.
- **Auth & security:** `passport`, `passport-jwt`, `passport-local`, `@nestjs/jwt`, and `bcryptjs`.
- **File uploads & storage:** `multer` and `cloudinary`.
- **Email:** `nodemailer`.

Build & Run (local)
The workspace is Nx-based. Common workflows:

Install dependencies (root):
```bash
npm install
```

Run a single service in development (example: auth):
```bash
npm run serve:auth
```

Run all services locally (concurrently):
```bash
npm run serve:all
```

Serve builds (run distributed/production-like): first build, then start specific service:
```bash
npx nx build api-gateway
npm run start:gateway
```

Notes on environment variables
- The API gateway expects service base URLs via environment variables: `AUTH_API_URL`, `DISPUTE_API_URL`, `ESCROW_API_URL`, `NOTIFICATION_API_URL`, `WALLET_API_URL` (these are attached to Express locals at runtime).
- Individual services read `PORT` and other service-specific config using `@nestjs/config`.

Database migrations
- Migrations are tracked under `prisma/migrations` — use Prisma CLI for status and applying migrations:
```bash
npx prisma migrate status --schema=prisma/schema.prisma
npx prisma migrate deploy --schema=prisma/schema.prisma
```

Testing & Linting
- Tests use NestJS testing utilities where present. Run Nx targets or `npx nx test <project>` when tests are defined.
- Linting and formatting via ESLint and Prettier (configs in workspace root). Use `npx nx lint <project>`.
