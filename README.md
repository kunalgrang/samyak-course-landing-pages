# Samyak Course Landing Pages

Static Google Ads landing pages for Samyak Computer Classes, Sion, Mumbai.

## Project Purpose

This repository replaces heavy WordPress/Elementor landing pages with lightweight static HTML, CSS and vanilla JavaScript pages suitable for Cloudflare Pages.

## URL Structure

- `https://go.samyaksion.com/tally-sion/`
- `https://go.samyaksion.com/digital-marketing-sion/`
- `https://go.samyaksion.com/data-analytics-sion/`
- `https://go.samyaksion.com/` redirects to `https://samyaksion.com/`

## Local Preview

Run from the repository root:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080/tally-sion/`, `http://localhost:8080/digital-marketing-sion/`, and `http://localhost:8080/data-analytics-sion/`.

## Cloudflare Pages Setup

Use GitHub integration for `kunalgrang/samyak-course-landing-pages`.

Exact build settings:

- Production branch: `main`
- Build command: leave blank
- Build output directory: `/`
- Framework preset: None / static

## Custom Domain and DNS

In Cloudflare Pages, add `go.samyaksion.com` as the custom domain. Cloudflare will show the required CNAME target. Configure DNS only after all pages are tested.

Do not change DNS from this repository.

## Referral API Routing

The referral form is served by the root static Pages project at:

- `https://go.samyaksion.com/r/{token}`

The form intentionally calls same-origin native Worker endpoints:

- `/api/public/referrals/resolve/{token}`
- `/api/public/referrals/resolve/{token}/courses`
- `/api/public/referrals/submit`

Those API requests are handled by the portal Worker through the narrow Worker route configured in `portal/wrangler.jsonc`:

- `go.samyaksion.com/api/public/referrals/*`

Keep the route scoped to `/api/public/referrals/*`. Do not route `go.samyaksion.com/*` through the portal Worker because the static landing pages must continue to be served by the root Pages project.

Preview referral submissions must use either local development or a dedicated staging hostname with a separate staging D1 database. Do not enable wildcard `*.pages.dev` CORS for referral submissions.

## Google Ads Conversion Testing

1. Open a course page in Incognito.
2. Open DevTools Network.
3. Enable Preserve log.
4. Filter for `conversion` or `googleadservices`.
5. Click a WhatsApp CTA.
6. Confirm `AW-17938047753/l-dXCN76xskcEInGw-lC` fires once.
7. Confirm WhatsApp opens once.
8. Repeat for a call CTA and confirm `AW-17938047753/4-O_CNv6xskcEInGw-lC` fires once.
9. Submit a test form.
10. Confirm FormSubmit returns success.
11. Confirm `AW-17938047753/KKhoCJuo7MEcEInGw-IC` fires only after the successful response.
12. Confirm no thank-you page is visited.
13. Confirm there are no duplicate conversion events.
14. Confirm there are no JavaScript errors.
15. Confirm each page uses its course-specific WhatsApp message.

## FormSubmit Testing

Forms post JSON to `https://formsubmit.co/ajax/shreeservicesrt@gmail.com` and validate name plus a 10-digit Indian mobile number. A successful response hides the form and shows an inline success message. A failed response shows a visible error with a direct WhatsApp fallback link.

## WhatsApp and Call Testing

All WhatsApp buttons use `wa.me/917413832777`. All call buttons use `tel:+917413832777`. They do not route through a thank-you page.

## PageSpeed Checklist

- No external Google Fonts.
- No jQuery, Bootstrap, Tailwind, React, Vue, Next.js, Astro, sliders or animation libraries.
- Shared CSS and JS only.
- Logo/favicons are optimized.
- Check mobile widths: 320, 375, 425, 768 and desktop.
- Confirm the sticky mobile bar does not cover final content.

## Rollback

In Cloudflare Pages, roll back to the previous deployment from the Deployments tab. If DNS was changed, revert the `go.samyaksion.com` record to the prior target.

## Old WordPress Redirect Instructions

Configure these as 301 redirects on the WordPress/main-domain side only after the new pages are fully tested:

- `https://samyaksion.com/tally-course-sion/` -> `https://go.samyaksion.com/tally-sion/`
- `https://samyaksion.com/digital-marketing-course-sion/` -> `https://go.samyaksion.com/digital-marketing-sion/`
- `https://samyaksion.com/data-analytics-course-sion/` -> `https://go.samyaksion.com/data-analytics-sion/`

Do not place these main-domain redirects in a Cloudflare Pages `_redirects` file because this Pages project controls `go.samyaksion.com`, not `samyaksion.com`.

## Pre-launch Checklist

- Verify all three pages load on desktop and mobile.
- Verify `robots.txt` and `sitemap.xml`.
- Verify canonical URLs.
- Verify Google Ads base tag appears once per course page.
- Verify no conversion fires on page load.
- Verify no old thank-you URLs remain in production files.
- Verify FormSubmit delivery.
- Verify WhatsApp and call conversions.
- Connect `go.samyaksion.com` in Cloudflare Pages.

## Post-launch Checklist

- Re-test Google Ads conversions on the production domain.
- Re-test FormSubmit on the production domain.
- Check PageSpeed Insights for all three pages.
- Configure the three WordPress 301 redirects.
- Monitor Google Ads conversion diagnostics.
