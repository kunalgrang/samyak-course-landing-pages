# Demo Organisation safety controls

Internal demo tenants use the same authentication, membership, session, Centre, role, trial, and tenant-local finance paths as any normal Organisation. Demo status is metadata only; it must never be used as an authorization shortcut or as an Organisation ID/name special case.

## Classification

`organisations.organisation_kind` is the source of truth. Supported values are:

- `normal`
- `demo`

The column defaults to `normal`, so existing production Organisations and ordinary signups remain normal. The signup API does not accept a demo flag and explicitly inserts ordinary signups as `normal`.

## Controlled setup

A future demo tenant should be created through the ordinary signup/onboarding flow, then marked `demo` through a controlled platform-admin or maintenance action. The initial helper is `markOrganisationDemoForControlledSetup`, which updates the metadata and writes an audit log entry. There is no tenant self-service control.

Do not reuse the Phase 4 smoke-test signup identity for a demo tenant unless the owner explicitly authorises that later.

The production maintenance command is intentionally not exposed through HTTP. It can only classify an existing, active Organisation after a read-only preflight confirms the exact Organisation ID, expected name, current kind, Centre count, membership count, and commercial access state:

```sh
npm run maintenance:organisation-demo -- --remote --preflight --organisation <ORG_ID> --expected-name "Demo Training Institute"
```

The write path is locked to the production D1 database `samyak-student-portal` and requires all confirmation flags plus an audit reason:

```sh
npm run maintenance:organisation-demo -- --remote --apply --confirm-apply --confirm-production-demo --organisation <ORG_ID> --expected-name "Demo Training Institute" --reason "Approved controlled demo tenant setup"
```

The command only changes `organisations.organisation_kind` from `normal` to `demo` for the exact active Organisation/name pair and writes one `organisation_marked_demo` audit row with maintenance actor IDs left null. If the Organisation is already `demo`, it reports `ALREADY_DEMO` and does not write another audit row.

## Messaging

Platform authentication OTP remains allowed for both normal and demo Organisations.

Tenant-originated operational messaging must call the demo safety policy before sending SMS, WhatsApp, email, or push messages. For demo Organisations, the current policy blocks tenant operational messaging by default. Future integrations may add explicit allowlists or sandbox redirects, but arbitrary student/customer messaging must remain blocked for demo tenants unless a platform admin deliberately enables a safe test path.

## Billing and metrics

`organisation_commercial_access` remains the commercial access source of truth. Demo status is not a second billing table.

Future subscription invoices, trial-to-paid automation, customer/revenue KPIs, collection reminders, and business dashboards must exclude `organisation_kind = 'demo'` unless they are explicitly reporting demo activity.

## Tenant and finance isolation

Demo Organisations keep normal membership/session boundaries. A demo user can only access Organisations where they have active membership, and Samyak users do not receive demo access unless explicitly added as members.

Tenant operational finance remains scoped by Organisation/Centre. Demo receipts or payments, if created in a later authorised phase, would be tenant-local demo data and would not share Samyak operational finance rows. SaaS billing remains separate from tenant student-fee finance.
