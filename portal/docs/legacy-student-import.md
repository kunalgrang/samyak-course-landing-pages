# Legacy Student / Alumni Import

This importer handles historical Samyak students and alumni from a CSV export of the legacy admission workbook. It is designed for a reviewed dry-run/preflight/apply workflow and must not be used for production writes until the owner approves the production preflight and apply run.

## Source Columns

The CSV must contain exactly:

- `STUDENT FULL NAME`
- `PRIMARY MOBILE NUMBER`
- `COURSE ENROLLMENT`
- `ADMISSION DATE`
- `COURSE STATUS`

Workbook files should be exported to CSV first. No Excel parsing dependency is added to the portal.

## Commands

Dry-run is the default and performs zero database writes:

```sh
npm run import:legacy-students -- --file ./path/to/export.csv --organisation=org_samyak --branch=branch_sion --dry-run
```

Local preflight queries the selected local D1 database for existing-person matches and performs zero writes:

```sh
npm run import:legacy-students -- --file ./path/to/export.csv --organisation=org_samyak --branch=branch_sion --preflight
```

Local apply requires an explicit confirmation flag:

```sh
npm run import:legacy-students -- --file ./path/to/export.csv --organisation=org_samyak --branch=branch_sion --apply --confirm-apply
```

Production read-only preflight is enabled only with the explicit remote preflight flags:

```bash
npm run import:legacy-students -- --file ./path/to/export.csv --organisation=org_samyak --branch=branch_sion --preflight --remote
```

Remote preflight performs SELECT-only Wrangler D1 queries against production, checks every query metadata response for `changed_db = false` and `rows_written = 0`, and does not require the legacy import staging tables to exist. It is designed to work against production schema through migration `0014` and reports `PRODUCTION_COURSE_MIGRATION_REQUIRED` for source courses, such as Spoken English, that are valid locally but not yet deployed remotely.

Remote apply is intentionally unavailable in Phase 2. A future production apply must use a separate owner-approved command or an explicit remote guard such as `--remote --apply --confirm-remote-apply`.

## Matching

The importer groups source rows by normalized name plus normalized Indian mobile number. Shared mobile numbers do not merge people.

Automatic exact match is allowed only when:

- an existing legacy import mapping points to a Person, or
- contact HMAC matches and normalized name is compatible/exact.

Mobile-only matches with a different name become `possible_match_review` and block apply. If a shared contact belongs to another exact source person, the other source person remains `shared_contact_new_person`.

## Student IDs

Imported Student Master rows use the existing `number_sequences` allocator pattern. Ordering is:

1. earliest admission date across that person's imported enrolments
2. deterministic source order for ties

Existing matched students keep their existing Student ID. New local imports use `SYK-SION-000001` style numbers and retry if a stale counter collides with an existing unique student sequence.

## Historical Data

For each source row:

- enrolment admission date = source `ADMISSION DATE`
- enrolment joining date = source `ADMISSION DATE`

For each student:

- student joining date = earliest valid source admission date across that person's imported enrolments

Unknown fields remain null. The importer does not fabricate DOB, gender, address, qualification, fees, payments, completion dates, trainers, batches, admission approvals, or Aadhaar data.

## Status And Roles

Status mapping:

- `IN PROGRESS` -> enrolment `active`, CURRENT
- `ON HOLD` -> enrolment `on_hold`, CURRENT
- `COMPLETED` -> enrolment `completed`

If any enrolment is active/on-hold, CURRENT wins and the student role is assigned. Completed-only people receive the alumni role. Roles are reconciled without duplicates.

## Referral Eligibility

All imported current students and alumni are eligible for Samyak Skill Circle. Apply mode creates or reuses `referrer_profiles`, but it does not create referral links, referral transactions, or reward snapshots. Historical enrolments never generate retrospective referral rewards.

Because the current `referrer_profiles` schema still requires legacy token/link fields, imported profiles receive deterministic disabled placeholder values. No `referral_links` row is created.

## Idempotency And Corrections

`legacy_import_entity_mappings` stores stable mappings:

- legacy student ref -> Person
- legacy student ref -> Student
- legacy enrolment ref -> Enrolment

Legacy refs are based on normalized identity and enrolment-defining fields, not the file checksum. Reapplying the same checksum returns `ALREADY_IMPORTED`. A corrected file with a different checksum reuses existing mappings and does not duplicate people, students, or enrolments.

Correction policy is conservative: mapped historical entities are reused, and immutable/history-sensitive fields are not silently overwritten. Any future safe correction fields must be explicitly designed and tested.

## Transaction And Recovery

Local apply runs in a single SQLite transaction:

1. validate organisation, branch, canonical Course Master, rows, courses, and matches
2. create a legacy import batch
3. apply people, contacts, students, roles, enrolments, referrer profiles, rows, mappings, and a privacy-safe audit event
4. mark the batch applied

If validation fails, no batch or business rows are written. If a write fails, the transaction rolls back. Reruns use the checksum and mapping tables to avoid duplicates.

## Privacy

Dry-run and apply summaries are privacy-safe and do not dump row-level contact PII. Raw mobile numbers must not appear in import batches, import rows, mapping rows, or audit metadata. Contact HMAC and ciphertext are stored only in the existing contact tables and should not be printed in operator reports.

## Rollback

For local testing, recreate the local D1 state and rerun migrations/seed. For future production, take a D1 backup before preflight/apply. If rollback is required, use the `legacy_import_batches` and `legacy_import_entity_mappings` records to identify entities created by a specific batch; do not remove shared pre-existing entities without owner review.
