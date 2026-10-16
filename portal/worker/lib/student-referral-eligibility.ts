import { ReferralRepository, type ReferralDb } from "./referral-repository";

export type StudentReferralEligibilityInput = {
  organisationId: string;
  personId: string;
  studentId: string;
  loginAccountId: string;
  referralProgrammeId: string;
  /** The caller must identify the admission; never infer a new admission from the latest enrolment. */
  admissionEnrolmentId: string;
  expectedReferrerProfileId?: string;
  /**
   * Trusted server-derived current time only; defaults to the server clock.
   * Explicit clocks support deterministic tests/internal diagnostics. Never forward
   * browser/request timestamps or use a historical result to authorize a write now.
   */
  now?: string;
};

export type StudentReferralIneligibilityReason =
  | "organisation_not_active" | "person_not_active" | "student_missing"
  | "person_organisation_mismatch" | "student_ownership_mismatch"
  | "login_account_missing" | "login_account_not_active" | "login_disabled"
  | "account_organisation_mismatch" | "global_identity_missing" | "global_identity_not_active"
  | "membership_missing" | "membership_suspended" | "membership_revoked" | "membership_not_active"
  | "membership_relationship_mismatch" | "account_identity_mismatch"
  | "self_link_missing" | "self_link_unavailable" | "non_self_account_person_link" | "different_linked_person"
  | "portal_access_disabled" | "student_alumni_role_not_active"
  | "programme_missing" | "programme_organisation_mismatch" | "programme_not_current" | "role_not_permitted"
  | "profile_ownership_conflict" | "admission_not_confirmed" | "admission_ownership_mismatch"
  | "admission_confirmation_inconsistent" | "admission_enrolment_status_requires_review";

export type StudentReferralEligibilityResult =
  | { status: "eligible_for_initial_provisioning"; reason: "eligible"; referrerTypes: StudentReferrerType[] }
  | { status: "already_active"; reason: "profile_active"; referrerProfileId: string; referrerTypes: StudentReferrerType[] }
  | { status: "inactive_profile_requires_review"; reason: "profile_inactive"; referrerProfileId: string }
  | {
    status: "ineligible_authentication" | "ineligible_self_link" | "ineligible_programme_or_role"
      | "ownership_or_tenant_conflict" | "ineligible_subject" | "ineligible_portal_access" | "ineligible_admission";
    reason: StudentReferralIneligibilityReason;
  };

type StudentReferrerType = "student" | "alumni";
type BlockedStatus = Extract<StudentReferralEligibilityResult, { reason: StudentReferralIneligibilityReason }>["status"];

// Admission creates 'confirmed'; auth/batch operations recognize the four current
// states below, and certificate approval supports their transition to 'completed'.
// Other lifecycle outcomes need explicit participation policy, not inference here.
const CONFIRMED_ADMISSION_ENROLMENT_STATUSES: readonly string[] = ["confirmed", "not_started", "active", "on_hold", "completed"];

/**
 * Internal, session-independent SELECT-only preflight. This is not authority to write:
 * orchestration must establish durable forward intent for a qualifying NEW admission
 * and recheck eligibility atomically with future provisioning. No repair/bootstrap helpers.
 */
export async function evaluateStudentReferralParticipationEligibility(
  db: ReferralDb,
  input: StudentReferralEligibilityInput,
): Promise<StudentReferralEligibilityResult> {
  // Capture once for consistent date-window and admission checks. This internal
  // injection point cannot authenticate a clock's provenance; callers must do so.
  const now = (input.now === undefined ? new Date() : new Date(input.now)).toISOString();
  const blocked = (status: BlockedStatus, reason: StudentReferralIneligibilityReason): StudentReferralEligibilityResult => ({ status, reason });
  const repo = new ReferralRepository(db);
  if (!await repo.findActiveOrganisation(input.organisationId)) return blocked("ineligible_subject", "organisation_not_active");
  const person = await db.prepare("select organisation_id, status from people where id = ?")
    .bind(input.personId).first<{ organisation_id: string; status: string }>();
  if (!person) return blocked("ineligible_subject", "person_not_active");
  if (person.organisation_id !== input.organisationId) return blocked("ownership_or_tenant_conflict", "person_organisation_mismatch");
  if (person.status !== "active") return blocked("ineligible_subject", "person_not_active");
  const student = await db.prepare("select organisation_id, person_id, portal_status from students where id = ?")
    .bind(input.studentId).first<{ organisation_id: string; person_id: string; portal_status: string }>();
  if (!student) return blocked("ineligible_subject", "student_missing");
  if (student.organisation_id !== input.organisationId || student.person_id !== input.personId) {
    return blocked("ownership_or_tenant_conflict", "student_ownership_mismatch");
  }

  // Person ownership is globally unique in the schema. Do not hide a wrong-tenant
  // profile with a tenant-filtered lookup, or treat a partner profile as a student one.
  const profiles = await db.prepare(
    `select p.id, p.organisation_id, p.person_id, p.active,
       exists(select 1 from education_partner_referrer_profiles ep where ep.referrer_profile_id = p.id) as is_partner
     from referrer_profiles p where p.person_id = ? or p.id = ?`,
  ).bind(input.personId, input.expectedReferrerProfileId ?? "").all<{
    id: string; organisation_id: string; person_id: string | null; active: number; is_partner: number;
  }>();
  if (profiles.results.length > 1 || profiles.results.some((p) =>
    p.organisation_id !== input.organisationId || p.person_id !== input.personId || p.is_partner === 1
    || (input.expectedReferrerProfileId !== undefined && p.id !== input.expectedReferrerProfileId),
  ) || (input.expectedReferrerProfileId !== undefined && profiles.results.length === 0)) {
    return blocked("ownership_or_tenant_conflict", "profile_ownership_conflict");
  }
  const profile = profiles.results[0];
  if (profile && profile.active !== 1) return { status: "inactive_profile_requires_review", reason: "profile_inactive", referrerProfileId: profile.id };

  const account = await db.prepare(
    `select organisation_id, status, login_enabled, global_identity_id, organisation_membership_id, mobile_normalized
     from login_accounts where id = ?`,
  ).bind(input.loginAccountId).first<{
    organisation_id: string; status: string; login_enabled: number; global_identity_id: string | null;
    organisation_membership_id: string | null; mobile_normalized: string;
  }>();
  if (!account) return blocked("ineligible_authentication", "login_account_missing");
  if (account.organisation_id !== input.organisationId) return blocked("ownership_or_tenant_conflict", "account_organisation_mismatch");
  if (account.status !== "active") return blocked("ineligible_authentication", "login_account_not_active");
  if (account.login_enabled !== 1) return blocked("ineligible_authentication", "login_disabled");
  const identity = await db.prepare("select id, status, mobile_normalized from global_identities where id = ?")
    .bind(account.global_identity_id).first<{ id: string; status: string; mobile_normalized: string }>();
  if (!identity) return blocked("ineligible_authentication", "global_identity_missing");
  if (identity.status !== "active") return blocked("ineligible_authentication", "global_identity_not_active");
  if (identity.mobile_normalized !== account.mobile_normalized) return blocked("ownership_or_tenant_conflict", "account_identity_mismatch");
  const membership = await db.prepare(
    "select id, organisation_id, login_account_id, global_identity_id, status from organisation_memberships where login_account_id = ?",
  ).bind(input.loginAccountId).first<{ id: string; organisation_id: string; login_account_id: string; global_identity_id: string; status: string }>();
  if (!membership) return blocked("ineligible_authentication", "membership_missing");
  // Unlike legacy session compatibility, automatic provisioning requires both pointers.
  if (membership.id !== account.organisation_membership_id || membership.organisation_id !== input.organisationId
    || membership.login_account_id !== input.loginAccountId || membership.global_identity_id !== identity.id) {
    return blocked("ownership_or_tenant_conflict", "membership_relationship_mismatch");
  }
  if (membership.status !== "active") return blocked("ineligible_authentication",
    membership.status === "suspended" ? "membership_suspended" : membership.status === "revoked" ? "membership_revoked" : "membership_not_active");

  const links = await db.prepare("select person_id, access_type, is_available from login_account_people where login_account_id = ?")
    .bind(input.loginAccountId).all<{ person_id: string; access_type: string; is_available: number }>();
  if (links.results.some((link) => link.person_id !== input.personId && (link.is_available === 1 || link.access_type === "self"))) {
    return blocked("ownership_or_tenant_conflict", "different_linked_person");
  }
  const self = links.results.find((link) => link.person_id === input.personId);
  if (!self) return blocked("ineligible_self_link", "self_link_missing");
  if (self.access_type !== "self") return blocked("ineligible_self_link", "non_self_account_person_link");
  if (self.is_available !== 1) return blocked("ineligible_self_link", "self_link_unavailable");
  if (student.portal_status === "disabled") return blocked("ineligible_portal_access", "portal_access_disabled");

  // Same active Person-role and tenant rules as auth-store.getPersonRoles;
  // Student current status is not a gate; confirmed admission evidence below must
  // remain compatible with course completion and active alumni access.
  const roles = await db.prepare(
    `select distinct r.code from person_roles pr join roles r on r.id = pr.role_id
     where pr.person_id = ? and r.organisation_id = ? and pr.status = 'active' and r.code in ('student', 'alumni')
     order by r.code`,
  ).bind(input.personId, input.organisationId).all<{ code: StudentReferrerType }>();
  if (!roles.results.length) return blocked("ineligible_programme_or_role", "student_alumni_role_not_active");
  const programme = await db.prepare("select organisation_id from referral_programmes where id = ?")
    .bind(input.referralProgrammeId).first<{ organisation_id: string }>();
  if (!programme) return blocked("ineligible_programme_or_role", "programme_missing");
  if (programme.organisation_id !== input.organisationId) return blocked("ownership_or_tenant_conflict", "programme_organisation_mismatch");
  const currentProgramme = await repo.findCurrentProgramme(input.organisationId, input.referralProgrammeId, now);
  if (!currentProgramme || [currentProgramme.starts_at, currentProgramme.ends_at].some((date) => date !== null && !Number.isFinite(Date.parse(date)))) {
    return blocked("ineligible_programme_or_role", "programme_not_current");
  }
  const types = await db.prepare("select referrer_type from referral_programme_referrer_types where referral_programme_id = ?")
    .bind(input.referralProgrammeId).all<{ referrer_type: string }>();
  const referrerTypes = roles.results.map((role) => role.code).filter((role) => types.results.some((type) => type.referrer_type === role));
  if (!referrerTypes.length) return blocked("ineligible_programme_or_role", "role_not_permitted");

  const admission = await confirmedAdmissionReason(db, input, now);
  if (admission) return blocked(admission === "admission_ownership_mismatch" ? "ownership_or_tenant_conflict" : "ineligible_admission", admission);
  return profile
    ? { status: "already_active", reason: "profile_active", referrerProfileId: profile.id, referrerTypes }
    : { status: "eligible_for_initial_provisioning", reason: "eligible", referrerTypes };
}

async function confirmedAdmissionReason(db: ReferralDb, input: StudentReferralEligibilityInput, now: string): Promise<StudentReferralIneligibilityReason | null> {
  const enrolment = await db.prepare(
    `select e.student_id, e.enquiry_id, e.branch_id, e.course_id, e.status, b.organisation_id as branch_org, c.organisation_id as course_org
     from enrolments e join branches b on b.id = e.branch_id join courses c on c.id = e.course_id where e.id = ?`,
  ).bind(input.admissionEnrolmentId).first<{
    student_id: string; enquiry_id: string | null; branch_id: string; course_id: string; status: string; branch_org: string; course_org: string;
  }>();
  if (!enrolment) return "admission_not_confirmed";
  if (enrolment.student_id !== input.studentId || enrolment.branch_org !== input.organisationId || enrolment.course_org !== input.organisationId) return "admission_ownership_mismatch";
  const enquiry = await db.prepare("select organisation_id, person_id, branch_id, status, pipeline_stage, converted_enrolment_id from enquiries where id = ?")
    .bind(enrolment.enquiry_id).first<{ organisation_id: string; person_id: string | null; branch_id: string; status: string; pipeline_stage: string; converted_enrolment_id: string | null }>();
  if (!enquiry) return "admission_not_confirmed";
  if (enquiry.organisation_id !== input.organisationId || enquiry.person_id !== input.personId || enquiry.branch_id !== enrolment.branch_id) return "admission_ownership_mismatch";
  if (enquiry.status !== "converted" || enquiry.pipeline_stage !== "converted" || enquiry.converted_enrolment_id !== input.admissionEnrolmentId) return "admission_confirmation_inconsistent";
  const drafts = await db.prepare(
    `select id, organisation_id, person_id, branch_id, status, confirmed_at, confirmation_locked_at,
       confirmation_snapshot_version, confirmation_snapshot_json from admission_drafts where enquiry_id = ? and status != 'cancelled'`,
  ).bind(enrolment.enquiry_id).all<{
    id: string; organisation_id: string; person_id: string; branch_id: string; status: string; confirmed_at: string | null;
    confirmation_locked_at: string | null; confirmation_snapshot_version: string | null; confirmation_snapshot_json: string | null;
  }>();
  if (drafts.results.length === 0) return "admission_not_confirmed";
  if (drafts.results.length !== 1) return "admission_confirmation_inconsistent";
  const draft = drafts.results[0];
  if (draft.organisation_id !== input.organisationId || draft.person_id !== input.personId || draft.branch_id !== enrolment.branch_id) return "admission_ownership_mismatch";
  if (draft.status !== "confirmed" || !draft.confirmed_at) return "admission_not_confirmed";
  if (enrolment.status === "provisional") return "admission_confirmation_inconsistent";
  if (!CONFIRMED_ADMISSION_ENROLMENT_STATUSES.includes(enrolment.status)) return "admission_enrolment_status_requires_review";
  const confirmed = Date.parse(draft.confirmed_at);
  const locked = Date.parse(draft.confirmation_locked_at ?? "");
  if (!Number.isFinite(confirmed) || !Number.isFinite(locked) || locked > confirmed || confirmed > Date.parse(now)
    || draft.confirmation_snapshot_version !== "admission-confirmation-v1") return "admission_confirmation_inconsistent";
  try {
    const snapshot: unknown = JSON.parse(draft.confirmation_snapshot_json ?? "null");
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "admission_confirmation_inconsistent";
    const expected = {
      version: "admission-confirmation-v1", organisationId: input.organisationId, personId: input.personId,
      enquiryId: enrolment.enquiry_id, draftId: draft.id, branchId: enrolment.branch_id, courseId: enrolment.course_id,
    };
    if (!Object.entries(expected).every(([key, value]) => (snapshot as Record<string, unknown>)[key] === value)) return "admission_confirmation_inconsistent";
  } catch {
    return "admission_confirmation_inconsistent";
  }
  return null;
}
