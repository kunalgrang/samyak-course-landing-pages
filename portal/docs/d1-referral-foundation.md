# D1 Referral Foundation

This phase adds the database and pure-domain foundation for Samyak Skill Circle referrals. It does not cut over the public form, portal dashboard, OTP eligibility lookup, staff UI, Apps Script runtime calls, Google Sheet import, partner organisations, reward approvals, or payouts.

`referrer_profiles` remains the identity/profile table. The existing `external_referrer_id`, `referral_token`, `personal_link`, and `last_synced_at` columns are preserved as legacy Apps Script-era sync fields so current auth/session behavior is not broken. New public referral credentials must be stored in `referral_links` as keyed lookup hashes only; raw tokens and full public URLs are not stored in the new schema.

`referrals.enquiry_id` is the canonical referral-to-enquiry link. `enrolments.referral_id` captures immutable confirmed-admission attribution. `enrolments.referrer_profile_id` remains a denormalised convenience and is indexed, but the existing column is not rebuilt in this additive migration.

Programme referrer eligibility is represented by `referral_programme_referrer_types`. Samyak Skill Circle seeds exactly two eligible referrer types: `student` and `alumni`. Institute partners are intentionally out of scope for this phase.

Course eligibility is intentionally unseeded. The published referral programme names course examples through the current Apps Script Course sheet, but the D1 Course Master does not yet have a reliable canonical rule for which rows should be referral-eligible. Staff configuration or an import phase should populate `referral_programme_courses`.

Reward slab non-overlap is a service invariant. SQLite check constraints cover non-negative values and row-local min/max validity, while `validateRewardSlabNonOverlap` rejects overlaps before service writes.

The next service phase should reuse `normalizeIndianMobile`, `hmacHex`, and `encryptText` for prospect contact handling: normalise mobile server-side, store lookup HMAC, encrypt operational contact values only where needed, keep last four for masked display, and avoid full contact values in logs, events, snapshots, or metadata.

## Native Referral Service Contract

`issueReferralLink` generates a 256-bit URL-safe token and returns the raw token only on first issuance. D1 stores `token_hash`, `token_last_four`, `link_version`, status, activation, and expiry metadata. The hash is an HMAC using the dedicated `REFERRAL_TOKEN_PEPPER` secret with the domain-separated input `samyak-referral-link:v1:<raw-token>`. The raw token, full public URL, and token hash are not written to audit metadata.

`REFERRAL_TOKEN_PEPPER` is a Worker-only secret. It is not a React value, not stored in D1, not committed, and not a replacement for `SESSION_PEPPER`, OTP provider credentials, `PORTAL_APPS_SCRIPT_SECRET`, or any referral API shared secret.

The service permits one active link per organisation, programme, and referrer profile. Migration `0013_referral_service_integrity.sql` adds a partial unique index for that invariant. Re-issuing an already active link returns link metadata without the unavailable raw token; rotation should be implemented as a separate revoke-and-issue service.

`resolveReferralLink` performs token format validation, HMAC lookup, organisation scoping, link status/expiry checks, programme active/effective-date checks, referrer profile activity, active person status, and configured student/alumni role eligibility. Public resolution returns only generic invalid-link results and safe display data for a future form.

`listEligibleReferralCourses` returns only explicitly configured active programme-course rows for the same organisation and an active/current programme. An unconfigured programme returns an empty list; there is no fallback to all courses.

`submitReferralAndCreateEnquiry` derives programme, referrer profile, and referral-link IDs from the resolved token. Browser input does not supply referrer identity. The accepted operation uses one D1 `batch()` transaction to create the enquiry, create the referral, link `referrals.enquiry_id`, create the initial status event, and write a safe audit entry.

`referrals.prospect_name` stores the trimmed, whitespace-normalised, unverified name submitted by the prospective student. It is historical submission evidence, not an official Student Master identity. The service does not copy it to `people`, `enquiries.source_detail`, event metadata, audit metadata, or `prospect_person_id`.

The initial accepted lifecycle is a single `accepted` referral row with one event from system start to `accepted`. `valid_until` is `submitted_at + programme.validity_days`, and `attributed_at` is the submission timestamp. Admission confirmation will later populate `enrolments.referral_id`.

Existing-record classification uses the mobile HMAC lookup path. A referral submission is rejected for current students, former students/alumni, any non-invalid/non-duplicate historical enquiry, active unexpired duplicate referrals, invalid mobile, missing consent, invalid/inactive link, inactive programme, or ineligible course. Lost enquiries are treated as existing enquiries unless a later product rule says otherwise.

Active duplicates are referrals in `accepted`, `active`, or `converted` status with `valid_until` at or after the request time. Migration `0013` adds a nullable `active_duplicate_key` with a partial unique index so concurrent accepted submissions for the same organisation/mobile cannot both commit. The service clears expired duplicate keys for the same mobile inside the write batch before inserting a new accepted referral.

Idempotency keys are HMAC-hashed with domain separation and never stored raw. Migration `0013` adds `idempotency_payload_hash` so the same organisation/key/payload can return the original referral/enquiry while the same key with a materially different link, submitted-name digest, mobile hash, course, branch, or consent state is rejected as `idempotency_conflict`. Whitespace-only submitted-name differences collapse before hashing.

Data deliberately not stored: raw referral tokens, full personal/public links in `referral_links`, raw mobile/email/name in audit metadata, raw idempotency keys, frontend secrets, Aadhaar/document/banking data in referral events, and request-supplied referrer identifiers.

Future staff APIs may return full `prospect_name`. Referrer dashboard views should use a privacy-safe derived public name, and public token resolution must never return prospect names.

The public HTTP/API cutover, public form, portal dashboard replacement, OTP lookup replacement, staff screens, reward approvals/payouts, partner organisations, Google Sheet import, Apps Script retirement, remote D1 migration, and deployment remain deferred.
