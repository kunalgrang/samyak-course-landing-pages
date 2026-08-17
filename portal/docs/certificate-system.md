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

D1 stores certificate metadata, immutable snapshots, the private `pdf_storage_key`, and `pdf_sha256`. PDF blobs/base64 are never stored in D1. Production issuance requires the private R2 binding `CERTIFICATE_PDFS`; if the binding is missing, issuance fails before any certificate row is inserted.

Production PDF objects are stored in the private R2 bucket `samyak-certificates` with deterministic, non-PII keys:

`certificates/org_samyak/branch_sion/2026/syk-sion-cert-2026-000001.pdf`

The key uses organisation, branch, issue year, and certificate number only. Student names, phones, emails, internal Person IDs, and enrolment IDs are not included. Object uploads set `Content-Type: application/pdf`, attachment disposition metadata, and custom metadata for certificate id, number, and SHA-256.

Issuance generates the certificate number, verification code, PDF bytes, SHA-256, and storage key first. It uploads the PDF to R2 before inserting the issued certificate row, so the database never exposes an issued certificate whose PDF upload already failed. If the R2 upload succeeds but the D1 insert fails, the Worker attempts to delete the private object before returning the error. A concurrent double-click or retry after a successful insert returns the existing issued certificate for the enrolment.

Staff and student downloads are Worker-mediated through authenticated routes. The Worker reads the private R2 object and returns an attachment response; there is no public R2 bucket, public object URL, or public PDF download endpoint. Local/test execution can inject the memory storage adapter. Non-production environments without R2 may regenerate a PDF from the stored snapshot for developer convenience, but production does not use that fallback.

Configured Cloudflare resources in `wrangler.jsonc`:

- R2 bucket binding `CERTIFICATE_PDFS` -> `samyak-certificates`.
- `CERTIFICATE_VERIFICATION_ORIGIN=https://go.samyaksion.com`.
- Narrow route coverage for `/verify/*` and `/api/public/certificates/verify/*` on `go.samyaksion.com`.

## Public Privacy

Public verification returns only issuer, student display name, Student ID, course, certificate number, issue date, optional completion date, and certificate status. It does not expose mobile, email, address, DOB, Aadhaar, fees, payments, internal IDs, staff notes, or internal revocation reason. The verification page sets `noindex,nofollow`.

## Revoke And Reissue

Issued certificates are never hard-deleted. Owner revocation records `revoked_at`, `revoked_by_actor_id`, and an internal reason. Public verification then returns revoked status without exposing the internal reason. The schema supports superseding/reissue by linking old and new certificate records; full reissue UI can be added after MVP review.
