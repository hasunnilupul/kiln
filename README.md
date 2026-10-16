# Kiln

White-label point-of-sale system. Each client is configured in a private builder app and receives a compiled, ready-to-run POS build. See [`docs/requirements-and-specification.md`](docs/requirements-and-specification.md) for requirements, data model and roadmap, and [`CLAUDE.md`](CLAUDE.md) for project rules.

## Repository layout

```
apps/
  pos/                      POS template (Payload CMS 3 on Next.js)
packages/
  client-config/            Zod schema and types for client.config.json, with example configs
  eslint-config/            shared ESLint preset for library packages
  licence/                  licence schema; Ed25519 signing (`/sign`, builder) and verification (`/verify`, POS)
  pricing/                  pure pricing, discount, tax, rounding, payment and refund functions
  typescript-config/        shared tsconfig presets
docker-compose.yml          local PostgreSQL (development only)
```

`apps/builder`, `packages/ui` and `scripts/build-client.ts` arrive in later milestones.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- pnpm 10 (pinned via `packageManager` in `package.json`; `corepack enable` picks it up)
- Docker, for the local PostgreSQL database

## Getting started

```bash
pnpm install
docker compose up -d db
cp apps/pos/.env.example apps/pos/.env   # then set PAYLOAD_SECRET and INITIAL_ADMIN_PASSWORD
cp packages/client-config/examples/acme-mart.client.config.json apps/pos/client.config.json
pnpm dev --filter pos
```

On first start the POS seeds the empty database from `client.config.json` (settings, branding, tax rates, payment methods, outlets, registers) and creates the admin from its `admin` section. Open `http://localhost:3000/admin`, sign in with that email and `INITIAL_ADMIN_PASSWORD`, and set a new password when asked. If port 3000 is taken, Next.js picks the next free port; set `PORT` to choose one.

Without a `licence.json`, development runs unlicensed. To exercise the licence check, run `pnpm licence:dev` and add the two lines it prints to `apps/pos/.env`. `GET /api/health` reports app, database and licence status.

In development the schema is pushed straight to the database. After a schema change, generate its migration with `pnpm --filter pos payload migrate:create <name>`; production servers run pending migrations on startup.

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

End-to-end tests (`pnpm test:e2e`) start their own POS on port 3100 (`E2E_PORT`) against a fresh `<database>_e2e` database, seeded from the example config, and drive a full trading day in Chromium. Stop `pnpm dev` first: Next.js runs one dev server per app. Install the browser once with `pnpm --filter pos exec playwright install chromium`.

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck and tests against a PostgreSQL service container.

## Client builds

Each client receives a zip built from a committed template version and their `client.config.json`. In normal use the builder (M5) triggers this in GitHub Actions; the same command runs locally for testing:

```bash
pnpm build:client --config packages/client-config/examples/acme-mart.client.config.json --dev-licence
```

It checks out the commit (`--ref`, default `HEAD`) into a temporary worktree, so uncommitted changes are not included and your working copy is untouched. It writes `dist-clients/<slug>-pos-<template version>-c<config version>.zip` and a `.sha256` next to it, and prints a JSON summary on the last line. The zip contains the compiled, obfuscated server with its dependencies (no TypeScript, source maps or native modules), `client.config.json`, `licence.json`, `.env.example`, `start.sh`, `start.bat` and `README.txt`, and runs anywhere with Node.js 22.9+ and PostgreSQL.

`--dev-licence` signs a throwaway licence for `localhost` that lasts 30 days, for testing only. Real builds pass the builder's signed licence and public key: `--licence licence.json --public-key public.pem`, plus `--licence-server <builder URL>` for the daily licence check-in. Other options: `--template-version`, `--config-version`, `--out`, `--keep-workdir`.

### Builds from the builder

The client's **Builds** tab picks a config version and a template version (a git tag) and dispatches `.github/workflows/build-client.yml` through the GitHub API with the build id and a 3-hour build token. The workflow fetches the job (config, licence, public key) from `/api/builds/:id/job`, reports `building`, runs `build-client.ts` at the tag, uploads the zip and its `.sha256` to R2 under `builds/<client-slug>/`, and reports `succeeded` (size, checksum, commit) or `failed` to `/api/builds/:id/callback`. Builds that never report back are marked failed when their token expires. `scripts/remote-build.ts` is the workflow's side of these calls.

One-time setup:

1. Tag a template version, e.g. `git tag v1.0.0 && git push --tags`; only tags can be built.
2. In the GitHub repository: variable `BUILDER_URL` (the builder's public base URL) and secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (a private bucket).
3. A fine-grained personal access token for this repository only, with **Actions: read and write** and **Contents: read**.
4. In the builder's environment: `GITHUB_TOKEN` (that token), `GITHUB_REPOSITORY` (`owner/name`), `BUILDER_PUBLIC_URL`, and `LICENCE_SIGNING_KEY`. Optional: `GITHUB_WORKFLOW_FILE` (default `build-client.yml`), `GITHUB_WORKFLOW_REF` (default `main`, the branch whose workflow and build script run).

`.github/workflows/client-build.yml` builds the example client on Linux, then runs that zip on clean Linux and Windows runners (only Node.js and PostgreSQL) and checks health, licence, sign-in and branding with `scripts/smoke-check-client.mjs`.
