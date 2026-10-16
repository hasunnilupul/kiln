# Kiln — Requirements & Specification

Oct 15, 2026 · @Nilupul Perera

## Overview

Kiln (project codename) is a white-label point-of-sale (POS) system that is configured per client in a central builder and delivered as a compiled, ready-to-run application zip. Source code and setup logic never leave the builder; each client runs their own instance with their own PostgreSQL database.

**MVP goals**

1. Configure a client in the builder: business details, branding, tax, payment methods, outlets, registers and modules.
2. Generate a client-specific compiled build and download it as a zip.
3. Run that zip on any Node.js host with PostgreSQL and complete a full trading day: open shift, sell, print receipt, refund, close shift, view report.

**Users**

| User | Uses | Purpose |
| --- | --- | --- |
| Platform owner | Builder | Creates and configures clients, generates builds, issues licences |
| Client admin / manager | POS admin (Payload admin) | Manages products, stock, staff, settings, reports |
| Cashier | POS checkout screen | Sells, takes payment, prints receipts, opens and closes shifts |

## Finalized decisions

These decisions are settled for the MVP; changing one needs an explicit revision of this document.

| Area | Decision | Why |
| --- | --- | --- |
| Framework | Payload CMS 3 on Next.js (App Router), TypeScript | Code-first schema, admin UI included, one deployable app |
| Database | PostgreSQL, always | One adapter and one migration path for hosted and local installs |
| File storage | Cloudflare R2 or Vercel Blob, selected by env var | POS media is small (logos, product images) |
| Deployment model | One POS instance + one database per client | Full data isolation, per-client configuration |
| Configuration | Done in the builder only; the POS contains no setup code | Setup logic never ships to clients |
| MVP delivery | Next.js standalone build, zipped, downloaded from the builder | Runs on any Node.js host; no Docker in the MVP |
| Build runner | GitHub Actions in the private repo, triggered by the builder | A Next.js build cannot run inside a Vercel function |
| Build storage | Zips stored in R2, downloaded via short-lived signed URLs | No public build links |
| Connectivity | Online only; tills have a reliable connection to the server | Offline sync deferred |
| Client app shell | Browser in app or kiosk mode, or installed PWA | No Electron or Tauri in the MVP |
| Migrations | Compiled into the build, run on startup via the Postgres adapter's `prodMigrations` | No Payload CLI needed on the target host |
| Pricing authority | Server calculates all totals; completed sales are immutable | Tills are never trusted; books stay auditable |
| Payments (MVP) | Cash, external card terminal (cashier confirms), other configurable methods | No terminal SDK integration yet |
| Receipts (MVP) | Browser print, 58 mm or 80 mm layout | ESC/POS printing deferred |
| IP protection | No source in builds, obfuscated server bundle, no source maps, signed licence, licence agreement | Raises the cost of copying; contract covers the rest |
| Testing host | Vercel Hobby for development and testing only | Hobby is non-commercial; move to a paid plan or VPS before the first live client |
| Monorepo | pnpm workspaces + Turborepo | Shared config schema between builder and POS |
| Validation | Zod schema for client config, shared by both apps | One source of truth for config shape |

## MVP scope

The MVP is "config in, zip out, trade for a day": everything needed to configure a client, build their POS and run a full trading day online.

**In scope**

- Builder: owner login with 2FA, client records, setup wizard, versioned client configs, build trigger, build history, zip download, licence issuing
- Build pipeline: config injection, standalone build, obfuscation, licence signing, zip, upload to R2
- POS: staff roles (admin, manager, cashier) with cashier PIN switch
- POS: products with variants and barcodes, categories, stock per outlet with movement history
- POS: checkout with barcode scan, product search and grid, cart, line and cart discounts, tax
- POS: cash, external card and other configured payment methods, split payments, change calculation
- POS: browser-printed receipts, reprint
- POS: refunds against an original sale
- POS: register shifts with opening float, cash-up and variance
- POS: basic reports (sales by day, payment method, product, cashier; shift summaries)
- POS: first-boot seeding from the client config

**Out of scope (MVP)**

- Offline mode and sync
- Docker image and Windows installer targets
- Card terminal SDK integrations
- ESC/POS direct printing and cash drawer control
- Loyalty, gift cards, promotions engine
- Purchase orders, suppliers, stock transfers between outlets
- Restaurant features (tables, kitchen tickets, modifiers)
- Online store, accounting integrations, multi-currency sales
- Vercel prebuilt output target

## System architecture

Three parts with one job each: the builder holds configs and licences, the build runner turns them into a zip, and the client deployment runs the result with its own database.

&#91;embedded content: system architecture · builder, build runner, client deployment\]

The builder never runs a build itself: it triggers the runner, which uploads the zip to R2 and reports status and checksum back. The owner downloads the zip and deploys it on the client host, where tills reach the POS app over HTTPS.

## Client configuration

Each client is described by one `client.config.json`, validated by the shared Zod schema in `packages/client-config`. The builder produces it; the POS reads it at build time (branding assets) and on first boot (seeding). It never contains secrets.

| Section | Fields | Notes |
| --- | --- | --- |
| `schemaVersion` | integer | Bumped on breaking schema changes; POS refuses unknown versions |
| `client` | `id`, `slug`, `legalName`, `displayName`, `address`, `phone`, `email`, `taxRegistrationNo` | `slug` names the build file |
| `locale` | `currency` (ISO 4217), `locale` (BCP 47), `timezone` (IANA), `dateFormat` | One currency and locale per client |
| `branding` | `primaryColor`, `accentColor`, `logo`, `receiptHeader`, `receiptFooter` | Logo copied into `public/` at build |
| `tax` | `pricesIncludeTax`, `rates[]` (`code`, `name`, `ratePercent`), `defaultRateCode` | Rates seeded as `TaxRates` |
| `paymentMethods[]` | `code`, `label`, `type` (`cash`, `card_external`, `qr`, `other`), `enabled`, `requiresReference` | `cash` is required |
| `outlets[]` | `code`, `name`, `address`, `registers[]` (`code`, `name`) | At least one outlet and one register |
| `modules` | `inventory`, `customers`, `discounts`, `multiOutlet` | Feature flags; schema is identical either way |
| `receipt` | `paperWidthMm` (58 or 80), `showTaxBreakdown`, `showCashierName` | Browser print layout |
| `admin` | `email`, `name` | First admin user; password comes from `.env` |

```json
{
  "schemaVersion": 1,
  "client": { "id": "cl_01", "slug": "acme-mart", "legalName": "Acme Mart (Pvt) Ltd", "displayName": "Acme Mart" },
  "locale": { "currency": "USD", "locale": "en-US", "timezone": "UTC", "dateFormat": "yyyy-MM-dd" },
  "branding": { "primaryColor": "#0F766E", "accentColor": "#F59E0B", "logo": "assets/logo.png", "receiptFooter": "Thank you!" },
  "tax": { "pricesIncludeTax": true, "rates": [{ "code": "STD", "name": "Standard", "ratePercent": 18 }], "defaultRateCode": "STD" },
  "paymentMethods": [
    { "code": "cash", "label": "Cash", "type": "cash", "enabled": true },
    { "code": "card", "label": "Card", "type": "card_external", "enabled": true, "requiresReference": true }
  ],
  "outlets": [{ "code": "MAIN", "name": "Main Store", "registers": [{ "code": "R1", "name": "Till 1" }] }],
  "modules": { "inventory": true, "customers": true, "discounts": true, "multiOutlet": false },
  "receipt": { "paperWidthMm": 80, "showTaxBreakdown": true, "showCashierName": true },
  "admin": { "email": "owner@acmemart.example", "name": "Store Owner" }
}
```

The example values are placeholders. Config changes after go-live are made in the POS admin (stored in the database); the config file only seeds an empty database.

## POS functional requirements

The POS has two surfaces: a fast cashier screen at `/pos` and the Payload admin at `/admin` for managers. Requirement IDs are referenced in tickets and tests.

**First boot**

- FR-01: On startup, run pending migrations via `prodMigrations` before serving requests.
- FR-02: If the database is empty, seed settings, branding, tax rates, payment methods, outlets and registers from `client.config.json`.
- FR-03: Create the first admin from `admin` in the config and `INITIAL_ADMIN_PASSWORD` in `.env`; force a password change on first login.
- FR-04: Verify `licence.json` on startup and daily; refuse to serve the POS if invalid, expired or the host does not match.

**Staff and access**

- FR-10: Roles: `admin` (everything), `manager` (catalogue, stock, reports, refunds, shifts), `cashier` (checkout, own shift).
- FR-11: Users are scoped to one or more outlets; data outside their outlets is not visible.
- FR-12: Cashiers can switch user on a till with a 4–6 digit PIN; full login is still required to start a session on a device.
- FR-13: Manager approval (PIN) is required for refunds, discounts above a configured limit, and voiding a cart line after payment has started.

**Catalogue and inventory**

- FR-20: Products have name, SKU, one or more barcodes, category, image, tax rate, price, cost (optional) and active flag.
- FR-21: Products may have variants (e.g. size, colour), each with its own SKU, barcode and price.
- FR-22: Stock is tracked per variant per outlet when the `inventory` module is on.
- FR-23: Every stock change writes a `StockMovement` (sale, refund, adjustment, initial) with user and reason.
- FR-24: Managers can adjust stock with a reason; negative stock is allowed but flagged in reports.

**Checkout**

- FR-30: Add items by barcode scan (keyboard-wedge scanner), search by name/SKU, or tapping the category grid.
- FR-31: Change quantity, remove lines, apply a line or cart discount (amount or percent) when the `discounts` module is on.
- FR-32: Totals, tax and rounding are calculated by the shared pricing module and recalculated on the server at finalisation.
- FR-33: Attach a customer to the sale when the `customers` module is on.
- FR-34: Park and resume carts on the same register.

**Payments and receipts**

- FR-40: Accept any enabled payment method; split a sale across several methods.
- FR-41: Cash: enter tendered amount, show change. Card (external): cashier confirms approval and enters a reference when `requiresReference` is set.
- FR-42: Finalising a sale is one server transaction: validate prices, compute totals, write the sale, decrement stock, assign a sequential sale number per register.
- FR-43: Print a receipt via the browser print dialog using the 58 or 80 mm layout, with branding, tax breakdown and footer.
- FR-44: Reprint any past receipt, marked "REPRINT".

**Refunds**

- FR-50: Refund all or part of a completed sale, by sale number or receipt barcode.
- FR-51: A refund creates a `Refund` record, restocks items (optional per line) and records the payout method.
- FR-52: Completed sales are never edited or deleted.

**Shifts**

- FR-60: A cashier must open a shift on a register (with opening float) before selling.
- FR-61: Closing a shift records counted cash, shows expected cash and variance, and prints a shift summary.
- FR-62: Managers can record cash-in and cash-out movements during a shift with a reason.

**Reports**

- FR-70: Sales summary by day and date range, with gross, discounts, tax, net and refunds.
- FR-71: Breakdown by payment method, product, category, cashier and outlet.
- FR-72: Shift report with float, sales, cash movements, expected and counted cash.
- FR-73: Export any report to CSV.

**Settings**

- FR-80: Admins can edit business details, branding, receipt text, tax rates and payment methods after go-live.
- FR-81: The cashier screen applies branding (logo, primary and accent colours) from settings.

## POS data model

Every client has the same schema; modules only hide features, never add or drop tables. Money is stored as integer minor units (cents), never floats.

**Collections**

| Collection | Key fields | Rules |
| --- | --- | --- |
| `users` | email, name, role, outlets\[\], pinHash, mustChangePassword | Payload auth; PIN stored hashed |
| `outlets` | code, name, address, active | Seeded from config |
| `registers` | code, name, outlet, nextSaleNumber | Sale numbers increment inside the finalisation transaction |
| `categories` | name, parent, sortOrder, colour | Drives the checkout grid |
| `products` | name, sku, category, image, taxRate, hasVariants, active | Base item |
| `product-variants` | product, name, sku, barcodes\[\], price, cost, active | Every sellable item is a variant (simple products have one) |
| `stock-levels` | variant, outlet, quantity | Unique per variant + outlet |
| `stock-movements` | variant, outlet, delta, type, reference, user, reason | Append-only audit trail |
| `customers` | name, phone, email, notes | Optional module |
| `shifts` | register, cashier, openedAt, openingFloat, closedAt, countedCash, expectedCash, variance, status | One open shift per register |
| `cash-movements` | shift, type (in/out), amount, reason, user | Feeds expected cash |
| `sales` | number, register, outlet, shift, cashier, customer, lines\[\], subtotal, discountTotal, taxTotal, total, payments\[\], status, completedAt | Lines snapshot name, SKU, price and tax rate; immutable after completion |
| `refunds` | sale, lines\[\], total, payouts\[\], restock, approvedBy, reason | Never exceeds refundable quantity |
| `tax-rates` | code, name, ratePercent, active | Seeded from config |
| `payment-methods` | code, label, type, enabled, requiresReference, sortOrder | Seeded from config |
| `media` | file, alt | Stored in R2 or Vercel Blob |
| `audit-log` | actor, action, entity, entityId, data, at | Records approvals, adjustments, settings changes |

**Globals**

| Global | Fields |
| --- | --- |
| `system-settings` | business details, currency, locale, timezone, modules, receipt options, seededAt, configSchemaVersion |
| `branding` | logo, primaryColor, accentColor, receiptHeader, receiptFooter |

**Invariants**

- Sales and stock movements are only created through server endpoints (`/api/pos/sales/finalise`, `/api/pos/refunds`), never directly through the REST API.
- `stock-levels.quantity` always equals the sum of that variant's `stock-movements` at that outlet.
- A sale's `total` equals the sum of its payments minus change given.

## Builder requirements

The builder is a private Payload app used only by the platform owner. It stores client configs, triggers builds and hands out downloads; it never runs a build itself.

**Access**

- BR-01: Email + password login with mandatory TOTP 2FA; no self-signup.
- BR-02: Rate-limit login (e.g. 5 attempts per 15 minutes per IP and account) and lock after repeated failures.
- BR-03: Optional IP allowlist via env var.
- BR-04: Every action is written to the builder's audit log.

**Clients and configs**

- BR-10: Create, edit and archive clients (name, slug, contact, notes).
- BR-11: A setup wizard edits the client config in steps: business → locale → branding → tax → payment methods → outlets and registers → modules → receipt → admin user → review.
- BR-12: Every save validates against the shared Zod schema and creates a new immutable config version.
- BR-13: Show a diff between config versions.

**Builds**

- BR-20: "Build" picks a config version and a POS template version (git tag) and triggers the GitHub Actions workflow via the API.
- BR-21: Builds have statuses `queued`, `building`, `succeeded`, `failed`, updated by a signed callback from the workflow.
- BR-22: Each successful build records template version, config version, licence ID, zip size and SHA-256 checksum.
- BR-23: "Download" returns a signed R2 URL valid for 15 minutes; every download is logged.
- BR-24: "Rebuild" creates a new build from any earlier config version.

**Licences**

- BR-30: Issue a licence per client: client ID, allowed hosts, modules, max registers, issued and expiry dates.
- BR-31: Sign licences with the builder's Ed25519 private key, held only in the builder's secret store.
- BR-32: Renew or revoke a licence; revocation takes effect on the next online licence check.

**Builder collections**

| Collection | Purpose |
| --- | --- |
| `users` | Owner account(s) with TOTP secret |
| `clients` | Client records |
| `client-configs` | Versioned configs: client, version, config JSON, createdBy |
| `builds` | Build jobs: client, configVersion, templateVersion, status, zipKey, checksum, logsUrl |
| `licences` | Issued licences: client, payload, signature, expiresAt, revokedAt |
| `audit-log` | Every action with actor and timestamp |

## Build pipeline and zip artifact

One script, `scripts/build-client.ts`, turns a config into a zip; it runs identically on a developer machine and in GitHub Actions. The workflow only wraps it with fetching, uploading and reporting.

**Pipeline steps**

1. Workflow receives `buildId` and a signed token from the builder; fetches the config version and licence from the builder API.
2. Checks out the POS template at the requested git tag and installs dependencies with a frozen lockfile.
3. Validates the config with the shared schema; fails the build on any error.
4. Writes `client.config.json` and copies branding assets (logo, icons, PWA manifest) into the POS app.
5. Runs `next build` with `output: 'standalone'` and production source maps disabled.
6. Obfuscates the server bundle (`.next/standalone/.next/server`) with `javascript-obfuscator`; client bundles stay minified only.
7. Assembles the package folder, writes `licence.json`, `.env.example`, start scripts and `README.txt`.
8. Zips it as `<client-slug>-pos-<template-version>-c<config-version>.zip` and computes its SHA-256.
9. Uploads the zip to R2 under `builds/<client-slug>/` and calls the builder back with status, size and checksum.

**Zip layout**

```
acme-mart-pos-v1.0.0-c3.zip
  server.js            Next.js standalone entry
  .next/               compiled server (obfuscated) and static bundles
  node_modules/        runtime dependencies traced by Next.js
  public/              logo, icons, PWA manifest
  client.config.json   seeding config (no secrets)
  licence.json         signed licence
  .env.example         required environment variables
  start.sh             Linux/macOS start script
  start.bat            Windows start script
  README.txt           install, run and upgrade steps
```

**Environment variables (target host)**

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URI` | Yes | PostgreSQL connection string |
| `PAYLOAD_SECRET` | Yes | Generated at install, at least 32 random bytes |
| `INITIAL_ADMIN_PASSWORD` | First boot | One-time admin password, must be changed on first login |
| `STORAGE_DRIVER` | Yes | `r2` or `vercel-blob` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | If `r2` | Media storage |
| `BLOB_READ_WRITE_TOKEN` | If `vercel-blob` | Media storage |
| `PUBLIC_URL` | Yes | Base URL; checked against the licence's allowed hosts |
| `PORT` | No | Defaults to 3000 |

**Packaging rules**

- No secrets in the zip: only `.env.example`.
- Avoid native modules (no `sharp`) so one zip runs on Linux, macOS and Windows; images are resized client-side before upload.
- The required Node.js version is pinned in `.nvmrc` and stated in `README.txt`.
- Upgrades: stop the app, replace everything except `.env`, start it; migrations run automatically.

## Security and IP protection

Source code and setup logic stay in the builder and the private repo; a delivered build contains only compiled, obfuscated code bound to one client by a signed licence. Compiled JavaScript can still be copied by a determined person, so the licence agreement is part of the protection, not an extra.

**Product protection**

- The POS template contains no setup wizard or config editor; those exist only in the builder.
- Builds ship no TypeScript source, tests or source maps; the server bundle is obfuscated.
- `licence.json` holds client ID, allowed hosts, modules, max registers, issued and expiry dates, signed with Ed25519.
- The POS embeds only the public key; it verifies the signature, expiry and host on startup and every 24 hours.
- Modules not in the licence stay disabled even if enabled in settings; registers beyond `maxRegisters` cannot open shifts.
- Every client signs a software licence agreement forbidding copying, reverse engineering and redistribution.

**Builder security**

- Owner-only access with 2FA, rate limiting, optional IP allowlist and full audit log.
- The licence signing key, GitHub token and R2 credentials are held as environment secrets, never in the database.
- Builder-to-workflow and workflow-to-builder calls are authenticated with short-lived HMAC-signed tokens.
- Build downloads use 15-minute signed URLs; the R2 bucket is private.

**POS application security**

- Role- and outlet-based access control on every collection and endpoint.
- Passwords and PINs hashed; login and PIN attempts rate-limited.
- Prices, discounts and totals recalculated on the server; client-sent totals are ignored.
- Sales and stock movements are append-only; corrections go through refunds and adjustments.
- Approvals, adjustments and settings changes are written to the audit log.
- HTTPS required for any non-localhost deployment.

## Non-functional requirements

The targets below are MVP acceptance thresholds, measured on a typical small VPS (2 vCPU, 4 GB RAM) with the database on the same network.

| Area | Requirement |
| --- | --- |
| Checkout speed | Barcode scan to line in cart under 200 ms; product search under 300 ms with 10,000 variants |
| Finalisation | Sale finalisation under 1 s at the 95th percentile |
| Concurrency | At least 10 registers per instance without errors or duplicate sale numbers |
| Integrity | Finalisation and refunds run in a single database transaction; no partial sales |
| Availability | App restarts cleanly after crash or reboot; migrations are idempotent |
| Backups | `README.txt` documents daily `pg_dump`; backup responsibility is stated in the client agreement |
| Browsers | Latest Chrome and Edge; app mode, kiosk mode and installed PWA |
| Screens | Cashier screen usable from 1024 × 768; touch targets at least 44 px; full keyboard and scanner flow |
| Printing | Receipts render correctly at 58 mm and 80 mm in the browser print dialog |
| Localisation | One locale, currency and timezone per client; all money formatted with the client locale |
| Observability | Structured JSON logs to stdout; `/api/health` returns app, database and licence status |
| Build time | A client build completes in under 10 minutes in GitHub Actions |
| Testing | Pricing, tax, rounding and refund logic at 100% unit test coverage; checkout flow covered by end-to-end tests |

## Repository, stack and conventions

One private monorepo holds both apps, the shared packages and the build script, so a schema change and its consumers land in one commit.

```
kiln/
  apps/
    builder/                 private owner app: clients, wizard, builds, licences
    pos/                     POS template: no setup code
      src/collections/
      src/globals/
      src/endpoints/         finalise-sale, refunds, shifts
      src/app/(pos)/         cashier screen
      src/app/(payload)/     Payload admin
      src/lib/               licence check, seeding, receipts
      src/migrations/
  packages/
    client-config/           Zod schema + types for client.config.json
    pricing/                 pure pricing, tax, rounding functions
    licence/                 licence types, sign (builder) and verify (POS)
    ui/                      shared React components
  scripts/
    build-client.ts          config in, zip out
  .github/workflows/
    build-client.yml
    ci.yml
  CLAUDE.md
```

**Stack**

| Layer | Choice |
| --- | --- |
| Language | TypeScript, `strict` mode |
| App framework | Next.js App Router + Payload CMS 3 |
| Database | PostgreSQL via `@payloadcms/db-postgres` |
| Storage | `@payloadcms/storage-s3` (R2) or `@payloadcms/storage-vercel-blob` |
| UI | React, Tailwind CSS, shadcn/ui |
| Validation | Zod |
| Unit tests | Vitest |
| End-to-end tests | Playwright |
| Monorepo | pnpm workspaces + Turborepo |
| Lint and format | ESLint + Prettier |
| CI and builds | GitHub Actions |
| Build storage | Cloudflare R2 |

**Conventions**

- Branches: `feat/<topic>`, `fix/<topic>`, `refactor/<topic>`, `docs/<topic>`, `test/<topic>`, `perf/<topic>`.
- Commits: Conventional Commits with `feat`, `fix`, `refactor`, `docs`, `test`, `perf`, e.g. `feat: add shift close summary`.
- Money as integer minor units everywhere; format only at the UI edge.
- Business logic lives in `packages/*` as pure, tested functions; endpoints and UI call into it.
- Every collection declares explicit access control; no collection relies on Payload defaults.
- Every schema change ships with a generated migration in the same commit.
- Requirement IDs (FR-xx, BR-xx) are referenced in tests and pull requests.

## Roadmap

The MVP is seven milestones, each ending in something that runs; the build pipeline works from the terminal (M4) before any builder UI exists (M5). Dates are not set yet.

**M0 — Foundation** — done

- [x] Monorepo with pnpm workspaces, Turborepo, TypeScript strict, ESLint, Prettier
- [x] `apps/pos` from the Payload blank template on PostgreSQL; local Postgres via Docker Compose for development only
- [x] CI workflow: lint, typecheck, unit tests
- [x] `CLAUDE.md`, `.nvmrc`, README

Exit: `pnpm dev` starts the POS admin locally; CI is green.

**M1 — Client config and pricing packages** — done

- [x] `packages/client-config`: Zod schema, types, example configs, validation tests
- [x] `packages/pricing`: line totals, discounts, tax inclusive and exclusive, rounding, refunds, with full unit tests
- [x] `packages/licence`: payload type, sign and verify, with tests

Exit: all three packages published inside the workspace with full test coverage of pricing.

**M2 — POS data model and first boot** — done

- [x] All collections and globals from the data model, with access control
- [x] Storage adapter selected by `STORAGE_DRIVER`
- [x] `prodMigrations` wired; initial migration generated
- [x] First-boot seeding from `client.config.json`; first admin with forced password change
- [x] Licence verification on startup and daily

Exit: a fresh database plus a config file produces a seeded, licensed POS admin.

**M3 — Checkout, payments, shifts, refunds** — done

- [x] Cashier screen: login, PIN switch, product grid, search, barcode input, cart, discounts
- [x] Shift open, cash movements, shift close with variance
- [x] `finalise-sale` endpoint with transaction, stock decrement and sale numbering
- [x] Split payments, change calculation, external card confirmation
- [x] Browser receipt at 58 and 80 mm, reprint
- [x] Refunds with manager approval and restock
- [x] Reports with CSV export
- [x] Playwright end-to-end test of a full trading day

Exit: the end-to-end test opens a shift, sells, refunds and closes the shift with correct totals.

**M4 — Build script (config in, zip out)** — done

- [x] `scripts/build-client.ts`: validate, inject config and assets, standalone build, obfuscate, licence, package, zip, checksum
- [x] Start scripts, `.env.example`, `README.txt`
- [x] Verify the zip runs on a clean Linux machine and a clean Windows machine with only Node.js and PostgreSQL

Exit: one command turns an example config into a zip that runs on both platforms.

**M5 — Builder app and remote builds** — in progress

- [x] `apps/builder` with owner login, TOTP 2FA, rate limiting, audit log
- [x] Clients, setup wizard, versioned configs with diff
- [ ] Licence issuing, renewal, revocation
- [ ] `build-client.yml` workflow triggered via the GitHub API with signed callbacks
- [ ] R2 upload, build history, 15-minute signed download links
- [ ] Branding logo upload in the setup wizard (needs the builder's file storage)

Exit: from the browser, create a client, run the wizard, click Build and download a working zip.

**M6 — Hardening and first client readiness**

- [ ] Security review of builder and POS access control
- [ ] Performance check against the non-functional targets
- [ ] Backup and upgrade procedure tested
- [ ] Software licence agreement drafted
- [ ] Production hosting chosen (paid Vercel plan or VPS) for the builder and hosted clients

Exit: a pilot client trades for a full week with no data errors.

## Future work and open questions

These are deliberately deferred; none blocks M0–M4.

**After the MVP**

- Docker image target pushed to a private registry, for hosted clients on a VPS (Coolify or Dokploy)
- Windows installer target: portable Node.js, the build, a Windows service and an app-mode shortcut
- Offline mode for tills, with a local queue and sync
- ESC/POS receipt printing and cash drawer kick via Web Serial or a local print bridge
- Card terminal integrations
- Fleet updates: rebuild all clients on a new template version from the builder
- Purchase orders, suppliers, stock transfers, loyalty, restaurant features

**Open questions**

- [ ] Product name and licence agreement wording
- [ ] Licence checks: offline only, or also an online check-in with a grace period?
- [ ] Pricing model for clients: one-time licence, subscription, or per register
- [ ] Tax rules needed by the first clients: single rate only, or multiple and compound taxes?
- [ ] Receipt printers the first clients use, and whether browser printing is acceptable on them
- [ ] Who runs PostgreSQL and backups for clients hosted on their own machines
- [ ] Production host for the builder once the first client goes live
