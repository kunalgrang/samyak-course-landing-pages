# Samyak Skill Circle Apps Script

Archived reference only. This folder contains the former Google Apps Script backend for the Samyak Skill Circle referral programme.

It is not an operational backend for the current public or portal referral flows. Native Worker APIs backed by D1 are the sole referral system of record. The public referral form, portal OTP/profile lookup, portal referral dashboard, and referral-link generation/rotation do not call this code.

## Files

- `Config.gs` - shared constants, sheet names, headers, dropdown values and seed data.
- `Setup.gs` - workbook setup, menu actions, sheet validation, course/settings seed rows and admin utilities.
- `Code.gs` - API endpoint, referral validation, duplicate checks, reward calculations, WhatsApp links, logging and tests.

## Script Properties

Running `setupWorkbook()` automatically saves the workbook ID as:

```text
SPREADSHEET_ID
```

Before deploying, confirm `SPREADSHEET_ID` exists and add:

```text
REFERRAL_API_SECRET
PORTAL_API_SECRET
```

Use long random values for both secrets. Never commit shared secrets to Git. `REFERRAL_API_SECRET` authenticates the existing public referral action group only. `PORTAL_API_SECRET` authenticates the internal student portal action group only.

`SPREADSHEET_ID` is not a public secret, but it should not be exposed in frontend code. The deployed Web App opens the workbook with `SpreadsheetApp.openById()` using this property, because active-file methods are not reliable for web-app requests.

## Main Functions

- `setupWorkbook()`
- `generateMissingReferralLinks()`
- `refreshReferrerStatistics()`
- `expireOldReferrals()`
- `runReferralSystemTests()`

## Web App API Actions

The Apps Script web app accepts server-to-server POST requests only. The browser must call the Cloudflare Pages Functions proxy, not Apps Script directly.

Supported actions:

- `courses`
- `referrer`
- `submit`
- `portal_lookup_mobile`
- `portal_referral_dashboard`

The `portal_*` actions are for the Cloudflare Worker only and return dashboard-safe data. Do not call them from browser code.

The request JSON sent by Cloudflare includes:

```json
{
  "secret": "SERVER_SIDE_SECRET",
  "action": "submit",
  "payload": {}
}
```

## Security Notes

- Do not expose the Apps Script deployment URL in frontend code.
- Do not expose the Google Sheet ID in frontend code.
- Do not expose the shared secret in frontend code.
- Do not allow `REFERRAL_API_SECRET` and `PORTAL_API_SECRET` to substitute for each other.
- Referrer identity is never returned to the public API.
- Personal referral links should not be added to any sitemap.
