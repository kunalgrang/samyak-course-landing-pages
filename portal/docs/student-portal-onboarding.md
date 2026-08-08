# Student Portal Onboarding

Phase 3 turns the imported Student Master data into the first-login student portal path. It reuses the existing D1-backed OTP, login account, session, linked profile, and referral dashboard architecture.

No migration is required for this phase. Existing tables already support the flow:

- `people`
- `person_contacts`
- `person_contact_details`
- `students`
- `enrolments`
- `login_accounts`
- `login_account_people`
- `user_sessions`
- `referrer_profiles`
- `referral_links`

## Login Flow

1. The student enters a mobile number.
2. The Worker normalizes the mobile number and derives the contact HMAC with `SESSION_PEPPER`.
3. `POST /api/auth/request-otp` creates an OTP challenge before lookup so rate limits count known and unknown attempts.
4. Candidate profiles are looked up from active People with an active mobile contact, active Samyak Skill Circle referrer profile, eligible `student` or `alumni` role, and a non-disabled Student Master row.
5. Unknown or ineligible mobiles receive the same generic public response and become blocked challenges without storing plaintext mobile.
6. After OTP verification, `bootstrapAccount` creates or reuses one login account for the mobile HMAC and links only existing imported People through `login_account_people`.
7. If exactly one profile is linked, the session selects it. If multiple People share the mobile, the session has no active profile until the user selects one.

First login does not create People, contacts, students, enrolments, roles, referrer profiles, referral links, referrals, reward snapshots, or admissions.

## Shared Mobile Selection

Shared-family mobile numbers are supported by linking one login account to multiple existing People. The profile selector is authoritative only after OTP verification. Browser-supplied profile IDs are accepted only when `login_account_people` says the person is linked and available.

Selecting a profile updates the active person on the session. Student APIs are then scoped to that selected person. A stale or unavailable profile clears the session active profile without deleting the login account.

## Dashboard Source

`GET /api/student/home` is the student dashboard source. It requires an authenticated session and an active selected profile with a `student` or `alumni` effective role.

The endpoint returns privacy-safe fields:

- student display identity
- Student ID
- CURRENT or ALUMNI lifecycle status
- course history from `students`, `enrolments`, and `courses`
- Samyak Skill Circle CTA metadata that links to `/app/referrals`

`on_hold` is displayed as CURRENT. Completed and alumni-style historical states are displayed as ALUMNI.

The home dashboard does not generate or rotate referral links. Link generation and rotation remain explicit user actions on `/app/referrals`.

## Privacy Rules

The student home and profile views do not return mobile numbers, email addresses, contact HMACs, OTP values, referral token hashes, raw referral tokens, or full historical contact data.

The frontend displays only the stored session mobile last four as `******1234` where needed.

## Local Verification

Run from `portal/`:

```sh
npm run typecheck
npm run test:run
npm run build
```

These commands are local verification only. They must not be confused with production OTP sends, remote migrations, seeding, Worker deployment, Pages deployment, or referral-link rotation.
