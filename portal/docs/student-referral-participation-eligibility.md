# Student/alumni referral participation eligibility

`worker/lib/student-referral-eligibility.ts` provides the internal, session-independent
`evaluateStudentReferralParticipationEligibility(db, input)` preflight. It only reads
data. It is intentionally not registered with any route or lifecycle trigger.

## Contract

Input requires explicit `organisationId`, `personId`, `studentId`, `loginAccountId`,
`referralProgrammeId`, and `admissionEnrolmentId`. An optional
`expectedReferrerProfileId` validates a profile already identified by the caller.
The account is a persisted account identifier, not evidence of a browser session.
Invalid caller timestamps throw; database failures propagate rather than becoming
eligibility decisions. Results contain internal codes and identifiers, never contact
hashes, credentials, names, tokens, or snapshots. Do not return these results through
a public API without a separate public response design.

### Trusted evaluation time

Omitting `now` captures the server's current clock once at evaluation start. This is
the default for future production provisioning callers. An optional ISO `now` remains
available for deterministic tests and trusted internal diagnostics, or a trusted
server-derived current timestamp captured by an internal operation.

The evaluator cannot authenticate the provenance of an injected timestamp. Future
orchestration must construct its inputs explicitly, omit `now` (or derive it from its
own current server clock), and never spread browser/request data into this input or
forward a client-supplied timestamp. This caller boundary must be enforced by the
future orchestration wrapper; no such wrapper, route, or provisioning hook exists here.
The same trusted-caller requirement applies to authorization to act on the subject:
database relationship validation does not grant the caller management authority.

An old injected time can evaluate an old programme date window; such a result is
test/diagnostic eligibility only and must never authorize a profile write now.
This is not a historical reconstruction of security state: identity, account,
membership, role, and profile restrictions are still read from their current rows.
Provisioning requires a fresh current-time evaluation at the write boundary alongside
durable forward-only intent. Invalid injected dates throw before any database query;
they never fall back to the server clock. Tests freeze only the Date clock to prove
default current-time behavior without relying on the machine's wall-clock date.

The evaluator checks:

- Active Organisation and Person; explicit Student-to-Person and tenant ownership.
- Active/login-enabled account, active global identity and matching normalized identity
  key, active Organisation membership, and consistent account/identity/membership
  pointers. A missing account membership pointer fails closed, even though some legacy
  session readers accept missing pointers for compatibility.
- An available `self` link for the correct Person. Other available Person links, or
  another Person's self ownership even when unavailable, block evaluation. This follows
  the conservative ownership posture of forward student auth provisioning; it does
  not grant eligibility through guardian/shared-family/staff access.
- Effective Portal access: `portal_status = disabled` blocks. `not_invited`, `invited`,
  and `active` can qualify when the modern auth and role requirements hold.
- An active tenant-scoped student or alumni Person role permitted by the selected
  programme. Either role can qualify; both permitted roles are returned in sorted order.
  Staff/account roles cannot substitute. Student current status is not itself a gate;
  admission evidence must have a supported post-confirmation Enrolment status.
  Completion alone does not revoke otherwise valid student/alumni eligibility.
- An active programme in this Organisation within its inclusive date window. Programme
  and Organisation identifiers are caller-supplied; no default tenant/programme is used.
- Existing profile state and ownership, including wrong-tenant and partner associations.
- Persisted confirmation evidence for the specific admission described below.

## Existing architecture and reuse

`ReferralRepository.findActiveOrganisation` and `findCurrentProgramme` are reused
directly. Programme dates must additionally parse as valid timestamps.

`auth-store.getPersonRoles` and `sessionView` establish the active tenant-scoped
student/alumni Person-role and self-link rules. The evaluator implements those SELECT
predicates without depending on an HTTP context or session. `sessionView` and the
student home/mobile lookup paths accept non-disabled Students, including `not_invited`.

`identity-membership.isActiveMembership` expresses active identity/membership state.
The evaluator also checks the account status and relationship pointers explicitly.
It does not invoke `ensureOrganisationMembershipForLoginAccount`,
`requireActiveOrganisationMembershipForLoginAccount`, session readers, or
`ensureStudentPortalMembershipForPrimaryMobile`. Bootstrap/provisioning helpers write;
session validation is not a background eligibility API.

`referral-service.assertOrganisationProgrammeAndReferrer` verifies existing active
profiles for link issuance, not initial participation. Its repository query does not
filter inactive Person roles, so it is unsuitable as the new eligibility evaluator.
That existing behavior is an unrelated finding; no existing endpoint is changed here.

## Admission evidence and orchestration boundary

`admission-service.finalizationIntegrityError` checks final enquiry conversion,
confirmed draft and snapshot agreement, enrolment terms/ownership, fee agreement
terms, and receipt linkage. The confirmation implementation writes some markers
before this final integrity check. Therefore a confirmed draft alone does not prove
that the confirmation operation completed successfully.

This evaluator requires an explicit enrolment, checks its Student/branch/Course
ownership, its enquiry's tenant/Person/branch and converted-enrolment pointer, and
exactly one non-cancelled admission draft. That draft must be confirmed, have valid
lock/confirmation timestamps, and carry the supported v1 snapshot with matching
Organisation, Person, enquiry, draft, branch, and Course identifiers. Missing,
ambiguous, mismatched, or incomplete relational confirmation evidence blocks it.
Another confirmed enrolment cannot substitute for the supplied admission.

### Enrolment status boundary

All accepted statuses still require the full relational confirmation checks above;
status alone is never proof of confirmation.

| Enrolment status | Evaluator treatment when other gates and confirmation markers pass |
| --- | --- |
| `confirmed` | Accept: `admission-service.confirmAdmission` creates this status. |
| `not_started`, `active`, `on_hold` | Accept: `auth-store.studentLifecycleStatus` and `batch-management` recognize these alongside `confirmed` as current enrolments; confirmation evidence remains mandatory. |
| `completed` | Accept: `certificate-application-service` supports completion from the four current states above. Active permitted student/alumni roles remain required; completion does not automatically assign alumni. |
| `provisional` | Reject contradictory confirmed markers as `admission_confirmation_inconsistent`. Missing/unconfirmed markers remain ordinary `admission_not_confirmed` failures. |
| `cancelled`, `expired`, `transferred`, `dropped_out` | Fail closed as `admission_enrolment_status_requires_review`; confirmation markers do not resolve their participation continuation policy. |
| Any unrecognized future status | Fail closed as `admission_enrolment_status_requires_review`. |

The schema defines the four ambiguous statuses, but the inspected code does not
establish an approved referral-continuation policy for them. Owner review is required
before allowing them to qualify. This conservative preflight decision does not
deactivate an existing profile, revoke links, change historical attribution/rewards,
or establish cancellation, expiry, dropout, or transfer policy. No other enrolment
is automatically selected to bypass a review result for the supplied admission.

These checks establish persisted relational confirmation evidence, not a replay of
the full admission finalization or an audit of financial integrity. The evaluator
does not recalculate financial eligibility, re-price locked agreements, inspect
current payment thresholds, or reinterpret later receipt reversals. Financial truth
remains in the existing canonical tables and admission/collections services.

Future forward orchestration must establish successful admission confirmation after
the existing integrity checks, and persist durable intent identifying a qualifying
NEW admission. It must enforce that evidence alongside this evaluator; scanning old
confirmed drafts or calling this evaluator alone must never authorize provisioning.
It must also define idempotency, recheck mutable eligibility at the write boundary,
and guard against concurrent disable/revocation/profile creation. None of those
orchestration mechanisms are implemented here. No flag lets callers bypass admission,
auth, self-link, role, programme, or inactive-profile restrictions.

Historical imports without the confirmation evidence fail closed. This module does
not infer, repair, or backfill their eligibility. Course completion and multiple
enrolments do not erase otherwise valid historical confirmation evidence.

## Outcomes and reason codes

| Status | Meaning / reasons |
| --- | --- |
| `eligible_for_initial_provisioning` | `eligible`: all current gates pass and no profile exists; orchestration authorization is still required. |
| `already_active` | `profile_active`: all gates pass and the same Person already owns an active profile. |
| `inactive_profile_requires_review` | `profile_inactive`: never automatically reactivate. |
| `ineligible_subject` | `organisation_not_active`, `person_not_active`, `student_missing`. |
| `ineligible_authentication` | `login_account_missing`, `login_account_not_active`, `login_disabled`, `global_identity_missing`, `global_identity_not_active`, `membership_missing`, `membership_suspended`, `membership_revoked`, `membership_not_active`. |
| `ineligible_self_link` | `self_link_missing`, `self_link_unavailable`, `non_self_account_person_link`. |
| `ineligible_portal_access` | `portal_access_disabled`. |
| `ineligible_programme_or_role` | `student_alumni_role_not_active`, `programme_missing`, `programme_not_current`, `role_not_permitted`. |
| `ineligible_admission` | `admission_not_confirmed`, `admission_confirmation_inconsistent`, `admission_enrolment_status_requires_review`. |
| `ownership_or_tenant_conflict` | `person_organisation_mismatch`, `student_ownership_mismatch`, `account_organisation_mismatch`, `account_identity_mismatch`, `membership_relationship_mismatch`, `different_linked_person`, `programme_organisation_mismatch`, `profile_ownership_conflict`, `admission_ownership_mismatch`. |

Results report the first blocking condition. Profile integrity conflicts and inactive
profiles are checked before authentication; an inactive result is a mandatory stop,
not assurance that the remaining gates pass. Existing active profiles never bypass
the remaining checks. There is no automatic re-enablement path.

## Validation and deliberate exclusions

`worker/lib/student-referral-eligibility.test.ts` uses real in-memory SQLite with all
repository migrations loaded as disposable fixtures, foreign keys enabled, SELECT
assertions, SQLite query-only mode during evaluation, and complete before/after
table comparisons. Tests cover student/alumni/both roles, restrictions, profile
ownership/state, programme boundaries, confirmation inconsistencies, completion,
multiple enrolments, and the `not_invited` access case.
Additional regressions cover provisional enrolments despite confirmed/converted
markers, active-profile bypass attempts, each supported/ambiguous enrolment status,
completed alumni-only access, server-clock defaults, historical test-clock injection,
and rejection of invalid injected timestamps before querying.

There are no schema/migration files, deployed D1 operations, auth changes, financial
changes, profile/link creation, public routes, login/contact/admission hooks, durable
forward intents, or production actions in this package. Live D1 consistency and
atomic provisioning race behavior remain untested and belong to orchestration and
release validation. Database read results are a preflight, not a transaction lock.
