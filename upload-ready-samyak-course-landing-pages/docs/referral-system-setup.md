# Samyak Skill Circle Referral System Setup

Archived reference only. This guide describes the former Google Sheets, Google Apps Script and Cloudflare Pages Functions referral setup.

It is not the operational backend for current referrals. Native Worker APIs backed by D1 are the sole referral system of record, and the public referral form, portal OTP/profile lookup, portal referral dashboard, and referral-link generation/rotation do not call Apps Script.

## 1. Create a New Google Sheet

1. Create a blank Google Sheet in the Samyak Google account.
2. Name it `Samyak Skill Circle Referral System`.
3. Keep access limited to the owner/counsellor team.

## 2. Paste the Apps Script Files

1. In the Sheet, open `Extensions` -> `Apps Script`.
2. Create these script files:
   - `Config.gs`
   - `Setup.gs`
   - `Code.gs`
3. Paste the matching code from this repository's `google-apps-script/` folder.
4. Save the Apps Script project.

## 3. Run `setupWorkbook()`

1. Select `setupWorkbook` from the function dropdown.
2. Click Run.
3. Authorise the script when prompted.
4. Return to the Google Sheet and confirm these tabs exist:
   - `Referrers`
   - `Courses`
   - `Referrals`
   - `ExistingContacts`
   - `ActivityLog`
   - `Settings`

Running `setupWorkbook()` also saves the workbook ID to Apps Script Script Properties as:

```text
SPREADSHEET_ID
```

The deployed Web App uses this value with `SpreadsheetApp.openById()` so API requests do not depend on bound-script active-file methods.

The sheet should also show the custom menu:

`Samyak Skill Circle` -> `Setup Workbook`, `Generate Missing Referral Links`, `Refresh Referrer Statistics`, `Expire Old Referrals`

## 4. Apps Script Authorisation

The script needs permission to edit the active Google Sheet and read the active user's email for internal activity logs.

Use the official Samyak Google account, not a personal temporary account.

## 5. Confirm Script Properties

In Apps Script:

1. Open `Project Settings`.
2. Under `Script Properties`, confirm `SPREADSHEET_ID` exists. It is saved automatically by `setupWorkbook()`.
3. Add:

```text
REFERRAL_API_SECRET = a-long-random-secret
```

Warning: never commit this secret to Git, paste it into frontend JavaScript, or share it publicly.

`SPREADSHEET_ID` is not a public secret, but it should not be exposed in frontend code. Keep both workbook access details and the shared secret server-side.

## 6. Deploy Apps Script as a Web App

1. Click `Deploy` -> `New deployment`.
2. Select type: `Web app`.
3. Description: `Samyak Skill Circle API`.
4. Execute as: `Me`.
5. Who has access: `Anyone`.
6. Deploy.
7. Copy the Web App URL.

The Web App is protected by the shared secret. The public browser should still never call this URL directly.

## 7. Configure Cloudflare Pages Variables

In Cloudflare Pages project settings, add these environment variables:

```text
APPS_SCRIPT_URL = your Apps Script web app URL
REFERRAL_API_SECRET = the same shared secret from Apps Script Properties
ENVIRONMENT = production
```

For local development, set:

```text
ENVIRONMENT = development
```

Development mode permits localhost origins for testing.

## 8. Add an Initial Referrer

In the `Referrers` sheet, add:

- Referrer ID
- Full Name
- Mobile Number
- Normalised Mobile
- Referrer Type: `Student` or `Alumni`
- Course Studied
- Active: `Yes`

Leave `Referral Token`, `Personal Link` and `WhatsApp Share Link` blank.

## 9. Generate the Personal Referral Link

Use:

`Samyak Skill Circle` -> `Generate Missing Referral Links`

The script will:

- Generate a random URL-safe token.
- Check token uniqueness.
- Create a personal link in this format:

```text
https://go.samyaksion.com/r/{TOKEN}
```

- Create a WhatsApp share link for the referrer.

Tokens are never regenerated unless an administrator intentionally clears or changes them.

## 10. Import Existing Enquiries and Students

Add known contacts to `ExistingContacts`.

Required fields:

- Full Name
- Mobile Number
- Normalised Mobile
- Record Type: `Existing Enquiry`, `Current Student`, or `Former Student`
- Course
- Active: `Yes`

This sheet is used to reject invalid referrals before checking duplicates.

## 11. Test a Valid Referral

Use the Cloudflare endpoint:

```text
POST /api/referrals/submit
```

Body:

```json
{
  "token": "VALID_TOKEN",
  "name": "Prospect Name",
  "mobile": "9876543210",
  "email": "optional@example.com",
  "courseId": "WEB_DEVELOPMENT",
  "consent": true,
  "source": "Online"
}
```

Expected result:

```json
{
  "success": true,
  "referralId": "SSC-2026-000001",
  "validUntil": "YYYY-MM-DD"
}
```

## 12. Test a Duplicate Referral

Submit the same normalised mobile number again while the first referral is active.

Expected result:

```json
{
  "success": false,
  "code": "DUPLICATE_REFERRAL",
  "message": "This contact has already been registered through an active referral."
}
```

The response must not reveal the earlier referrer.

## 13. Test an Expired Referral

1. In the `Referrals` sheet, set an accepted referral's `Valid Until` date to a past date.
2. Run `Samyak Skill Circle` -> `Expire Old Referrals`.
3. Submit the same prospect mobile number again through a valid token.
4. Confirm a new referral can be accepted.

## 14. Deactivate a Referrer

In `Referrers`, change `Active` to `No`.

Validation for that token should return:

```json
{
  "valid": false
}
```

Submissions through that token should be rejected.

## 15. Reward and Fee Testing

When `Final Course Fee` is entered in `Referrals`, Apps Script calculates:

```text
Minimum Qualifying Payment = Final Course Fee × 50%
```

When `Amount Received` is equal to or greater than the minimum qualifying payment, the status becomes:

```text
Reward Eligible
```

Approval remains manual. The owner must approve or reject rewards.

## 16. Apps Script Test Functions

Run:

```text
runReferralSystemTests()
```

This covers:

- Workbook configuration through `SPREADSHEET_ID`
- Mobile normalisation
- Invalid mobile number
- Existing enquiry rejection
- Current student rejection
- Former student rejection
- First referral acceptance
- Active duplicate rejection
- Expired-referral acceptance
- Invalid token rejection
- Inactive-referrer rejection
- Reward slab calculation
- Minimum qualifying payment calculation

The tests use temporary rows and clean them up afterward.

## 17. Cloudflare API Endpoints

The Pages Functions created in this repository are:

```text
GET  /api/referrals/courses
POST /api/referrals/referrer
POST /api/referrals/submit
```

They:

- Read `APPS_SCRIPT_URL` and `REFERRAL_API_SECRET` server-side.
- Restrict browser origins to Samyak domains.
- Permit localhost only in development mode.
- Avoid logging full mobile numbers or emails.
- Return generic server errors.
- Keep referrer identity private.

## 18. Rollback and Troubleshooting

If something fails:

1. Confirm Apps Script `REFERRAL_API_SECRET` matches Cloudflare `REFERRAL_API_SECRET`.
2. Confirm `APPS_SCRIPT_URL` is the latest deployed Web App URL.
3. Confirm the deployment access is `Anyone`.
4. Re-run `setupWorkbook()`.
5. Check `ActivityLog` for internal referral actions.
6. Temporarily set `ENVIRONMENT=development` only for localhost testing.
7. Roll back Cloudflare Pages to the previous deployment if public API requests fail after a release.

Do not delete referral rows to correct mistakes. Use statuses and activity logs so audit history remains intact.
