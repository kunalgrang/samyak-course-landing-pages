# Samyak / Rememo Education SaaS Project State

LAST UPDATED: 2026-10-09

## Purpose

This file is durable project state for future ChatGPT/Codex sessions. It should describe architecture, product shape, invariants, compatibility constraints, and release cautions that remain useful months from now.

It is not a Linear task list, daily log, branch/SHA tracker, deployment diary, or temporary blocker list.

## Product And Stack

This repository contains root-level static Cloudflare Pages landing pages plus the active Rememo Education SaaS portal in `portal/`.

Production portal: https://edu.rememo.in

The portal uses:

- React / TypeScript / Vite frontend.
- Hono Cloudflare Worker backend.
- Cloudflare D1 with Drizzle schema and migrations.
- Cloudflare R2 where required, including certificate PDFs and session materials.
- Zod validation and Vitest-based automated tests.

The product currently operates mainly with Samyak's own operational/class data and does not yet have a broad external SaaS customer base. Development speed may be higher than Rememo Bakery, but student data, authentication, finance, production stability, source control, and production configuration remain protected.

Do not assume repository `main` equals the currently deployed Worker/runtime unless deployment evidence verifies it. Documentation-only commits may advance canonical `origin/main` without changing production runtime.

## Operating Model

- Command Centre: cross-product strategy, architecture, prioritisation, release decisions, and handovers.
- Linear: persistent active roadmap, executable tasks, dependencies, and near-term backlog.
- Education Project chat: detailed Education product, architecture, and implementation discussion.
- Codex/GitHub: repository inspection, implementation, debugging, tests, and code changes.

Do not use this file as a transient task tracker.

## SaaS Tenancy And Identity

Durable architecture:

- Organisation = SaaS tenant.
- Centre evolves from the former branch concept and remains an operational subdivision of an Organisation.
- Global identity + Organisation membership form the modern authentication foundation.
- Tenant-local login/account identity may remain where needed for history/audit.
- Centre access and role/capability are separate concerns.
- Multi-centre/franchise access should build on the Organisation/Centre model rather than create another tenancy model.

Repository evidence verifies modern `organisations`, `branches`, `global_identities`, `organisation_memberships`, `login_accounts`, `login_account_people`, `login_account_roles`, and `person_roles` structures. It also shows some runtime paths still use the Samyak default tenant context. Do not document hard-coded Organisation assumptions as desired architecture; preserve verified Organisation/tenant scoping and avoid broadening cross-tenant access.

## Authentication And Identity

Current student/auth foundations include OTP-based login, cookie sessions, profile/Organisation selection, global identity, Organisation membership, login account, account-person links, and role records.

Forward admission provisioning should support/reuse:

- global identity;
- login account;
- Organisation membership;
- account-person self link;
- Organisation-scoped student role.

Security invariants:

- suspended membership remains suspended;
- revoked membership remains revoked;
- disabled account remains disabled;
- login-disabled account remains login-disabled;
- admission confirmation must not administratively unlock restricted accounts;
- cross-Person identity ownership must never be silently transferred;
- student/alumni profile access requires the correct self/account-person relationship;
- auth provisioning must not grant staff/admin/referral authority accidentally.

Historical auth repair is separate from forward admission provisioning.

The known Samyak historical cohort affected by the legacy modern-auth gap has been reconciled in production. That cohort now has complete modern auth provisioning: active global identity, active/login-enabled login account, active Organisation membership, same-Person self link, and active student role. Future imports, newly discovered historical records, and records from other Organisations must still be verified on their own evidence before assuming the modern auth path exists.

## Historical Auth Repair

Historical student-auth repair/backfill must normally follow:

read-only preview -> classify safe/collision/blocked cases -> owner review -> bounded repair -> deterministic tests -> fresh production precheck -> D1 Time Travel bookmark -> minimal canary -> read-only verification -> broader cohort only after canary success.

The repository contains bounded tooling for historical student-auth repair. The known Samyak 70-student historical cohort has been fully reconciled in production, with no remaining blocked/manual-review, missing-auth, ambiguous, duplicate normalized identity, different-Person ownership, wrong/non-self-link, or unexpected privilege-escalation cases for that cohort. Future or other-Organisation repair/backfill still requires a fresh read-only preview, owner review, deterministic tests, production precheck, and production evidence before any mutation.

Never use repair/backfill to automatically override identity collisions, cross-Person ownership, suspended membership, revoked membership, disabled account, or login-disabled account.

## Financial Model

Canonical financial truth remains:

- `fee_agreements`
- `fee_agreement_instalments`
- `receipts`
- `receipt_reversals`

Do not create a second ledger. Receipt reversals are immutable linked corrections rather than destructive edits. Financial calculations use effective receipts after reversals.

First-payment/class-start threshold comes from the first/agreed instalment requirement. Historical fee agreements remain commercial truth once locked.

There is no separate Organisation-level "Minimum Upfront Payment" policy in the current model. The redundant operational/UI role of `initialPaymentExpectedPaise` has been retired where verified, but the physical `fee_agreements.initial_payment_expected_paise` column still exists for compatibility/storage and must not be overstated as removed.

## Payment Plan Model

Payment plan policy is stored in `payment_plan_rules`.

Current code-level policy:

- Full payment is always present in the Organisation payment-plan policy surface.
- Optional 2 instalments require a minimum Course duration of at least 2 months.
- Optional 3 instalments require a minimum Course duration of at least 3 months and require 2 instalments to be enabled.
- Flexible instalments use plan type `custom`, require a minimum Course duration of at least 4 months, and require both 2 and 3 instalments to be enabled.
- The policy validator requires 3-instalment minimum duration to be greater than or equal to the 2-instalment duration, and flexible minimum duration to be greater than or equal to the 3-instalment duration.
- Code defines `MAX_PAYMENT_PLAN_INSTALMENTS = 24`; flexible schedule details should be checked in the admission/collections path before changing behaviour.
- Historical locked fee agreements must remain unaffected by later rule changes.

Migrations include Samyak/Demo payment-plan policy adjustments, but repository migration files do not by themselves prove current production D1 state.

## Receipt Reversal And Correction

Released correction model:

- receipt rows are not destructively edited;
- reversal is linked and immutable through `receipt_reversals`;
- financial summaries exclude reversed receipts;
- correction/reversal is owner-only in the current V1 capability surface unless later capability work changes it.

Do not state that a richer Role & Capability V2 exists unless verified.

## Centres And Organisation Access

Verified durable model:

- Organisation is the tenant.
- Centre is stored in `branches` with Centre-specific lifecycle/commercial metadata.
- `centre_commercial_access` stores per-Centre commercial entitlement state.
- Centre access is distinct from global Organisation membership and role/capability.
- New Centre/franchise functionality should extend this model.

Current staff Organisation Settings includes Centre administration and payment-plan settings. Later Centre creation is designed to become operational after subscription/payment verification rather than tenant-controlled activation.

## Certificates And Public Links

The certificate system includes staff issuance/revocation/download, student certificate application/download, public verification, PDF generation/storage, QR verification, and feedback paths.

`CERTIFICATE_PDFS` is the R2 binding for certificate PDFs. `CERTIFICATE_VERIFICATION_ORIGIN` in the current Worker config is `https://edu.rememo.in`, and verification routes include `/verify/:code` plus public certificate API routes. The Worker config also preserves selected `go.samyaksion.com` verification routes for compatibility.

Do not remove legacy verification compatibility without checking current public links/QRs.

Student Certificate Request V1 allows a student to request a certificate only when the enrolment is request-eligible, Person/Student/Course state and ownership are valid, an active fee agreement exists, the agreed fee is fully paid, no active certificate application already exists, and no issued certificate already exists. Current request-eligible enrolment statuses are `confirmed`, `not_started`, `active`, `on_hold`, and `completed`; invalid or non-request states remain excluded, including repository statuses such as `provisional`, `transferred`, `dropped_out`, `cancelled`, and `expired`.

Certificate request full-payment eligibility uses the canonical financial truth: `fee_agreements.final_agreed_fee_paise` as the agreed amount, and recorded `receipts` linked to the fee agreement as the effective paid amount, excluding any receipt with a `receipt_reversals` row. Exact payment qualifies, overpayment remains financially satisfied, reversed receipts do not count, and a missing active fee agreement does not qualify. Do not derive certificate eligibility from Course listed/default fee, current `payment_plan_rules`, a certificate-specific paid flag, or any second ledger.

Student certificate applications do not mark enrolments completed, do not set `actual_completion_date`, and do not issue certificates. Staff approval remains responsible for approving course completion, recording/validating the actual completion date, and transitioning the enrolment to completed where appropriate. Certificate issuance remains completion-gated and requires the enrolment to be completed. A certificate request should not be treated as proof of academic completion.

## Demo Organisation Safety

Repository evidence verifies an `organisation_kind` field with `normal` / `demo`, demo maintenance tooling, and tests ensuring demo classification does not bypass normal Organisation membership boundaries.

Remote demo maintenance/data apply paths require explicit confirmation flags. Do not let demo operational messaging or financial/communication side effects silently behave like production customer messaging unless that behaviour is explicitly designed and verified.

## Major Implemented Domains

Repository evidence confirms these major domains exist:

- enquiries / CRM follow-ups;
- admissions and admission confirmation;
- student directory/profile;
- fee agreements, collections, receipts, and receipt reversals;
- batches and batch memberships;
- trainers, trainer portal, attendance, session logs, and materials;
- academic operations;
- referrals and rewards;
- education partners and partner portal;
- certificates and public verification;
- Organisation settings, Centre administration, and Organisation payment-plan policy;
- SaaS signup/onboarding foundations;
- student portal authentication, dashboard, learning, certificates, referrals, rules, and profile.

Inspect routes, UI, tests, migrations, and services before assuming the exact behaviour of any domain.

## Release Testing

`npm run test:release` is the deterministic production release gate. The release runner discovers test files and runs them sequentially with Vitest using `--no-file-parallelism --maxWorkers=1`.

Parallel `npm run test:run` remains useful during development, but machine-load-sensitive parallel timeout failures are not automatically production release blockers. Do not keep raising individual timeouts without root-cause evidence.

Before production release expect appropriate evidence:

- exact branch/SHA;
- clean tracked state;
- deterministic release tests;
- typecheck;
- build;
- `git diff --check` where relevant;
- migration state/parity;
- production smoke plan;
- rollback/recovery consideration where relevant.

Never claim production readiness merely because implementation or local tests completed.

## D1, Migrations, And Production Release

Durable rules:

- repository migration files do not alone prove production migration state;
- verify current production migration head before release;
- use forward corrective migrations rather than editing already-applied migration history;
- avoid unrelated migration replay;
- preserve existing production data;
- production migration requires explicit owner authorization.

Repository migration history advances over time and must not be treated as proof of the current production D1 migration head. Verify both repository and production migration state during release preparation.

Canonical Git `main` and the deployed production runtime must always be verified independently before release work. Documentation-only commits can make source history differ from the currently deployed runtime without changing application behavior, so do not infer deployment identity from Git history alone.

## Local And Source Control Working Model

- Use separate branches/worktrees for meaningful independent work.
- Never reset, clean, overwrite, stash/pop, or otherwise disturb another active task/worktree.
- Inspect exact migration/auth/finance overlap before parallel changes.
- Sequence tasks when overlap is material.
- Reconcile stale branches to newer canonical main before release.

## Known Deferred Architecture

Include these only as broad architectural direction, not immediate task status:

- richer Role & Capability model;
- configurable permissions;
- more complete franchise/multi-centre access;
- broad external SaaS rollout;
- dedicated staging environment before external customer scale.

## Important Do-Not-Assume Items

Future sessions should not assume:

- future imports, newly discovered legacy records, or other Organisations have modern auth provisioning merely because the known Samyak historical cohort has been reconciled;
- repo migrations equal production D1 state;
- `origin/main` equals current deployed Worker;
- receipt rows can be destructively corrected;
- an auth repair can override blocked/restricted states;
- a production deployment authorizes a historical data repair;
- Centre access and role are the same concept;
- historical fee agreements should be recalculated from current payment-plan rules;
- hard-coded Organisation defaults are desired architecture where tenant context should be resolved dynamically.
