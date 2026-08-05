# D1 Referral Foundation

This phase adds the database and pure-domain foundation for Samyak Skill Circle referrals. It does not cut over the public form, portal dashboard, OTP eligibility lookup, staff UI, Apps Script runtime calls, Google Sheet import, partner organisations, reward approvals, or payouts.

`referrer_profiles` remains the identity/profile table. The existing `external_referrer_id`, `referral_token`, `personal_link`, and `last_synced_at` columns are preserved as legacy Apps Script-era sync fields so current auth/session behavior is not broken. New public referral credentials must be stored in `referral_links` as keyed lookup hashes only; raw tokens and full public URLs are not stored in the new schema.

`referrals.enquiry_id` is the canonical referral-to-enquiry link. `enrolments.referral_id` captures immutable confirmed-admission attribution. `enrolments.referrer_profile_id` remains a denormalised convenience and is indexed, but the existing column is not rebuilt in this additive migration.

Programme referrer eligibility is represented by `referral_programme_referrer_types`. Samyak Skill Circle seeds exactly two eligible referrer types: `student` and `alumni`. Institute partners are intentionally out of scope for this phase.

Course eligibility is intentionally unseeded. The published referral programme names course examples through the current Apps Script Course sheet, but the D1 Course Master does not yet have a reliable canonical rule for which rows should be referral-eligible. Staff configuration or an import phase should populate `referral_programme_courses`.

Reward slab non-overlap is a service invariant. SQLite check constraints cover non-negative values and row-local min/max validity, while `validateRewardSlabNonOverlap` rejects overlaps before service writes.

The next service phase should reuse `normalizeIndianMobile`, `hmacHex`, and `encryptText` for prospect contact handling: normalise mobile server-side, store lookup HMAC, encrypt operational contact values only where needed, keep last four for masked display, and avoid full contact values in logs, events, snapshots, or metadata.
