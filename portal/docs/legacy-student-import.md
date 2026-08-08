# Legacy Student / Alumni Import Foundation

Phase 1 creates the local-only foundation for importing historical Samyak students and alumni from the legacy admission workbook. It does not import production data.

## Scope

- Adds the Soft Skills category and `SYK-SFT-001` / `SPOKEN ENGLISH` course to the Samyak course master.
- Makes `SPOKEN ENGLISH` eligible for Samyak Skill Circle referrals.
- Adds import audit tables for batches, rows, and source-to-target mappings.
- Provides a dry-run CSV analyser at `npm run import:legacy-students -- --file <path-to-csv>`.
- Keeps apply mode blocked until the reviewed write path is built in a later phase.

## Source Columns

The dry-run CSV must contain these headers:

- `STUDENT FULL NAME`
- `PRIMARY MOBILE NUMBER`
- `COURSE ENROLLMENT`
- `ADMISSION DATE`
- `COURSE STATUS`

Workbook files should be exported to CSV before running the importer. No Excel parsing dependency is added to the portal.

## Course Resolution

The importer resolves exact course codes, exact course names, and the approved legacy aliases:

- `ADVANCE EXCEL` -> `SYK-AEX-001` / `ADVANCED EXCEL`
- `SPOKEN ENGLISH` -> `SYK-SFT-001` / `SPOKEN ENGLISH`

Unknown course values are reported as row-level errors.

## Status Mapping

Legacy statuses map to the existing student master states:

- `IN PROGRESS` -> current student, enrolment `active`
- `ON HOLD` -> current student, enrolment `on_hold`
- `COMPLETED` -> alumni student, enrolment `completed`

Historical enrolments are designed to avoid creating admission drafts, fee agreements, payments, batches, trainer assignments, or approval records unless those source values are explicitly available in a later phase.

## Identity And Matching

Dry-run grouping uses normalised full name plus normalised Indian mobile number. Multiple course rows for the same identity become one proposed student with multiple proposed enrolments.

Existing-person outcomes supported by the analyser are:

- `new_person`
- `exact_existing_match`
- `shared_contact_new_person`
- `possible_match_review`

Ambiguous possible matches require review before any future apply mode can write records.

## Privacy

Dry-run reports do not print raw mobile numbers, email addresses, token values, token hashes, or full referral URLs. Mobile values are masked to the last four digits only, and names are represented by a fingerprint in the privacy-safe report.

## Local Command

```sh
npm run import:legacy-students -- --file ./path/to/export.csv
```

The command prints JSON and includes `writeOperationsPerformed: false`.

Apply mode is intentionally blocked:

```sh
node --experimental-strip-types ./worker/lib/legacy-import.ts --apply --file ./path/to/export.csv
```

## Production Safety

Phase 1 has no production D1 commands, no deployment requirement, and no production import flow. The migration files are additive and must be reviewed before any remote migration is applied.
