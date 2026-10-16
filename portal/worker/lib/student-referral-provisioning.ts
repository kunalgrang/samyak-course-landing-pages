import type { ReferralDb } from "./referral-repository";
import {
  evaluateStudentReferralParticipationEligibility,
  type StudentReferralEligibilityInput,
  type StudentReferralEligibilityResult,
} from "./student-referral-eligibility";

export type ForwardAdmissionSubject = {
  organisationId: string;
  personId: string;
  studentId: string;
  admissionEnrolmentId: string;
  draftId: string;
  enquiryId: string;
};
export type ForwardReferralInput = ForwardAdmissionSubject & {
  intentId: string;
  loginAccountId: string;
  referralProgrammeId: string;
};
export type ForwardReferralResult = {
  status: "created" | "already_provisioned" | "waiting" | "restricted"
    | "inactive_profile_requires_admin" | "invalid_forward_intent" | "ownership_conflict"
    | "retryable_failure" | "integrity_conflict";
  reason: string;
  referrerProfileId?: string;
};
export type ForwardIntentResult = {
  status: "recorded" | "already_recorded" | "invalid_forward_intent" | "ownership_conflict"
    | "integrity_conflict" | "retryable_failure";
  intentId: string;
  reason: string;
};
type IntentRow = {
  id: string; organisation_id: string; person_id: string; student_id: string;
  enrolment_id: string; draft_id: string; enquiry_id: string; snapshot_json: string;
  confirmation_audit_id: string; created_at: string;
};

const intentIdFor = (enrolmentId: string) => `sr-intent:${enrolmentId}`;

/**
 * Trusted INTERNAL final-marker operation, deliberately not imported by runtime routes.
 * KUN-76 must use this IN PLACE OF the existing final-marker writes after preparing
 * and validating the admission, with existing staff/centre authorization. It is not
 * an "append intent to an already confirmed admission" or historical repair API.
 * SQLite triggers assert the prepared state and atomically finalize both markers,
 * intent and its qualifying audit. No caller clock or caller eligibility boolean.
 */
export async function recordForwardAdmissionConfirmation(
  db: ReferralDb,
  input: ForwardAdmissionSubject,
): Promise<ForwardIntentResult> {
  const intentId = intentIdFor(input.admissionEnrolmentId);
  const result = (status: ForwardIntentResult["status"], reason: string): ForwardIntentResult => ({ status, intentId, reason });
  try {
    const existing = await findIntent(db, intentId);
    if (existing) {
      if (!sameSubject(existing, input)) return result("ownership_conflict", "intent_subject_mismatch");
      return await validIntentEvidence(db, existing)
        ? result("already_recorded", "durable_confirmation_exists") : result("integrity_conflict", "intent_evidence_changed");
    }
    const draft = await db.prepare("select organisation_id, person_id, enquiry_id, status, confirmation_snapshot_json from admission_drafts where id = ?")
      .bind(input.draftId).first<{ organisation_id: string; person_id: string; enquiry_id: string; status: string; confirmation_snapshot_json: string | null }>();
    if (!draft) return result("invalid_forward_intent", "draft_missing");
    if (draft.organisation_id !== input.organisationId || draft.person_id !== input.personId || draft.enquiry_id !== input.enquiryId) {
      return result("ownership_conflict", "draft_subject_mismatch");
    }
    if (draft.status !== "draft" || !draft.confirmation_snapshot_json) return result("invalid_forward_intent", "not_a_new_confirmation");
    const write = await db.prepare(
      `insert into student_referral_admission_intents
        (id, organisation_id, person_id, student_id, enrolment_id, draft_id, enquiry_id, confirmation_audit_id, snapshot_json)
       select ?, ?, ?, ?, ?, ?, ?, ?, confirmation_snapshot_json from admission_drafts
       where id = ? and confirmation_snapshot_json = ? returning id`,
    ).bind(intentId, input.organisationId, input.personId, input.studentId, input.admissionEnrolmentId,
      input.draftId, input.enquiryId, `sr-confirm:${input.admissionEnrolmentId}`, input.draftId, draft.confirmation_snapshot_json).all<{ id: string }>();
    // Zero rows is NOT an SQL error and triggers did not run. Never report success.
    if (write.results.length !== 1 || write.results[0].id !== intentId) return result("integrity_conflict", "confirmation_changed_before_write");
    return result("recorded", "new_confirmation_committed");
  } catch (error) {
    if (!isIntegrityError(error)) return result("retryable_failure", "database_operation_failed_retry_same_subject");
    // A simultaneous/uncertain successful request is reconciled by exact evidence,
    // not by swallowing a UNIQUE violation. This is one bounded read, no write retry.
    try {
      const existing = await findIntent(db, intentId);
      if (existing && sameSubject(existing, input) && await validIntentEvidence(db, existing)) {
        return result("already_recorded", "durable_confirmation_exists");
      }
    } catch { return result("retryable_failure", "confirmation_reconciliation_failed"); }
    return result("integrity_conflict", "confirmation_guard_or_constraint_rejected");
  }
}

/** Independently retryable; never replays admission/auth/financial processing. */
export async function ensureForwardStudentReferralParticipation(
  db: ReferralDb,
  input: ForwardReferralInput,
): Promise<ForwardReferralResult> {
  try {
    const preflight = await classify(db, input);
    if (preflight) return preflight;
    const write = await db.prepare(
      `insert into student_referral_provisioning_events
         (intent_id, person_id, profile_id, login_account_id, programme_id, audit_id)
       values (?, ?, ?, ?, ?, ?) returning intent_id`,
    ).bind(input.intentId, input.personId, `sr-profile:${input.personId}`, input.loginAccountId,
      input.referralProgrammeId, `sr-provision:${input.personId}`).all<{ intent_id: string }>();
    if (write.results.length !== 1 || write.results[0].intent_id !== input.intentId) return { status: "integrity_conflict", reason: "provisioning_write_count" };
    return { status: "created", reason: "profile_and_audit_committed", referrerProfileId: `sr-profile:${input.personId}` };
  } catch (error) {
    if (!isIntegrityError(error)) return { status: "retryable_failure", reason: "database_operation_failed_retry_same_intent" };
    try {
      // Fresh SELECT classification explains restrictions that won the serialized
      // race. No alternative account lookup, no unbounded retry, no stale success.
      const current = await classify(db, input);
      if (current) return current;
    } catch { return { status: "retryable_failure", reason: "provisioning_reconciliation_failed" }; }
    return { status: "integrity_conflict", reason: "write_guard_or_constraint_rejected" };
  }
}

async function findIntent(db: ReferralDb, id: string) {
  return db.prepare("select * from student_referral_admission_intents where id = ?").bind(id).first<IntentRow>();
}
function sameSubject(row: IntentRow, input: ForwardAdmissionSubject) {
  return row.organisation_id === input.organisationId && row.person_id === input.personId && row.student_id === input.studentId
    && row.enrolment_id === input.admissionEnrolmentId && row.draft_id === input.draftId && row.enquiry_id === input.enquiryId;
}
async function validIntentEvidence(db: ReferralDb, row: IntentRow) {
  if (row.id !== intentIdFor(row.enrolment_id) || row.confirmation_audit_id !== `sr-confirm:${row.enrolment_id}`) return false;
  return Boolean(await db.prepare(
    `select 1 as ok from student_referral_admission_evidence v join audit_logs a on a.id = ?
     where v.draft_id = ? and v.enquiry_id = ? and v.organisation_id = ? and v.person_id = ?
       and v.student_id = ? and v.enrolment_id = ? and v.snapshot_json = ?
       and v.draft_status = 'confirmed' and v.confirmed_at = ?
       and v.enquiry_status = 'converted' and v.pipeline_stage = 'converted' and v.converted_enrolment_id = ?
       and a.organisation_id = ? and a.action = 'student_referral.forward_confirmation'
       and a.entity_type = 'student_referral_admission_intent' and a.entity_id = ?`,
  ).bind(row.confirmation_audit_id, row.draft_id, row.enquiry_id, row.organisation_id, row.person_id,
    row.student_id, row.enrolment_id, row.snapshot_json, row.created_at, row.enrolment_id, row.organisation_id, row.id).first());
}
async function classify(db: ReferralDb, input: ForwardReferralInput): Promise<ForwardReferralResult | null> {
  if (input.intentId !== intentIdFor(input.admissionEnrolmentId)) return { status: "invalid_forward_intent", reason: "intent_identifier_mismatch" };
  const intent = await findIntent(db, input.intentId);
  if (!intent) return { status: "invalid_forward_intent", reason: "durable_intent_missing" };
  if (!sameSubject(intent, input)) return { status: "ownership_conflict", reason: "intent_subject_mismatch" };
  if (!await validIntentEvidence(db, intent)) return { status: "integrity_conflict", reason: "intent_evidence_changed" };
  // Deliberately enumerate accepted inputs. Extra runtime properties (including now)
  // cannot flow through to KUN-72. Default time is captured once by that evaluator.
  const eligibilityInput: StudentReferralEligibilityInput = {
    organisationId: input.organisationId, personId: input.personId, studentId: input.studentId,
    admissionEnrolmentId: input.admissionEnrolmentId, loginAccountId: input.loginAccountId,
    referralProgrammeId: input.referralProgrammeId,
  };
  const eligibility = await evaluateStudentReferralParticipationEligibility(db, eligibilityInput);
  if (eligibility.status === "inactive_profile_requires_review") return { status: "inactive_profile_requires_admin", reason: eligibility.reason, referrerProfileId: eligibility.referrerProfileId };
  const blocked = blockedEligibility(eligibility);
  if (blocked) return blocked;
  const event = await db.prepare(
    `select e.profile_id, e.person_id, a.id as audit_id from student_referral_provisioning_events e
     left join audit_logs a on a.id = e.audit_id and a.action = 'student_referral.profile_created'
       and a.organisation_id = ? and a.entity_type = 'referrer_profile' and a.entity_id = e.profile_id
     where e.person_id = ? or e.intent_id = ?`,
  ).bind(input.organisationId, input.personId, input.intentId).all<{ profile_id: string; person_id: string; audit_id: string | null }>();
  if (event.results.length && (event.results.length !== 1 || !event.results[0].audit_id || event.results[0].person_id !== input.personId
    || eligibility.status !== "already_active" || event.results[0].profile_id !== eligibility.referrerProfileId)) {
    return { status: "integrity_conflict", reason: "provisioning_evidence_inconsistent" };
  }
  if (eligibility.status === "already_active") return { status: "already_provisioned", reason: "existing_active_profile", referrerProfileId: eligibility.referrerProfileId };
  return null;
}
function blockedEligibility(value: StudentReferralEligibilityResult): ForwardReferralResult | null {
  switch (value.status) {
    case "eligible_for_initial_provisioning": case "already_active": case "inactive_profile_requires_review": return null;
    case "ownership_or_tenant_conflict": return { status: "ownership_conflict", reason: value.reason };
    case "ineligible_admission": return { status: "integrity_conflict", reason: value.reason };
    case "ineligible_authentication": return {
      status: ["login_account_missing", "membership_missing", "global_identity_missing"].includes(value.reason) ? "waiting" : "restricted",
      reason: value.reason,
    };
    case "ineligible_subject": return { status: "integrity_conflict", reason: value.reason };
    default: return { status: "waiting", reason: value.reason };
  }
}
function isIntegrityError(error: unknown): boolean {
  // D1 wraps SQLite errors, so inspect only known constraint/guard signatures.
  // Error text is never returned or logged (may contain data).
  return error instanceof Error && /student_referral_|SQLITE_CONSTRAINT|UNIQUE constraint failed|FOREIGN KEY constraint failed|CHECK constraint failed/.test(error.message);
}
