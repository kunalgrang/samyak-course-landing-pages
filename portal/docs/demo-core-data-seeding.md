# Controlled Demo Core Data Seeding

`demo-core-v1` seeds a small, deterministic, non-financial operational dataset into the existing Demo Training Institute tenant.

## Target Safeguards

The command is hard-locked to the production D1 database `samyak-student-portal` and the existing demo Organisation:

- Organisation: `org_88ee748d08a14eb1b5201ca88edfa07e`
- Expected name: `Demo Training Institute`
- Expected Centre: `branch_01477474b96d4a9eb3e6bade61c7c035`
- Seed version: `demo-core-v1`

The command blocks normal Organisations, `org_samyak`, inactive Organisations, wrong names, wrong Centres, broken owner shell records, unrelated existing operational data, and partial deterministic seed state.

## Preflight

Read-only preflight:

```bash
npm run maintenance:demo-data -- --remote --preflight --organisation org_88ee748d08a14eb1b5201ca88edfa07e --expected-name "Demo Training Institute" --expected-centre branch_01477474b96d4a9eb3e6bade61c7c035 --seed-version demo-core-v1 --database samyak-student-portal
```

Preflight reports the target shell, seed state, planned counts, financial table counts, and zero-write proof.

## Apply

Apply requires separate explicit product-owner approval and a reason:

```bash
npm run maintenance:demo-data -- --remote --apply --confirm-apply --confirm-production-demo-data --organisation org_88ee748d08a14eb1b5201ca88edfa07e --expected-name "Demo Training Institute" --expected-centre branch_01477474b96d4a9eb3e6bade61c7c035 --seed-version demo-core-v1 --reason "approved controlled demo-core-v1 production seed" --database samyak-student-portal
```

The apply path runs preflight first, writes through a guarded Wrangler D1 SQL file batch, then re-runs preflight. A successful second run returns `ALREADY_SEEDED`.

## What Core V1 Seeds

- Admission option and payment-plan master configuration
- Student, trainer, and alumni roles
- 5 categories and 5 active demo courses
- 3 fictional trainers
- 12 fictional enquiries with follow-up history
- 8 fictional students and 8 enrolments
- 4 batches, 8 batch memberships, 13 completed sessions, and attendance records
- One additive maintenance audit entry

All synthetic people use deterministic IDs and non-deliverable contact identifiers. No synthetic login accounts are created.

## Deliberately Omitted

Core v1 does not seed receipts, receipt reversals, fee agreements, instalments, fee schedule revisions, collection payments, discount approvals with financial effect, referral payouts, partner commissions, external documents, R2 files, outbound messages, additional Organisations, or additional Centres.

Certificates are omitted because canonical issuance includes PDF/storage workflow side effects; demo certificate data should be reviewed separately if needed.

## Idempotency

Rows use deterministic `demo_v1_*` IDs. A complete seed returns `ALREADY_SEEDED` with zero writes on subsequent runs. Partial deterministic state blocks instead of repairing or deleting rows.
