# AGENTS.md

## Repository Rules For Codex

This repository contains an active Samyak / Rememo Education SaaS plus root-level static landing pages. Rememo Education SaaS is progressing through multi-tenant SaaS architecture and currently contains primarily Samyak's own operational/class data rather than a broad external SaaS customer base. Development speed may be prioritised more than Rememo Bakery, but student data, authentication, finance, production stability, source control, and Cloudflare production configuration remain protected.

Production portal: https://edu.rememo.in

## Operating Model

- Command Centre: cross-product strategy, architecture, prioritisation, release decisions, and handovers.
- Linear: persistent active roadmap, executable tasks, dependencies, and near-term backlog.
- Education Project chat: detailed Education product, architecture, and implementation discussion.
- Codex/GitHub: repository inspection, implementation, debugging, tests, and code changes.

When a decision creates concrete development work, update Linear where appropriate. Use Linear for active work, near-term executable tasks, dependencies, and meaningful deferred backlog. Do not recreate large amounts of completed historical work as Linear issues.

Do not use `AGENTS.md` as a transient task tracker.

## Core Working Rules

- Inspect relevant code before modifying it. Never guess about existing functionality.
- Prefer root-cause fixes over superficial patches.
- Preserve existing user changes. Do not revert unrelated changes.
- Protect existing class/test data.
- Preserve tenant/institute/branch isolation where the architecture supports it. Preserve verified Organisation/tenant scoping and do not broaden cross-tenant access accidentally. Do not introduce new hard-coded Organisation assumptions where tenant context should be resolved dynamically.
- Do not weaken authentication, authorization, session handling, CORS, Turnstile, OTP, or secret handling to make a feature work.
- Inspect existing D1 migrations and schema before database changes.
- Use migrations rather than ad-hoc destructive database changes where appropriate.
- Do not silently fix unrelated issues.
- Run relevant tests after implementation.
- Never expose secrets from `.dev.vars`, Cloudflare, logs, screenshots, or generated docs.
- Do not commit, push, merge, reset, or rebase unless explicitly requested.
- Prefer isolated branches/worktrees for independent parallel Codex tasks.
- Distinguish verified fact from assumption.
- Make the smallest coherent change and avoid unrelated refactors.
- Report unrelated findings separately.
- Provide exact branch/worktree/SHA evidence when relevant.

Never assume Codex succeeded merely because it says so. Completion evidence should include, where relevant: objective/root cause, files changed, branch/worktree/SHA, migration impact, tests/results, tenant/auth impact, finance/data impact, deployment status, production action still required, and unresolved risks.

## Product And Project State

- Read `AGENTS.md` and `PROJECT_STATE.md` before substantial work.
- `PROJECT_STATE.md` should contain durable technical/project state, not transient task chatter.
- Active chats and Linear hold current executable status.

## Tenancy And Identity Invariants

Treat these as durable architecture:

- Organisation = SaaS tenant.
- Global identity + Organisation membership form the modern authentication foundation.
- Tenant-local historical login/account identity may remain where required for history/audit.
- Centre access is separate from role/capability.
- Multi-centre/franchise access should evolve from the existing tenant/centre model rather than creating a competing tenancy model.

Do not casually redesign these foundations. Preserve tenant/institute/branch isolation where the architecture supports it. Preserve verified Organisation/tenant scoping and do not broaden cross-tenant access accidentally. Do not introduce new hard-coded Organisation assumptions where tenant context should be resolved dynamically.

## Auth And Security Invariants

Admission may provision authentication but must never silently override restricted security states.

Preserve:

- suspended membership remains suspended;
- revoked membership remains revoked;
- disabled account remains disabled;
- login-disabled account remains login-disabled;
- cross-Person identity ownership is never silently transferred;
- student/alumni selectable profile access requires the correct account-person self linkage;
- auth provisioning must not accidentally grant staff/admin/referral privilege;
- no referral/profile object should be created merely to bypass authentication eligibility.

Historical auth repair/backfill is separate from forward admission provisioning. Do not weaken auth/security checks merely to make OTP/login succeed.

## Financial Invariants

Canonical financial truth remains:

- `fee_agreements`
- `fee_agreement_instalments`
- `receipts`
- `receipt_reversals`

Do not create a competing financial ledger. Receipt correction must use immutable linked reversal/correction semantics rather than destructive history editing.

First-payment/class-start threshold comes from the agreed instalment schedule, not a second Organisation-level Minimum Upfront policy unless explicitly redesigned later.

Actual money remains based on effective receipts after reversals. Historical fee agreements remain commercial truth once locked.

## Approval Required

Get explicit owner approval before:

- destructive D1 operations;
- deleting or overwriting existing class/student/test data;
- remote D1 seed/import/apply operations;
- credential, OTP, session, auth, or authorization changes with significant access impact;
- irreversible deployment operations;
- DNS or Cloudflare route changes.
- production Worker deployment;
- D1 write/migration;
- R2 destructive action;
- auth/security-state mutation;
- student/finance repair;
- environment/configuration changes.

A general request such as "implement this", "continue", "fix this", or "proceed" is not permission to deploy or mutate production. A deployment request does not imply authorization for historical repair/backfill. Production repair authorization is separate from code deployment authorization.

## Project Layout

- Root: static Cloudflare Pages landing pages and referral form assets.
- `portal/`: React + TypeScript + Vite frontend and Cloudflare Worker backend.
- `portal/worker/index.ts`: Hono Worker route registration.
- `portal/worker/routes/`: API route handlers.
- `portal/worker/lib/`: domain logic and service helpers.
- `portal/src/`: React application.
- `portal/db/`: Drizzle schema.
- `portal/migrations/`: D1 migrations.
- `portal/seed.sql`: local seed data.

## Verified Commands

Run from `portal/` unless noted.

- Install dependencies: `npm install`
- Start local portal dev server: `npm run dev`
- Typecheck: `npm run typecheck`
- Run tests: `npm run test:run`
- Run watch tests: `npm run test`
- Release gate: `npm run test:release`
- Build portal: `npm run build`
- Preview portal build: `npm run preview`
- Generate Drizzle migration: `npm run db:generate`
- Generate Cloudflare types: `npm run cf-typegen`
- Check migration line endings: `npm run test:migration-line-endings`
- Check migration 0021 locally: `npm run test:d1-migration-0021`
- Check local Wrangler D1 migrations: `npm run test:d1-migration-wrangler-local`
- Local D1 migrations: `npm run db:migrate:local`
- Local D1 seed: `npm run db:seed:local`
- Remote D1 migrations: `npm run db:migrate:remote` requires explicit owner approval.
- Remote D1 seed: `npm run db:seed:remote` requires explicit owner approval.
- Deploy portal Worker: `npm run deploy` requires explicit owner approval.
- Root static page preview from repository root: `python -m http.server 8080`

## Testing Expectations

- For frontend/Worker changes, run `npm run typecheck` and the relevant Vitest tests. Use `npm run test:run` when the change touches shared API, auth, schema-facing behavior, or cross-module flows.
- For migration work, inspect `portal/db/*.ts`, existing `portal/migrations/*.sql`, and migration tests/scripts before editing. Run the relevant migration checks.
- For auth, referral, admission, payment, certificate, trainer, or collection work, add or update focused tests near the touched module.
- `npm run test:release` is the deterministic release gate. Use it for production release evidence.
- Parallel `npm run test:run` may remain useful during development, but machine-load-sensitive parallel timeout failures are not automatically production release blockers.
- Do not repeatedly increase individual test timeouts without evidence of the actual root cause.

Before production release require appropriate evidence such as exact branch/SHA, clean tracked state, deterministic release tests, typecheck, build, `git diff --check` where relevant, migration state/parity, deployment/runtime smoke plan, and rollback/recovery considerations where relevant.

Never claim production readiness merely because implementation or local tests completed.

## Data And Security Notes

- D1 stores sensitive identifiers using hashes/encryption helpers; do not introduce plaintext mobile, Aadhaar, token, or credential storage.
- Production Worker config uses `DB` and `CERTIFICATE_PDFS` bindings. Secrets must be set via Wrangler/Cloudflare secrets, not committed.
- `.dev.vars` is local-only. The build script intentionally avoids leaking it into build output.
- Production CORS for public referrals must stay narrow. Do not add wildcard `*.pages.dev` trust.
- The Google Apps Script folders are archived reference only; current referral and portal flows use Worker + D1.

## D1 And Migration Safety

Do not assume:

- local and production D1 schema are identical;
- a migration was applied because it exists in the repo;
- production migration state matches memory/chat history.

Before production migration/deployment:

- identify exact migration delta;
- verify current production migration head;
- avoid replaying unrelated migrations;
- preserve existing data;
- use forward corrective migrations rather than editing already-applied migration history.

No production migration or data mutation without explicit approval.

## Deployment Posture

The project intentionally does not yet require a production-grade staging process for every small change. Keep iteration fast, but do not skip explicit approval for risky data, auth, credential, D1, or deployment operations.

## Production Repair And Backfill

Historical production repair/backfill must normally follow:

read-only preview -> classify safe/collision/blocked cases -> owner review -> bounded repair implementation -> deterministic tests -> fresh production precheck -> D1 Time Travel bookmark -> minimal canary -> read-only verification -> broader repair only after canary success.

Never bulk-repair production merely because a preview identified eligible records. Never automatically override identity collisions, cross-Person ownership, suspended membership, revoked membership, disabled account, or login-disabled account.

## Source Control And Parallel Development

Use isolated branches/worktrees for meaningful independent work where appropriate.

Before parallel work, check overlap in:

- files/components;
- Worker routes;
- D1 schema/migrations;
- auth/identity;
- financial logic;
- deployment/configuration.

Sequence tasks when overlap is material. Never reset, clean, overwrite, stash/pop, or otherwise disturb another active task/worktree.

Before release:

- identify exact SHA;
- verify ancestry;
- verify clean tracked state;
- reconcile stale branches against newer canonical main where required;
- rerun relevant validation after reconciliation.

## Session Handoff

For substantial sessions report:

- CURRENT
- COMPLETED
- CODEX RUNNING
- REVIEW
- NEXT
- BLOCKED
- LINEAR ISSUE
- BRANCH / SHA
- TESTS / EVIDENCE
- MIGRATION STATUS
- PRODUCTION STATUS
- RISKS

When asked for Command Centre handoff use:

- COMPLETED TODAY
- IN PROGRESS
- CODEX / BRANCH / WORKTREE STATUS
- BLOCKED
- DECISIONS MADE
- NEXT EXECUTABLE TASKS
- NEEDS MY DECISION
- RISKS
