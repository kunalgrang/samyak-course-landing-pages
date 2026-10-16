# Forward student referral participation — KUN-73 local candidate

This foundation has no runtime caller. Migration 0041 is a local candidate, not an
applied production migration. KUN-72's evaluator remains unchanged and read-only.

## Trust and persistence

Existing `admission_confirmed` audit evidence is insufficient: admission-service
writes it before final integrity verification. Enrolments, drafts and that audit
can survive incomplete recovery. None authorizes historical provisioning.

`student_referral_admission_intents` has a stable `sr-intent:<enrolmentId>` key,
unique enrolment/draft/enquiry and qualifying audit IDs, exact tenant/Person/Student
references and an immutable copy of the locked commercial confirmation snapshot.
No authentication credentials or referral secrets are added. The snapshot is copied
verbatim and may contain commercial notes; treat it as sensitive admission data,
never public output or log metadata. It must continue to equal the referenced draft.
`student_referral_provisioning_events` uniquely identifies a successful creation by
intent, Person, profile and audit. Both new tables reject UPDATE and DELETE.

The two new SQL views and triggers form the write contract. Do not generate a
replacement schema from Drizzle definitions alone and omit those guards.

## Atomic confirmation contract (isolated, not integrated)

`recordForwardAdmissionConfirmation(db, subject)` is trusted internal code. Its
explicit subject includes Organisation, Person, Student, Enrolment, draft and
enquiry IDs. It accepts neither a "successful" boolean nor a caller clock.

The new intent INSERT verifies a locked v1 snapshot, unique draft, exact subject
and Centre/course ownership, prepared confirmed Enrolment matching snapshot terms,
matching existing fee agreement terms and effective token-receipt evidence. It
requires a draft-to-confirmed transition, NULL previous confirmation timestamp,
and an unconverted enquiry with no conversion pointer. It does not recompute fees,
require a new payment threshold or mutate any financial table.

The AFTER INSERT trigger conditionally changes the draft and enquiry final
markers and inserts `student_referral.forward_confirmation` audit evidence.
Each UPDATE must affect exactly one row; `RAISE(ABORT)` undoes the entire outer
statement on a rejected guard, zero marker count, constraint or audit failure.
An INSERT SELECT whose snapshot changed produces zero RETURNING rows and is an
explicit conflict, never success. D1 batch zero-row rollback is not assumed.

This defines a new successful **final-marker boundary** after existing admission
preparation and validation. It does not assert that every later optional auth or
batch-assignment step succeeded. Portal eligibility may become true later.
Historical confirmed markers cannot be used to insert an intent. Existing intent
retries must match its entire subject, snapshot, markers and qualifying audit.
Concurrent duplicates reconcile against that evidence, not merely a UNIQUE error.

## Provisioning and races

`ensureForwardStudentReferralParticipation(db, input)` additionally requires the
exact intent ID, login account and programme. It never discovers a historical
admission or substitutes a different identity/account. It first validates durable
intent, then calls KUN-72 with explicitly constructed identifiers. It cannot accept
or forward `now`, even if extra JavaScript object properties are supplied.

The sole write inserts a provisioning event. Its BEFORE INSERT trigger rechecks
all mutable KUN-72 security gates under SQLite's statement write lock: active
Organisation/Person, exact subject/tenant/Centre ownership, allowed confirmed
Enrolment lifecycle, confirmed draft and converted enquiry, identity mobile-key
ownership, unrestricted account, both membership pointers and active status,
available self-link and absence of conflicting owners, effective Portal access,
active permitted student/alumni Person role and current active tenant programme.
The database supplies current time. Guards accept stored calendar dates or canonical
UTC timestamps (seconds or milliseconds); invalid dates, SQLite relative expressions
and noncanonical legacy date formats fail closed and require normalization/review.
Course completion alone does not remove eligibility. `not_invited` remains valid
when effective account/membership/self access exists. Role Centre semantics match
the accepted evaluator; this API grants no administrator management authority.

Any existing Person profile vetoes creation, including inactive or other-tenant
profiles. No UPDATE/upsert or activation exists. The trigger inserts exactly one
profile and matching `student_referral.profile_created` audit. Failure rolls back
the profile, audit and event together. The outer statement must RETURN exactly
one expected key. Trigger row counts independently assert profile/audit inserts.
Each statement has one database serialization order. A committed restriction or
admin disable preceding creation blocks it; a later disable remains authoritative.

Profile IDs and required legacy placeholders are deterministic:
`sr-profile:<personId>`, `forward:<personId>`, `unissued:<personId>`, empty personal
link. The colon is outside the public native 32–128-character URL-safe token format
(generated tokens have 43 characters). There is
no usable referral token/URL, randomness, encryption or recoverable secret, and no
write to referral links, link secrets, attribution, rewards or payouts.

An existing active profile is preserved after current eligibility checks; it need
not have been created by this service. An inactive profile always requires explicit
administrator action. Existing provisioning events must retain their matching
audit/profile evidence; lost or incompatible evidence is a conflict.

## Outcomes and recovery

Provisioning returns `created`, `already_provisioned`, `waiting`, `restricted`,
`inactive_profile_requires_admin`, `invalid_forward_intent`, `ownership_conflict`,
`retryable_failure` or `integrity_conflict`, with a non-sensitive reason code.
Waiting covers missing authentication/membership bootstrap, self access, Portal
access and programme/role availability. Explicit restrictions are never repaired.
Admission/integrity and ownership failures require review, not automatic retries.

No background retry loop is installed. A database/transport error returns an
operational failure without exposing error text; uncertain commit is deliberately
not reported successful. Retry the same subject/intent once infrastructure recovers.
Fresh eligibility and durable evidence decide whether it already succeeded.
Constraint/guard races get one bounded fresh read/classification, not a write loop.
Financial and admission finalization is never replayed to retry provisioning.

## KUN-76 integration obligations — not implemented here

1. Preserve existing authorized admission staff and Centre access checks. Construct
   subject IDs from verified server state, never bind request IDs/booleans wholesale.
2. Prepare and validate the locked admission and canonical financial evidence using
   the existing admission rules. Reorder/replace the current final marker block
   with this atomic operation. Do not append an unrelated best-effort intent write
   after the existing confirmation/audit. Review the exact cutover and recovery path,
   and retain the authorized staff actor/branch audit attribution for admission.
3. Ensure a genuinely new transition under the new contract creates the intent;
   no historical scan, OTP, login, session read, contact maintenance or existing
   confirmed-admission retry may manufacture one. Old partially finalized records
   without proof need explicit classification, not automatic intent repair.
4. After confirmation and whenever effective Portal access subsequently becomes
   available, attempt provisioning with this same durable intent and explicit
   account/programme. Never forward request-controlled timestamps. Revalidation
   at the SQL write boundary must remain intact, using current trusted server time.
5. Admission completion remains independent of referral availability. Persist/show
   operationally visible pending, restricted, inactive, review and retryable outcomes;
   retry provisioning independently with bounded scheduling and fresh eligibility.
6. Preserve trigger/constraint atomicity on the deployed D1 version and run an
   authorized disposable D1 integration/concurrency check before runtime rollout.
   Local SQLite proves statement rollback and deterministic interleavings; it
   cannot reproduce remote transport, replica/session routing or distributed races.

No KUN-74/75/76 hooks, administrator management UI, link generation or historical
backfill are part of this candidate. Deployment and remote migration remain separate
owner-authorized actions.
