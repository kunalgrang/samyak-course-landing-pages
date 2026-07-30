# Samyak Student Portal

Standalone React and Cloudflare Workers application for secure Samyak student/referrer access.

## Architecture

- React, TypeScript, and Vite render the browser application from `src/`.
- `worker/index.ts` runs a Hono API Worker for same-origin `/api/*` routes.
- Cloudflare Worker Static Assets serves the SPA with single-page fallback.
- Cloudflare D1 stores only portal auth state: hashed mobile identifiers, encrypted eligible challenge mobile values, hashed session tokens, people/profile links, person-scoped roles, audit logs, and auth events.
- The existing Google Sheet remains the operational referral source. The browser never calls Apps Script directly.

`login_accounts.mobile_normalized` is a legacy column name. It stores the keyed mobile HMAC lookup value, not the plaintext normalized mobile number.

## Local Setup

```sh
cd portal
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Fill `.dev.vars` locally only. Do not commit real values.

## Turnstile Setup

Create a Cloudflare Turnstile widget for:

- `localhost`
- `127.0.0.1`
- `portal.samyaksion.com`

Use the site key as `TURNSTILE_SITE_KEY`. Store the private secret as `TURNSTILE_SECRET_KEY`. The frontend receives the public site key from `GET /api/public-config`; no Turnstile secret is exposed to React or any `VITE_` variable.

Local automated tests may use Cloudflare's official Turnstile test keys.

## OTP Challenge Lifecycle

After JSON/mobile/provider/Turnstile validation and the initial rate-limit check, `POST /api/auth/request-otp` creates a D1 `requested` challenge before calling Apps Script or MSG91. That means Apps Script timeouts, invalid Apps Script responses, provider failures, eligible sends, and ineligible lookups all count toward mobile/IP request limits.

Allowed transitions:

- `requested` to `sent` after Apps Script confirms eligibility and the provider accepts the send.
- `requested` to `blocked` when Apps Script says the mobile is not eligible.
- `requested` to `failed` for Apps Script or first-send provider failure.
- `sent` to `sent` after a permitted resend.
- `sent` to `verified` after a successful provider verification.
- `sent` to `failed` when a resend provider failure invalidates the challenge.

Conditional D1 updates prevent duplicate transitions, verified challenge reuse, blocked-to-sent changes, failed-to-sent changes, expired resends, verified resends, and concurrent resend count overrun.

## Anti-Enumeration Design

Known and unknown mobiles receive the same successful `request-otp` response shape:

```json
{
  "success": true,
  "challengeId": "otp_...",
  "maskedMobile": "******3210",
  "message": "If this mobile number is registered, an OTP has been sent."
}
```

Unknown mobiles are stored as `blocked` challenges with only mobile HMAC, last four digits, IP HMAC, and challenge metadata. Full unknown mobiles are never encrypted, stored, logged, or returned. Verifying a blocked unexpired challenge performs dummy constant-time work, increments attempts, applies the same 5-attempt limit, returns `INVALID_OTP` for ordinary failures, and returns `OTP_EXPIRED` only after the same 10-minute expiry.

Resend for blocked, failed, expired, verified, or missing challenges retains the generic public response and does not call MSG91.

## Local Development OTP

Local OTP testing is available only when all are true:

- `ENVIRONMENT=development`
- the request hostname is `localhost` or `127.0.0.1`
- `DEV_OTP` is configured
- MSG91 config is not selected

The development OTP is never logged, returned by an API, embedded in the frontend, or enabled on preview/production hosts.

Complete local DEV_OTP flow:

```sh
cd portal
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Use a mocked/local Apps Script response for `portal_lookup_mobile`, request an OTP from `http://localhost`, enter the configured `DEV_OTP`, confirm the session cookie is set, open the referral dashboard, log out, and confirm `GET /api/auth/session` returns unauthenticated.

## Roles And Profiles

`student` and `alumni` roles belong to individual people through `person_roles`. Shared-family mobiles can link multiple people to one login account, but each profile exposes only its own person roles. Account-level staff permissions remain in `login_account_roles` for `owner`, `counsellor`, `trainer`, and `system_admin`.

Effective roles for an active profile are the union of account-level staff roles and the active profile's person roles. Authorization helpers must use `getAccountRoles`, `getPersonRoles`, `getEffectiveRolesForActiveProfile`, `requireAuthenticatedProfile`, and `requireActiveProfileRole` so staff/account permissions and selected-profile permissions are not confused.

## Profile Synchronisation

OTP verification calls `portal_lookup_mobile` again and treats returned active profiles as the source of truth for that mobile. Bootstrap/sync upserts returned people and referrer profiles, links returned people to the login account, marks returned links available, deactivates referrer profiles no longer returned for that account, marks stale links unavailable, clears stale active profile selections from sessions, and records audit entries for profile activation/deactivation. Historical people, sessions, audit logs, and auth events are not deleted.

`GET /api/auth/session` returns only active, available linked profiles with active referrer profiles. `GET /api/student/referrals` rejects stale or missing active profiles safely.

## MSG91 Production State

The MSG91 V5 provider is implemented for send, resend, and verify with mocked-fetch tests. Until DLT approval and real credentials are available, production `POST /api/auth/request-otp` returns:

```json
{
  "success": false,
  "code": "OTP_SERVICE_PENDING",
  "message": "Mobile login is temporarily unavailable."
}
```

Production must not fall back to `DEV_OTP`.

## Apps Script Requirement

Create this Script Property manually in the Apps Script project:

- `PORTAL_API_SECRET`

Keep the existing `REFERRAL_API_SECRET` unchanged. Existing actions `courses`, `referrer`, and `submit` use only `REFERRAL_API_SECRET`; new `portal_*` actions use only `PORTAL_API_SECRET`.

## Worker Variables And Secrets

Non-secret Worker variables:

- `ENVIRONMENT`
- `TURNSTILE_SITE_KEY`

Private Worker secrets:

- `TURNSTILE_SECRET_KEY`
- `PORTAL_APPS_SCRIPT_URL`
- `PORTAL_APPS_SCRIPT_SECRET`
- `MSG91_AUTH_KEY`
- `MSG91_TEMPLATE_ID`
- `MSG91_SENDER_ID`
- `SESSION_PEPPER`
- `DEV_OTP` for local development only

Set production secrets with `wrangler secret put NAME`.

## Session Policy

- Production cookie name: `__Host-samyak_session`
- Local development cookie name on `localhost` and `127.0.0.1`: `samyak_session`
- Production attributes: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`
- No `Domain` attribute
- Absolute expiry: 30 days
- Inactivity rejection: 7 days since `last_seen_at`
- Session tokens are random and only HMAC hashes are stored in D1
- Logout revokes the D1 session and clears the cookie

## Rate Limits

OTP requests are D1-backed:

- mobile hash: 1 request per 60 seconds
- mobile hash: 3 sends per 15 minutes
- mobile hash: 8 sends per 24 hours
- IP hash: 10 requests per 15 minutes
- IP hash: 30 requests per 24 hours

Verification:

- 5 attempts per challenge
- challenge validity: 10 minutes
- verified challenges cannot be reused
- resend cooldown: 60 seconds
- maximum 2 resends per challenge

## Migration 0002

Apply `migrations/0002_auth_hardening.sql` after `0001`:

```sh
npm run db:migrate:local
npm run db:migrate:remote
```

The migration adds `login_account_people.is_available` and `person_roles` with a non-null `branch_key` so nullable branch scope is unique safely.

## Apps Script Redeployment

1. Open the existing Apps Script project.
2. Copy updated `google-apps-script/Code.gs` into the project.
3. Confirm `Config.gs`, `Setup.gs`, and workbook tabs remain unchanged unless intentionally updated.
4. Add Script Property `PORTAL_API_SECRET`.
5. Deploy a new Web App version.
6. Keep the same endpoint URL where possible; otherwise update Worker secret `PORTAL_APPS_SCRIPT_URL`.
7. Smoke test `courses`, `referrer`, and `submit` with `REFERRAL_API_SECRET`.
8. Smoke test `portal_lookup_mobile` and `portal_referral_dashboard` server-to-server with `PORTAL_API_SECRET`.

## Production Deployment Order

1. Update and redeploy Apps Script.
2. Add `PORTAL_API_SECRET` as Script Property.
3. Configure Cloudflare Turnstile.
4. Set Worker variables and secrets.
5. Apply D1 migrations remotely.
6. Deploy Worker.
7. Run production smoke tests.
8. Add MSG91 credentials only after DLT template approval.
9. Run one controlled real OTP login.

Do not include real secret values in commits, logs, screenshots, tickets, or frontend variables.

## Manual Test Checklist

- `/api/health` returns success.
- `/api/public-config` returns only `turnstileSiteKey` and `otpEnabled`.
- State-changing auth APIs reject cross-origin requests.
- Invalid mobile is rejected.
- Unknown mobile receives the same generic OTP response shape.
- Local `DEV_OTP` login works only from localhost development.
- Production without MSG91 credentials returns `OTP_SERVICE_PENDING`.
- OTP attempts lock after 5 failed tries.
- Expired challenges cannot be verified.
- Login sets `samyak_session` locally and `__Host-samyak_session` in production; D1 stores only the token hash.
- Shared-family/mobile profile chooser cannot select unlinked people.
- `/api/student/referrals` rejects unauthenticated requests.
- Authenticated referrals page shows no prospect phone, email, fees, paid amounts, internal notes, or Closed reasons.
- Existing prospect route `/r/{TOKEN}` behaves unchanged.

## Checks

```sh
npm install
npm run typecheck
npm run test:run
npm run db:migrate:local
npm run db:seed:local
npm run build
```

Production smoke test:

```sh
PORTAL_URL=https://portal.example.com npm run smoke:production
```

PowerShell:

```powershell
$env:PORTAL_URL = "https://portal.example.com"
npm run smoke:production
Remove-Item Env:\PORTAL_URL
```
