# Phase 1 Architecture

## Referral Data Flow

```text
Active Referrers Sheet
-> secure Apps Script API
-> portal Worker
-> MSG91 OTP
-> D1 session
-> authenticated referral dashboard
```

The browser must never communicate directly with Apps Script. The portal Worker is the only planned bridge to the existing referral operations source, and it will authenticate server-to-server requests using private bindings that are not exposed to React.

Coding Pass 1 deliberately stops before the Apps Script bridge and MSG91 integration. It creates the permanent login, session, OTP challenge, role, audit, and referrer-link schema needed for the later authenticated dashboard.
