# Samyak Student Portal

Standalone React and Cloudflare Workers application for secure Samyak student/referrer access.

## Architecture

- React, TypeScript, and Vite render the browser application from `src/`.
- `worker/index.ts` runs a Hono API Worker for same-origin `/api/*` routes.
- Cloudflare Worker Static Assets serves the SPA with single-page fallback.
- Cloudflare D1 stores only portal auth state: hashed mobile identifiers, encrypted eligible challenge mobile values, hashed session tokens, people/profile links, audit logs, and auth events.
- The existing Google Sheet remains the operational referral source. The browser never calls Apps Script directly.

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

## Local Development OTP

Local OTP testing is available only when all are true:

- `ENVIRONMENT=development`
- the request hostname is `localhost` or `127.0.0.1`
- `DEV_OTP` is configured
- MSG91 config is not selected

The development OTP is never logged, returned by an API, embedded in the frontend, or enabled on preview/production hosts.

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

- Cookie name: `__Host-samyak_session`
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

## Apps Script Redeployment

1. Open the existing Apps Script project.
2. Copy updated `google-apps-script/Code.gs` into the project.
3. Confirm `Config.gs`, `Setup.gs`, and workbook tabs remain unchanged unless intentionally updated.
4. Add Script Property `PORTAL_API_SECRET`.
5. Deploy a new Web App version.
6. Keep the same endpoint URL where possible; otherwise update Worker secret `PORTAL_APPS_SCRIPT_URL`.
7. Smoke test `courses`, `referrer`, and `submit` with `REFERRAL_API_SECRET`.
8. Smoke test `portal_lookup_mobile` and `portal_referral_dashboard` server-to-server with `PORTAL_API_SECRET`.

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
- Login sets `__Host-samyak_session` and D1 stores only the token hash.
- Shared-family/mobile profile chooser cannot select unlinked people.
- `/api/student/referrals` rejects unauthenticated requests.
- Authenticated referrals page shows no prospect phone, email, fees, paid amounts, internal notes, or Closed reasons.
- Existing prospect route `/r/{TOKEN}` behaves unchanged.

## Checks

```sh
npm run typecheck
npm run test:run
npm run build
```
