# Samyak Skill Circle Apps Script

This folder contains the Google Apps Script backend for the Samyak Skill Circle referral programme.

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
```

Use a long random value for `REFERRAL_API_SECRET`. Never commit the shared secret to Git.

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
- Referrer identity is never returned to the public API.
- Personal referral links should not be added to any sitemap.
