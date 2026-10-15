# Kiln

White-label point-of-sale system. Each client is configured in a private builder app and receives a compiled, ready-to-run POS build. See [`docs/requirements-and-specification.md`](docs/requirements-and-specification.md) for requirements, data model and roadmap, and [`CLAUDE.md`](CLAUDE.md) for project rules.

## Repository layout

```
apps/
  pos/                      POS template (Payload CMS 3 on Next.js)
packages/
  client-config/            Zod schema and types for client.config.json, with example configs
  eslint-config/            shared ESLint preset for library packages
  typescript-config/        shared tsconfig presets
docker-compose.yml          local PostgreSQL (development only)
```

`apps/builder`, `packages/pricing`, `packages/licence`, `packages/ui` and `scripts/build-client.ts` arrive in later milestones.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- pnpm 10 (pinned via `packageManager` in `package.json`; `corepack enable` picks it up)
- Docker, for the local PostgreSQL database

## Getting started

```bash
pnpm install
docker compose up -d db
cp apps/pos/.env.example apps/pos/.env   # then set PAYLOAD_SECRET
pnpm dev --filter pos
```

Open `http://localhost:3000/admin` and create the first user. If port 3000 is taken, Next.js picks the next free port; set `PORT` to choose one.

## Scripts

| Command             | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `pnpm dev`          | Run apps in development                                        |
| `pnpm build`        | Build all apps and packages                                    |
| `pnpm lint`         | ESLint                                                         |
| `pnpm typecheck`    | `tsc --noEmit` across workspaces                               |
| `pnpm test`         | Vitest tests (POS integration tests need the database running) |
| `pnpm test:e2e`     | Playwright end-to-end tests                                    |
| `pnpm format`       | Format with Prettier                                           |
| `pnpm format:check` | Check formatting                                               |

Library packages under `packages/` compile with `tsc` to `dist/`; Turborepo builds them before the apps and tests that depend on them.

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck and tests against a PostgreSQL service container.
