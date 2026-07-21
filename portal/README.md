# Samyak Student Portal

Standalone full-stack Cloudflare Workers application for the Samyak Student Portal.

## Architecture

- React, TypeScript, and Vite render the browser application from `src/`.
- `@cloudflare/vite-plugin` builds the React SPA and Worker together.
- `worker/index.ts` runs a Hono API Worker for same-origin `/api/*` routes.
- Cloudflare Worker Static Assets serves the SPA with `single-page-application` fallback.
- Cloudflare D1 stores portal login accounts, person links, sessions, OTP challenges, roles, audit logs, and referral profile links.
- Drizzle ORM owns the TypeScript schema in `db/schema.ts`; `drizzle-kit` generates SQL migrations in `migrations/`.

## Folder Structure

```text
portal/
  src/              React frontend
  worker/           Worker/Hono backend
  db/               Drizzle schema and relations
  migrations/       Generated SQL migrations
  docs/             Architecture notes
  public/           Static headers and logo asset
```

## Referral Storage Boundary

The existing Google Sheet remains temporary referral operations storage because it already powers the live referral workflow. Coding Pass 1 does not change that system. D1 stores portal authentication, sessions, roles, audit records, and the future link between a portal person and the existing external referrer identity.

The browser must not call Apps Script directly. A later Worker route will call the secure Apps Script API server-to-server, then expose only authenticated referral dashboard data to the browser.

## Local Setup

```sh
cd portal
npm install
npm run dev
```

Copy `.dev.vars.example` to `.dev.vars` only for local development and fill real values outside Git.

## Create D1

Create the production D1 database:

```sh
npm exec wrangler d1 create samyak-student-portal
```

Copy the returned `database_id` into `portal/wrangler.jsonc` at:

```jsonc
"database_id": "REPLACE_WITH_D1_DATABASE_ID_AFTER_CREATION"
```

## Local Migrations

```sh
npm run db:generate
npm run db:migrate:local
npm run db:seed:local
```

## Remote Migrations

```sh
npm run db:migrate:remote
npm run db:seed:remote
```

## Secrets Required Later

- `MSG91_AUTH_KEY`
- `MSG91_TEMPLATE_ID`
- `TURNSTILE_SECRET_KEY`
- `REFERRAL_APPS_SCRIPT_URL`
- `REFERRAL_API_SECRET`
- `SESSION_PEPPER`

`VITE_TURNSTILE_SITE_KEY` may be used later as public frontend configuration. Private secrets must never use `VITE_` variables.

## Deployment

```sh
npm run build
npm run deploy
```

After deployment, add `portal.samyaksion.com` as a custom domain for the Worker in Cloudflare and confirm DNS points to the Worker route.

## Coding Pass 1 Scope

MSG91 is deliberately not integrated in Coding Pass 1. No OTP endpoints, real people, mobile numbers, referral tokens, fake referral records, fake financial records, or changes to the live referral system are included.
