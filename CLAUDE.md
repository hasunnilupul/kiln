# Kiln

Kiln (project codename) is a white-label point-of-sale system. Each client is configured in a private **builder** app and receives a compiled, ready-to-run **POS** build as a zip. Source code and setup logic never ship to clients. Each client runs their own POS instance with their own PostgreSQL database.

The full requirements, data model and roadmap live in the "Kiln — Requirements & Specification" document (`docs/requirements-and-specification.md`). Requirement IDs (`FR-xx` for the POS, `BR-xx` for the builder) come from it; reference them in tests and pull requests.

## Architecture

- `apps/builder` — private owner-only Payload app: clients, setup wizard, versioned client configs, licence issuing, build triggering, build downloads. It never runs a build itself.
- `apps/pos` — the POS template. Contains **no setup wizard or config editor**. Reads `client.config.json` only to seed an empty database on first boot.
- `scripts/build-client.ts` — config in, zip out: validate config → inject config and branding assets → `next build` (standalone) → obfuscate server bundle → write licence → package → zip → SHA-256.
- `.github/workflows/build-client.yml` — runs the build script for the builder, uploads the zip to R2, calls the builder back.
- `packages/client-config` — Zod schema and types for `client.config.json`, shared by builder, POS and build script.
- `packages/pricing` — pure pricing, discount, tax and rounding functions.
- `packages/licence` — licence types; signing (builder only) and verification (POS).
- `packages/ui` — shared React components.

Workspace packages use the `@kiln/` scope (e.g. `@kiln/client-config`, `@kiln/pricing`).

## Stack

TypeScript (strict) · Next.js App Router · Payload CMS 3 · PostgreSQL (`@payloadcms/db-postgres`) · storage via `@payloadcms/storage-s3` (Cloudflare R2) or `@payloadcms/storage-vercel-blob` · Tailwind CSS + shadcn/ui · Zod · Vitest · Playwright · pnpm workspaces + Turborepo · GitHub Actions.

## Non-negotiable rules

### Data and money
- Money is always integer minor units (cents). Never floats. Format only at the UI edge.
- The database is always PostgreSQL. Do not add other database adapters.
- Every client has the same schema. Modules (`inventory`, `customers`, `discounts`, `multiOutlet`) only hide features; never add or remove collections or fields based on config.
- Every schema change ships with a generated migration in the same commit. Migrations run on startup via the Postgres adapter's `prodMigrations`.

### Sales integrity
- The server is the pricing authority. `/api/pos/sales/finalise` recalculates everything with `packages/pricing`; totals sent by the till are ignored.
- Sale finalisation and refunds run in a single database transaction: validate, compute, write sale, write stock movements, update stock levels, increment the register's sale number.
- Completed sales and stock movements are append-only. Never update or delete them; corrections go through refunds and stock adjustments.
- Sales and stock movements are created only through custom endpoints, never through Payload's generic REST/GraphQL create.
- Sale lines snapshot name, SKU, unit price and tax rate at the time of sale.

### Access control
- Every collection and endpoint declares explicit access control. Never rely on Payload defaults.
- Roles: `admin`, `manager`, `cashier`. Users are scoped to their outlets.
- Manager PIN approval is required for refunds, discounts above the configured limit, and voids after payment has started.

### Configuration, secrets and builds
- No setup or configuration UI in `apps/pos`. Configuration belongs to `apps/builder`.
- `client.config.json` never contains secrets. Secrets come from `.env` on the target host.
- Builds ship no TypeScript source, tests or source maps. The server bundle is obfuscated.
- Avoid native modules in `apps/pos` (no `sharp`) so one zip runs on Linux, macOS and Windows.
- The licence signing private key exists only in the builder's environment. The POS embeds only the public key.

### Licence enforcement (POS)
- Verify `licence.json` (Ed25519 signature, expiry, allowed host vs `PUBLIC_URL`) on startup and every 24 hours.
- Modules not in the licence stay disabled even if enabled in settings; registers beyond `maxRegisters` cannot open shifts.

## Code conventions

- Business logic lives in `packages/*` as pure functions with unit tests. Endpoints and UI call into it.
- `packages/pricing` keeps 100% unit test coverage (enforced by its Vitest thresholds).
- Library packages compile with `tsc` to `dist/`; `exports` point `types` at `src/` and `default` at `dist/`. Turbo builds them before dependent `dev`, `test` and `build` tasks.
- Import licence signing only from `@kiln/licence/sign` (builder) and verification only from `@kiln/licence/verify` (POS); the root `@kiln/licence` entry has no crypto.
- Validate all external input (config files, request bodies) with Zod.
- Cashier UI lives under `apps/pos/src/app/(pos)/` and must work with keyboard and barcode scanner alone; touch targets at least 44 px.
- Prefer small, focused modules; no barrel files that pull server code into client bundles.

## Git

- `main` is production; `dev` is the integration branch.
- Start every task on a new branch created from `dev`, and merge it back into `dev` when done.
- Delete the task branch after it has been merged.
- Merge `dev` into `main` only when the features in `dev` should go to production.
- Branch names: `feat/<topic>`, `fix/<topic>`, `refactor/<topic>`, `docs/<topic>`, `test/<topic>`, `perf/<topic>` — plain, human-readable names based on the task.
- Commits follow Conventional Commits using `feat`, `fix`, `refactor`, `docs`, `test`, `perf`. Do not use `chore` unless explicitly asked.
  - Examples: `feat: add shift close summary`, `fix: prevent duplicate sale numbers`, `refactor: extract tax rounding`.
- Do not add `Co-authored-by`, `Signed-off-by`, `Generated-by` or any similar trailers or attribution metadata.
- Do not change Git author or committer settings.

## Commands

These are the planned workspace scripts; keep this section in sync as they are added.

```bash
pnpm install                 # install all workspaces
pnpm dev                     # run apps in development
pnpm dev --filter pos        # run only the POS
pnpm build                   # build all apps and packages
pnpm lint                    # ESLint
pnpm typecheck               # tsc --noEmit across workspaces (turbo task: check-types)
pnpm test                    # Vitest tests (POS integration tests need the database)
pnpm test:e2e                # Playwright e2e: own server on :3100 and a fresh <db>_e2e database; stop pnpm dev first
pnpm format                  # Prettier write; format:check in CI
pnpm --filter pos payload migrate:create <name>   # generate a migration after schema changes
pnpm licence:dev             # throwaway localhost licence + public key for development
pnpm licence:keygen          # new builder licence signing key (LICENCE_SIGNING_KEY); printed, never written
pnpm build:client --config <client.config.json> --dev-licence   # client zip from HEAD into dist-clients/ (README: Client builds)
```

Local development uses PostgreSQL via `docker compose up -d db` (development only; client deliveries do not use Docker).

## Environment variables (POS)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URI` | PostgreSQL connection string |
| `PAYLOAD_SECRET` | At least 32 random bytes |
| `INITIAL_ADMIN_PASSWORD` | First-boot admin password; forced change on first login |
| `STORAGE_DRIVER` | `r2` or `vercel-blob`; unset in development stores media on local disk, and a production server refuses to start without one |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Media storage when `STORAGE_DRIVER=r2` |
| `BLOB_READ_WRITE_TOKEN` | Media storage when `STORAGE_DRIVER=vercel-blob` |
| `CLIENT_CONFIG_PATH` | Optional; defaults to `client.config.json` in the working directory |
| `PUBLIC_URL` | Base URL; must match the licence's allowed hosts |
| `LICENCE_PATH` | Optional; defaults to `licence.json` in the working directory |
| `LICENCE_PUBLIC_KEY` | Development only (from `pnpm licence:dev`); production uses the key embedded in `src/lib/licence-public-key.ts` |
| `LICENCE_SERVER_URL` | Development only: builder URL for the daily licence check-in; production uses the URL embedded at build time (empty means offline-only checks) |
| `PORT` | Defaults to 3000 |

## Environment variables (builder)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URI` | PostgreSQL connection string |
| `PAYLOAD_SECRET` | At least 32 random bytes; also seals owners' TOTP secrets, so rotating it forces TOTP re-enrolment |
| `BUILDER_OWNER_EMAIL`, `BUILDER_OWNER_PASSWORD` | First boot creates this owner when there is none (password ≥ 16 characters); TOTP is set up on first sign-in |
| `BUILDER_IP_ALLOWLIST` | Optional addresses/CIDR ranges (BR-03); read from `x-real-ip`/`x-forwarded-for`, so only behind a proxy that sets them. `/api/licence-check` is always open |
| `LICENCE_SIGNING_KEY` | Ed25519 PKCS #8 PEM from `pnpm licence:keygen` (BR-31); required in production. Losing it means existing builds cannot be renewed; replacing it means rebuilding every client |

Builder sign-in goes only through `POST /api/auth/sign-in` (password + TOTP); Payload's own login, forgot/reset-password, first-user creation and GraphQL are disabled.

## Current status

Milestones M0 (foundation), M1 (`client-config`, `pricing`, `licence` packages) M2 (POS data model, storage, migrations, first-boot seeding, licence checks) M3 (shifts, checkout, payments, refunds, receipts, reports, cashier screen) and M4 (scripts/build-client.ts, client-build workflow) are done; next is M5. Roadmap: M0 foundation → M1 config, pricing and licence packages → M2 POS data model and first boot → M3 checkout, payments, shifts, refunds → M4 build script → M5 builder app and remote builds → M6 hardening and first client readiness.

## Out of scope for the MVP

Offline mode, Docker and Windows installer delivery targets, card terminal SDKs, ESC/POS printing, loyalty, purchase orders, restaurant features, multi-currency sales. Do not build these unless the task says so.
