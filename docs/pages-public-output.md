# Pages public-output boundary and containment runbook

## Local candidate; production remains unchanged

KUN-86 prepares a local publication boundary. It does not itself change the Pages
Dashboard or remove previously published files. Do not push or merge this candidate
until the owner approves the configuration and deployment sequence below. Main and
preview updates currently trigger Pages builds; an old root-output build could
publish newly added internal files before the configuration is corrected.

## Diagnosis and evidence limits

The owner observed an unauthenticated download of
`/portal/migrations/0040_simplify_samyak_payment_plan_policy.sql` on
`go.samyaksion.com`. No confidential production path was requested for this task.
Owner-verified Pages settings are blank root/build/output, main production branch,
automatic deployments enabled, watch paths `*`, and no deploy hooks. The separate
portal Worker has no native Git integration (owner evidence).

The repository puts public assets beside tracked Worker/application source, database
schema/migrations/seed SQL, tests, documentation, archived Apps Script integration
source/configuration, design references and a duplicate upload-ready site tree.
There was no root build script or public-output allowlist. With the repository root
used as assets, these categories are not separated by a publication boundary.
A local raw-root file server would find the migration at the exposed URL path;
the allowlisted Pages preview instead returns the custom 404. The live deployment
artifact and access history have not been fetched or independently inventoried.

Confirmed: the owner-observed SQL migration exposure. Potential: the other tracked
internal file categories above, including seed data and archived configuration.
Not established: access to actual student records, working credentials, private keys,
backups or production database contents, or exploitation. Local untracked backups
and ignored development environment files are not in the Git source tree and are
not established as part of a Git-integrated deployment. D1/R2 contents and remote
Worker secrets are separate resources; they are not static repository files.
Do not infer an actual data breach from the SQL download.

An authorized investigation should preserve deployment IDs/configuration and
available request/security logs, compare deployed commit trees and build outputs
privately, and classify actual credential/data material if present. Avoid directory
brute forcing or downloading suspected sensitive public resources. Review/rotate
credentials only with separate authorization and evidence of exposure or risk.

## Public allowlist (58 exact files)

`pages-public-files.json` is the complete, reviewable list. No recursive directory
copy, Git wildcard or discovery of new public files is used.

| Group | Exact scope | Purpose |
| --- | --- | --- |
| Root | `index.html`, `404.html`, `robots.txt`, `sitemap.xml`, `_headers`, `_redirects`, `_routes.json` | Existing redirect document, 404, SEO and Pages controls |
| Public pages | `index.html` in `tally-sion`, `digital-marketing-sion`, `data-analytics-sion`, `full-stack-developer-course-sion`, `r`, `samyak-skill-circle` | Existing course/referral/programme URLs |
| Assets | The 18 explicitly listed CSS/JS/image files under `assets/` | Page styling, browser code, logos, icons and social/hero media; retain existing asset URLs |
| CCC | `ccc-mock-test/index.html`, `nq01.txt` through `nq09.txt`, `p01.txt` through `p07.txt`; `hard/index.html`, `hd01.txt` through `hd08.txt`, `hq01.txt` | Normal/hard mock examinations, compressed public question banks and existing client loader dependencies |

The CCC question banks and their client tracking-loader dependencies are intended
public browser assets. Preserving them does not authorize any tracking submission
in this task; local validation only decodes fixture/public banks and uses mocks.
No fonts or additional media outside this list are referenced by these pages.

Exclude all other files, including `portal/`, `docs/`, `source/`,
`google-apps-script/`, `upload-ready-samyak-course-landing-pages/`, root development
documentation, scripts/manifest, tests, environment files, Git metadata, Wrangler
state, dependencies, databases, backups and nested build outputs. Future migrations,
including 0041 on another branch, are excluded without needing a denylist update.

## Build behavior

Run from the repository root with Node.js 22 or newer:

```sh
node scripts/build-pages.mjs
node scripts/build-pages.mjs --check
node --test scripts/build-pages.test.mjs
```

The builder checks every explicit source path, rejects traversal, Windows/encoded
paths, symlinks/junctions, disallowed directories/extensions, missing files and
case-insensitive duplicates, then copies only those exact files to `dist-pages/`.
It verifies the resulting file set and bytes against the approved sources. It also
rejects missing, linked or additional Pages Functions beyond the single reviewed
`functions/r/[token].js`, so extra runtime routes cannot be added silently.
Unknown existing output files or directories cause failure. The builder does not
recursively delete output or user files. If an old output is contaminated, inspect
it and move/remove only the verified generated `dist-pages` artifact separately;
never clear repository, `.wrangler`, backup or user-data directories to pass a test.
Concurrent hostile modification of the local filesystem is outside this build's
trust model; run builds from an isolated trusted checkout.

Repeated builds produce the same filenames and content. Output and local preview
cache are Git-ignored. No timestamps, credentials or dependency installation are
required by the production build. Manifest changes require code review; adding an
unknown root directory or an extra file under `assets/` never makes it public.

## Pages configuration proposed for owner approval

| Setting | Proposed value |
| --- | --- |
| Project | `samyak-course-landing-pages` |
| Repository root | Blank (repository root) |
| Framework | None/static |
| Build command | `node scripts/build-pages.mjs` |
| Build output directory | `dist-pages` |
| Production branch | Keep `main` |
| Build watch paths | Keep `*` |
| Functions source | Root `functions/`, unchanged, outside `dist-pages/` |
| Build environment | Node 22+; set `NODE_VERSION=22` only if the existing runtime is older |
| Secrets / bindings required by builder | None |

Dashboard build/output settings must be changed explicitly. Repository scripts do
not silently change those settings. No root Wrangler production configuration is
introduced, avoiding accidental replacement of existing Dashboard bindings or
compatibility settings. Do not run the portal build/deploy/migration commands as
part of this Pages build. Preserve existing Pages Function environment settings.

Cloudflare Git integration discovers root `functions/` independently of the asset
output directory. Preserve `functions/r/[token].js` and the generated output's
`_routes.json` and `_redirects` unchanged. Do not copy Function source into static
output. Local Wrangler serves the explicitly approved `_routes.json` file as JSON;
it contains only the public `/r/*` route map, not secrets or backend implementation.

The existing `/r/*` Pages Function serves `/r/` through `env.ASSETS`, accepts GET and
HEAD, and rejects POST. The browser continues calling same-origin
`/api/public/referrals/*`, routed by the separately deployed portal Worker on the
custom hostname. Certificate `/verify/*` and public certificate API routes also
remain on that Worker. No Worker route, CORS, token, attribution, financial or auth
behavior changes. These Worker-only paths correctly return 404 in a standalone
Pages preview; a functioning frontend in Pages does not provide its production API.
No wildcard preview CORS should be added.

## Local validation

The build/security tests use actual generated output and disposable fixtures. The
DOM tests execute the generated HTML/JS with all fetches mocked and external
resource loading disabled. They verify validation, grouped course IDs, synthetic
submission, language switching, duplicate-submit protection and stable retry keys.

For DOM/Pages preview tests, reuse installed portal dev tools (no production build
dependency). A fresh checkout may install them with `npm ci --prefix portal`.

```sh
node --test scripts/pages-referral.test.mjs
node scripts/test-pages-preview.mjs
```

Optional `PAGES_HAPPY_DOM` points to an installed `happy-dom/lib/index.js` and
`PAGES_WRANGLER_BIN` to an installed `wrangler/bin/wrangler.js`. This allows local
reuse of existing dependencies without touching other worktrees. The preview
harness launches only loopback Pages, passes no D1/R2/service bindings, removes API
credential environment variables from its child, and never submits to production.
It stops its own preview process tree on completion. Its local compatibility date
is `2026-07-21` for the installed workerd; `PAGES_PREVIEW_COMPATIBILITY_DATE` can
select another supported local date without changing production configuration.

`node scripts/test-pages-preview.mjs --serve` additionally exposes a temporary
loopback browser fixture with stub referral APIs and a CSP that blocks external resource/API
requests. Do not follow external links or the root redirect during browser QA. It prints the local URL and waits for input; send `quit` to
stop it. This fixture is test-only and is never copied into output. Root redirect,
all course/media/CCC routes, real Function GET/HEAD/POST behavior, headers, custom
404, and internal/Worker-only negative paths are checked before browser QA.

A full Education release run is unnecessary for this isolated static packaging
change. Run the existing focused `worker/lib/static-referral-form.test.ts` checks
if portal dev dependencies are available. No shared portal runtime is modified.

## Owner-approved rollout sequence

1. Independent security review of the complete local diff and exact 58-file output.
   Keep KUN-73/PR #50 unmerged while the root publication boundary is unsafe.
2. Obtain separate approval for Pages configuration changes, source publication,
   preview build and production publication. Record current production deployment
   ID, exact candidate SHA, settings and Function configuration without secret values.
3. Before pushing this branch or merging any new source, change build command and
   output together to the proposed safe values for production AND previews. Verify
   no branch-specific override still publishes root. On old main, the missing build
   script should make a build fail; do not bypass this by restoring root output.
   This preparatory change alone does not remove current exposure.
4. After authorized commit/push, run an explicitly approved safe preview. Inspect
   its build logs and generated asset list, Function detection and route results.
   Use local mocks or an authorized separate staging backend, never real referral
   submissions from a preview. Confirm no Worker/D1 commands are in the build log.
5. After explicit merge/production authorization, main's automatic deployment
   publishes the safe Pages output. The portal Worker and D1 remain unchanged.
6. Verify the production hostname, project `pages.dev`, branch aliases and new
   immutable deployment URL. Check public pages/media, headers, missing paths,
   Function routes and Worker-route health. Begin negative checks with headers or
   response status; if an internal path unexpectedly returns success, stop without
   downloading its body and investigate under separate authorization. Check the
   known 0040 path, 0041 exclusion and representative sanitized category paths.
7. Complete separately approved legacy-deployment containment and cache review.
   Only mark the exposure contained when all relevant hostnames/deployments have
   been addressed, not just when the custom domain serves the new deployment.

## Legacy deployments and immediate containment options

A new safe production build replaces current production aliases; it does not erase
old hash-based deployment URLs. Branch aliases can also continue pointing to unsafe
older output. Obtain an authorized deployment inventory from Dashboard/API metadata,
map aliases to exact deployments, and preserve evidence before any deletion.

| Option (none performed) | Protective effect / hostname scope | Public-route risk / reversibility / approval |
| --- | --- | --- |
| Safe allowlisted rebuild | Removes internal assets from the new deployment and aliases pointing to it, including custom and project production hostnames | Low route risk after preview; old hashes remain; separate configuration/publish approval |
| Temporary narrow WAF/path restriction | Blocks known internal prefixes and specific document paths on controlled custom-domain zones | Does not cover Cloudflare-owned `pages.dev` URLs; avoid `/r/*`, public assets, APIs and verification; reversible; owner WAF approval |
| Pages preview Access policy | Restricts old/new hash previews and branch aliases within configured policy scope | Default preview protection does not protect the project production `pages.dev` or custom hostname; reviewer sign-in needed; reversible; owner access/security approval |
| Explicit project-domain Access policy plus preview policy | Can cover project `pages.dev` and preview URLs together after careful hostname/policy verification | May restrict intended direct `pages.dev` visitors and has custom-domain authentication caveats; keep public custom routes working; reversible; owner architecture/security approval |
| Retire selected old deployments | Removes the exact approved old deployment URLs after evidence/recovery review | Destructive; latest branch deployments have restrictions; no blind bulk deletion; separate per-scope approval |
| Cache purge / search removal | Reduces stale platform/search copies where controllable | Cannot recall downloaded files or arbitrary third-party caches; scope and recovery impact reviewed; separate owner approval |

Recommended containment review: combine a safe rebuild with preview/legacy-host
coverage; a custom-domain-only WAF rule is incomplete. Temporary narrow custom-domain
blocks and preview Access may reduce exposure while rollout is prepared, subject
to owner approval. No Access policy, WAF rule, deployment deletion or purge is part
of this local candidate. A Pause Builds switch alone does not remove existing files.

Do not roll back to a known root-publishing deployment. Retain a verified safe
allowlisted deployment as the recovery target; otherwise fix forward using the
same restricted output. Any emergency rollback must explicitly account for
reintroduced exposure and retain approved containment. No DNS rollback, Worker
rollback, D1 migration or data repair is needed for this packaging change.

## Primary references checked

- [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Root Functions convention](https://developers.cloudflare.com/pages/functions/get-started/)
- [Pages local development](https://developers.cloudflare.com/pages/functions/local-development/)
- [Preview and immutable deployment URLs / Access scope](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Project pages.dev Access and custom-domain caveats](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)

These describe platform behavior, not proof that any live setting was changed or
that old exposure has been removed. All production operations remain unauthorized.
