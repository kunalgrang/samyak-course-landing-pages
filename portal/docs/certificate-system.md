# Samyak Certificate System

This branch adds the foundation for Samyak Computer Classes, Sion course-completion certificates.

## Eligibility

An enrolment is certificate-eligible only when it belongs to the Samyak organisation, the linked Person, Student, Course, and Branch exist, the Person is active, the Course is active, and `enrolments.status = 'completed'`. Active and on-hold enrolments are not eligible. Historical completed enrolments with `actual_completion_date` set to `NULL` remain eligible; the system never invents a completion date from course duration.

## Numbering

Certificate numbers are permanent and human-readable:

`SYK-SION-CERT-2026-000001`

The sequence is allocated through the existing `number_sequences` table with an atomic `update ... returning` allocator, scoped by branch and issue year. A database unique index protects `certificate_number`.

## Verification Codes

Each certificate has a separate opaque public verification code such as `SYK-...`. The code is generated with Web Crypto, has a unique database constraint, contains no PII, and is not derived from Person, Student, or enrolment IDs. QR codes contain only the public verification URL.

## Snapshots

Issued certificates store immutable display snapshots: student name, Student ID, course name/code/duration, joining date, optional completion date, issue date, and template version. Later Course Master or Person edits do not alter issued certificate facts.

## Roles

The current app is role-based rather than granular permission-based. This branch keeps that convention:

- Staff roles `owner`, `system_admin`, `admin`, `counsellor`, and `admission_admin` can read and issue.
- Owner can revoke.
- Students and alumni can list and download only certificates for the selected active Person profile.

Future RBAC can split these into `certificates.read`, `certificates.issue`, `certificates.revoke`, and template-management permissions.

## Signature Asset

The supplied Branch Director signature image is stored at `portal/worker/assets/branch-director-signature.png`. It is not placed in `public/` and is not exposed through a predictable public static URL. The PDF renderer uses a generated monochrome render module derived from that image so issued PDFs include the signature while the source asset remains Worker-bundled.

## PDF And Storage

D1 stores certificate metadata and immutable snapshots. The final production target is R2 for immutable PDF objects; no PDF blob/base64 is stored in D1. This branch includes a deterministic snapshot-based PDF generator and `pdf_sha256` storage. Because no `CERTIFICATE_PDFS` R2 binding exists yet, local downloads regenerate from the stored certificate snapshot and template version. Before production issuance, configure an R2 bucket binding and persist the generated PDF bytes at an immutable object key.

Required Cloudflare configuration:

- R2 bucket for certificate PDFs.
- Worker binding, proposed name: `CERTIFICATE_PDFS`.
- `CERTIFICATE_VERIFICATION_ORIGIN`, proposed initial value: `https://go.samyaksion.com`.
- Route coverage for `/verify/*` and `/api/public/certificates/verify/*` on the chosen public hostname.

## Public Privacy

Public verification returns only issuer, student display name, Student ID, course, certificate number, issue date, optional completion date, and certificate status. It does not expose mobile, email, address, DOB, Aadhaar, fees, payments, internal IDs, staff notes, or internal revocation reason. The verification page sets `noindex,nofollow`.

## Revoke And Reissue

Issued certificates are never hard-deleted. Owner revocation records `revoked_at`, `revoked_by_actor_id`, and an internal reason. Public verification then returns revoked status without exposing the internal reason. The schema supports superseding/reissue by linking old and new certificate records; full reissue UI can be added after MVP review.
