import type { AppContext } from "./http";
import { ORG_ID } from "./auth-store";
import { createOpaqueId } from "./crypto";
import type { StaffContext } from "./staff-auth";

export const CERTIFICATE_APPLICATION_STATUSES = ["submitted", "approved", "needs_attention", "certificate_issued", "cancelled"] as const;
export type CertificateApplicationStatus = (typeof CERTIFICATE_APPLICATION_STATUSES)[number];
export const LOW_FEEDBACK_AVERAGE_THRESHOLD = 2.5;
export const LOW_FEEDBACK_OVERALL_THRESHOLD = 2;

export type CertificateApplicationInput = {
  enrolmentId: string;
  studentCompletionConfirmed: boolean;
  certificateDetailsConfirmed: boolean;
  feedbackTrainerClarityScore: number;
  feedbackPracticalLearningScore: number;
  feedbackCourseExpectationScore: number;
  feedbackOverallScore: number;
  feedbackImprovementText?: string | null;
};

type ApplicationEligibilityRow = {
  enrolment_id: string;
  enrolment_number: string;
  enrolment_status: string;
  branch_id: string;
  branch_name: string | null;
  organisation_id: string;
  person_id: string;
  person_status: string;
  person_name: string;
  official_full_name: string | null;
  student_id: string;
  student_number: string;
  student_status: string;
  course_id: string;
  course_code: string;
  course_name: string;
  course_status: string;
  duration_label: string | null;
  joining_date: string;
  actual_completion_date: string | null;
  batch_id: string | null;
  batch_name: string | null;
  application_id: string | null;
  application_status: CertificateApplicationStatus | null;
  application_applied_at: string | null;
  application_low_feedback_flag: number | null;
  certificate_id: string | null;
  certificate_number: string | null;
  verification_code: string | null;
};

export type CertificateApplicationRecord = {
  id: string;
  organisation_id: string;
  branch_id: string;
  person_id: string;
  student_id: string;
  enrolment_id: string;
  course_id: string;
  status: CertificateApplicationStatus;
  student_completion_confirmed: number;
  certificate_details_confirmed: number;
  feedback_trainer_clarity_score: number;
  feedback_practical_learning_score: number;
  feedback_course_expectation_score: number;
  feedback_overall_score: number;
  feedback_improvement_text: string | null;
  low_feedback_flag: number;
  applied_at: string;
  reviewed_at: string | null;
  reviewed_by_actor_id: string | null;
  completion_date: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
};

export async function listStudentCertificateApplications(c: AppContext, personId: string) {
  const rows = await c.env.DB.prepare(
    `select
       enrolments.id as enrolment_id,
       enrolments.enrolment_number,
       enrolments.status as enrolment_status,
       enrolments.branch_id,
       branches.name as branch_name,
       students.organisation_id,
       people.id as person_id,
       people.status as person_status,
       people.full_name as person_name,
       person_identity_details.official_full_name,
       students.id as student_id,
       students.student_number,
       students.current_status as student_status,
       courses.id as course_id,
       courses.code as course_code,
       courses.name as course_name,
       courses.status as course_status,
       courses.duration_label,
       enrolments.joining_date,
       enrolments.actual_completion_date,
       active_batch.id as batch_id,
       active_batch.name as batch_name,
       certificate_applications.id as application_id,
       certificate_applications.status as application_status,
       certificate_applications.applied_at as application_applied_at,
       certificate_applications.low_feedback_flag as application_low_feedback_flag,
       certificates.id as certificate_id,
       certificates.certificate_number,
       certificates.verification_code
     from enrolments
     join students on students.id = enrolments.student_id
     join people on people.id = students.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     join courses on courses.id = enrolments.course_id
     left join branches on branches.id = enrolments.branch_id
     left join batch_memberships on batch_memberships.enrolment_id = enrolments.id
       and batch_memberships.status = 'active'
       and batch_memberships.left_at is null
     left join batches active_batch on active_batch.id = batch_memberships.batch_id
     left join certificate_applications on certificate_applications.organisation_id = students.organisation_id
       and certificate_applications.enrolment_id = enrolments.id
       and certificate_applications.status in ('submitted', 'approved', 'needs_attention', 'certificate_issued')
     left join certificates on certificates.organisation_id = students.organisation_id
       and certificates.enrolment_id = enrolments.id
       and certificates.status = 'issued'
     where students.organisation_id = ?
       and people.id = ?
     order by enrolments.joining_date desc, enrolments.id desc`,
  )
    .bind(ORG_ID, personId)
    .all<ApplicationEligibilityRow>();

  return {
    items: (rows.results || []).map((row) => ({
      enrolment: publicStudentEnrolment(row),
      certificate: row.certificate_id
        ? {
            id: row.certificate_id,
            certificate_number: row.certificate_number,
            verification_code: row.verification_code,
          }
        : null,
      application: row.application_id
        ? {
            id: row.application_id,
            status: row.application_status,
            applied_at: row.application_applied_at,
            low_feedback_flag: Boolean(row.application_low_feedback_flag),
          }
        : null,
      applicationEligibility: applicationEligibilityForRow(row),
    })),
  };
}

export async function submitCertificateApplication(c: AppContext, personId: string, input: CertificateApplicationInput) {
  const row = await loadStudentEnrolmentRow(c, personId, input.enrolmentId);
  if (!row) return { ok: false as const, status: 404, code: "enrolment_not_found", message: "This enrolment was not found." };

  const eligibility = applicationEligibilityForRow(row);
  if (row.application_id && row.application_status) {
    return {
      ok: true as const,
      status: 200,
      idempotent: true,
      application: {
        id: row.application_id,
        status: row.application_status,
        applied_at: row.application_applied_at,
        low_feedback_flag: Boolean(row.application_low_feedback_flag),
      },
    };
  }
  if (!eligibility.eligible) {
    return { ok: false as const, status: 409, code: "not_eligible", message: "This enrolment is not ready for certificate application.", reasons: eligibility.reasons };
  }
  const validation = validateApplicationInput(input);
  if (!validation.ok) return validation;

  const now = new Date().toISOString();
  const applicationId = createOpaqueId("certapp");
  const lowFeedback = hasLowFeedback(input) ? 1 : 0;
  const comment = normalizeComment(input.feedbackImprovementText);
  const application = {
    id: applicationId,
    status: "submitted" as const,
    applied_at: now,
    low_feedback_flag: Boolean(lowFeedback),
  };

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `insert into certificate_applications
          (id, organisation_id, branch_id, person_id, student_id, enrolment_id, course_id, status,
           student_completion_confirmed, certificate_details_confirmed, feedback_trainer_clarity_score,
           feedback_practical_learning_score, feedback_course_expectation_score, feedback_overall_score,
           feedback_improvement_text, low_feedback_flag, applied_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, 'submitted', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        applicationId,
        ORG_ID,
        row.branch_id,
        row.person_id,
        row.student_id,
        row.enrolment_id,
        row.course_id,
        input.feedbackTrainerClarityScore,
        input.feedbackPracticalLearningScore,
        input.feedbackCourseExpectationScore,
        input.feedbackOverallScore,
        comment,
        lowFeedback,
        now,
        now,
        now,
      ),
      applicationEvent(c, {
        applicationId,
        branchId: row.branch_id,
        actorLoginAccountId: null,
        actorPersonId: row.person_id,
        action: "submitted",
        fromStatus: null,
        toStatus: "submitted",
        note: null,
        metadata: { enrolmentId: row.enrolment_id, studentId: row.student_id, courseId: row.course_id, lowFeedback: Boolean(lowFeedback) },
        now,
      }),
    ]);
  } catch (error) {
    const existing = await activeApplicationForEnrolment(c, row.enrolment_id);
    if (existing) {
      return {
        ok: true as const,
        status: 200,
        idempotent: true,
        application: {
          id: existing.id,
          status: existing.status,
          applied_at: existing.applied_at,
          low_feedback_flag: Boolean(existing.low_feedback_flag),
        },
      };
    }
    throw error;
  }

  return { ok: true as const, status: 201, idempotent: false, application };
}

export async function listStaffCertificateApplications(c: AppContext, staff: StaffContext, input: { q?: string; status?: string; limit: number; offset: number }) {
  const params: unknown[] = [ORG_ID, staff.loginAccountId, ORG_ID];
  const filters = [
    "certificate_applications.organisation_id = ?",
    `exists (
       select 1
       from login_account_roles
       join roles on roles.id = login_account_roles.role_id
       where login_account_roles.login_account_id = ?
         and roles.organisation_id = ?
         and roles.code in ('owner', 'system_admin', 'admin', 'admission_admin')
         and (login_account_roles.branch_id is null or login_account_roles.branch_id = certificate_applications.branch_id)
     )`,
  ];
  if (input.status && CERTIFICATE_APPLICATION_STATUSES.includes(input.status as CertificateApplicationStatus)) {
    filters.push("certificate_applications.status = ?");
    params.push(input.status);
  }
  if (input.q) {
    filters.push("(people.full_name like ? or person_identity_details.official_full_name like ? or students.student_number like ? or courses.name like ?)");
    const q = `%${input.q}%`;
    params.push(q, q, q, q);
  }
  params.push(input.limit + 1, input.offset);
  const rows = await c.env.DB.prepare(
    `select
       certificate_applications.id,
       certificate_applications.status,
       certificate_applications.applied_at,
       certificate_applications.low_feedback_flag,
       certificate_applications.feedback_overall_score,
       certificate_applications.feedback_trainer_clarity_score,
       certificate_applications.feedback_practical_learning_score,
       certificate_applications.feedback_course_expectation_score,
       certificate_applications.enrolment_id,
       certificate_applications.course_id,
       coalesce(person_identity_details.official_full_name, people.full_name) as student_name,
       students.student_number,
       courses.name as course_name,
       enrolments.status as enrolment_status,
       enrolments.joining_date,
       enrolments.actual_completion_date
     from certificate_applications
     join people on people.id = certificate_applications.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     join students on students.id = certificate_applications.student_id
     join courses on courses.id = certificate_applications.course_id
     join enrolments on enrolments.id = certificate_applications.enrolment_id
     where ${filters.join(" and ")}
     order by certificate_applications.applied_at desc, certificate_applications.id desc
     limit ? offset ?`,
  )
    .bind(...params)
    .all<Record<string, unknown>>();
  const results = rows.results || [];
  return { items: results.slice(0, input.limit), pagination: { limit: input.limit, offset: input.offset, hasMore: results.length > input.limit } };
}

export async function getStaffCertificateApplication(c: AppContext, staff: StaffContext, applicationId: string) {
  const row = await c.env.DB.prepare(
    `select
       certificate_applications.*,
       coalesce(person_identity_details.official_full_name, people.full_name) as student_name,
       students.student_number,
       courses.name as course_name,
       courses.code as course_code,
       enrolments.status as enrolment_status,
       enrolments.enrolment_number,
       enrolments.joining_date,
       enrolments.actual_completion_date,
       batches.name as batch_name
     from certificate_applications
     join people on people.id = certificate_applications.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     join students on students.id = certificate_applications.student_id
     join courses on courses.id = certificate_applications.course_id
     join enrolments on enrolments.id = certificate_applications.enrolment_id
     left join batch_memberships on batch_memberships.enrolment_id = enrolments.id
       and batch_memberships.status = 'active'
       and batch_memberships.left_at is null
     left join batches on batches.id = batch_memberships.batch_id
     where certificate_applications.organisation_id = ?
       and certificate_applications.id = ?
       and exists (
         select 1
         from login_account_roles
         join roles on roles.id = login_account_roles.role_id
         where login_account_roles.login_account_id = ?
           and roles.organisation_id = ?
           and roles.code in ('owner', 'system_admin', 'admin', 'admission_admin')
           and (login_account_roles.branch_id is null or login_account_roles.branch_id = certificate_applications.branch_id)
       )
     limit 1`,
  )
    .bind(ORG_ID, applicationId, staff.loginAccountId, ORG_ID)
    .first<Record<string, unknown>>();
  return row || null;
}

export async function markCertificateApplicationNeedsAttention(c: AppContext, staff: StaffContext, applicationId: string, note: string | null) {
  const current = await getStaffCertificateApplication(c, staff, applicationId);
  if (!current) return { ok: false as const, status: 404, code: "application_not_found", message: "Certificate application was not found." };
  const currentStatus = String(current.status);
  if (currentStatus === "certificate_issued") return { ok: false as const, status: 409, code: "already_issued", message: "This application already has an issued certificate." };
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `update certificate_applications
       set status = 'needs_attention', decision_note = ?, reviewed_at = ?, reviewed_by_actor_id = ?, updated_at = ?
       where id = ? and organisation_id = ? and status in ('submitted', 'approved', 'needs_attention')`,
    ).bind(note, now, staff.loginAccountId, now, applicationId, ORG_ID),
    applicationEvent(c, {
      applicationId,
      branchId: String(current.branch_id),
      actorLoginAccountId: staff.loginAccountId,
      actorPersonId: staff.activePersonId,
      action: "needs_attention",
      fromStatus: currentStatus,
      toStatus: "needs_attention",
      note,
      metadata: { enrolmentId: current.enrolment_id },
      now,
    }),
  ]);
  return { ok: true as const };
}

export async function approveCourseCompletionFromApplication(c: AppContext, staff: StaffContext, applicationId: string, completionDate: string) {
  const current = await getStaffCertificateApplication(c, staff, applicationId);
  if (!current) return { ok: false as const, status: 404, code: "application_not_found", message: "Certificate application was not found." };
  if (current.status === "certificate_issued") return { ok: false as const, status: 409, code: "already_issued", message: "This application already has an issued certificate." };
  if (current.status === "approved" && current.enrolment_status === "completed" && current.completion_date === completionDate) {
    return { ok: true as const, idempotent: true };
  }
  const validation = validateCompletionDate(completionDate, String(current.joining_date));
  if (!validation.ok) return validation;
  if (!["submitted", "needs_attention", "approved"].includes(String(current.status))) {
    return { ok: false as const, status: 409, code: "invalid_status", message: "This application cannot be approved." };
  }
  if (!["active", "on_hold", "completed"].includes(String(current.enrolment_status))) {
    return { ok: false as const, status: 409, code: "invalid_enrolment_status", message: "This enrolment cannot be completed from a certificate application." };
  }
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `update enrolments
       set status = 'completed', actual_completion_date = ?, updated_at = ?
       where id = ? and status in ('active', 'on_hold', 'completed')`,
    ).bind(completionDate, now, current.enrolment_id),
    c.env.DB.prepare(
      `update students
       set current_status = 'completed', updated_at = ?
       where id = ? and current_status in ('active', 'on_hold', 'completed')`,
    ).bind(now, current.student_id),
    c.env.DB.prepare(
      `update certificate_applications
       set status = 'approved', completion_date = ?, reviewed_at = ?, reviewed_by_actor_id = ?, updated_at = ?
       where id = ? and organisation_id = ? and status in ('submitted', 'needs_attention', 'approved')`,
    ).bind(completionDate, now, staff.loginAccountId, now, applicationId, ORG_ID),
    applicationEvent(c, {
      applicationId,
      branchId: String(current.branch_id),
      actorLoginAccountId: staff.loginAccountId,
      actorPersonId: staff.activePersonId,
      action: "approved",
      fromStatus: String(current.status),
      toStatus: "approved",
      note: null,
      metadata: { enrolmentId: current.enrolment_id, completionDate },
      now,
    }),
  ]);
  return { ok: true as const, idempotent: false };
}

export async function markApplicationCertificateIssued(c: AppContext, staff: StaffContext, certificate: { enrolment_id: string; branch_id: string }) {
  const application = await activeApplicationForEnrolment(c, certificate.enrolment_id);
  if (!application || application.status !== "approved") return;
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `update certificate_applications
       set status = 'certificate_issued', updated_at = ?
       where id = ? and organisation_id = ? and status = 'approved'`,
    ).bind(now, application.id, ORG_ID),
    applicationEvent(c, {
      applicationId: application.id,
      branchId: certificate.branch_id,
      actorLoginAccountId: staff.loginAccountId,
      actorPersonId: staff.activePersonId,
      action: "certificate_issued",
      fromStatus: "approved",
      toStatus: "certificate_issued",
      note: null,
      metadata: { enrolmentId: certificate.enrolment_id },
      now,
    }),
  ]);
}

function publicStudentEnrolment(row: ApplicationEligibilityRow) {
  return {
    enrolment_id: row.enrolment_id,
    enrolment_number: row.enrolment_number,
    student_name: row.official_full_name || row.person_name,
    student_number: row.student_number,
    student_status: row.student_status,
    course_id: row.course_id,
    course_code: row.course_code,
    course_name: row.course_name,
    course_status: row.course_status,
    duration_label: row.duration_label,
    joining_date: row.joining_date,
    actual_completion_date: row.actual_completion_date,
    status: row.enrolment_status,
    batch_id: row.batch_id,
    batch_name: row.batch_name,
  };
}

function applicationEligibilityForRow(row: ApplicationEligibilityRow) {
  const reasons: string[] = [];
  if (row.organisation_id !== ORG_ID) reasons.push("wrong_organisation");
  if (row.person_status !== "active") reasons.push("person_inactive");
  if (row.student_status === "archived") reasons.push("student_archived");
  if (!["active", "on_hold"].includes(row.student_status)) reasons.push(`student_${row.student_status}`);
  if (row.course_status !== "active") reasons.push("course_inactive");
  if (!["active", "on_hold"].includes(row.enrolment_status)) reasons.push(`enrolment_${row.enrolment_status}`);
  if (row.application_id && row.application_status !== "certificate_issued") reasons.push("application_already_submitted");
  if (row.certificate_id) reasons.push("certificate_already_issued");
  return { eligible: reasons.length === 0, reasons };
}

function validateApplicationInput(input: CertificateApplicationInput) {
  if (!input.studentCompletionConfirmed || !input.certificateDetailsConfirmed) {
    return { ok: false as const, status: 400, code: "confirmations_required", message: "Please confirm completion and certificate details before applying." };
  }
  const scores = [
    input.feedbackTrainerClarityScore,
    input.feedbackPracticalLearningScore,
    input.feedbackCourseExpectationScore,
    input.feedbackOverallScore,
  ];
  if (scores.some((score) => !Number.isInteger(score) || score < 1 || score > 5)) {
    return { ok: false as const, status: 400, code: "invalid_feedback", message: "Please answer all feedback questions from 1 to 5." };
  }
  const comment = normalizeComment(input.feedbackImprovementText);
  if (comment && comment.length > 1000) {
    return { ok: false as const, status: 400, code: "comment_too_long", message: "Feedback comments must be 1000 characters or less." };
  }
  return { ok: true as const };
}

function validateCompletionDate(completionDate: string, joiningDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completionDate)) {
    return { ok: false as const, status: 400, code: "invalid_completion_date", message: "Enter a valid completion date." };
  }
  if (completionDate < joiningDate.slice(0, 10)) {
    return { ok: false as const, status: 400, code: "completion_before_joining", message: "Completion date cannot be before joining date." };
  }
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (completionDate > tomorrow) {
    return { ok: false as const, status: 400, code: "completion_date_future", message: "Completion date cannot be far in the future." };
  }
  return { ok: true as const };
}

function hasLowFeedback(input: CertificateApplicationInput) {
  const average = (
    input.feedbackTrainerClarityScore +
    input.feedbackPracticalLearningScore +
    input.feedbackCourseExpectationScore +
    input.feedbackOverallScore
  ) / 4;
  return average <= LOW_FEEDBACK_AVERAGE_THRESHOLD || input.feedbackOverallScore <= LOW_FEEDBACK_OVERALL_THRESHOLD;
}

function normalizeComment(value: string | null | undefined) {
  const text = String(value || "").trim();
  return text ? text : null;
}

async function loadStudentEnrolmentRow(c: AppContext, personId: string, enrolmentId: string) {
  return c.env.DB.prepare(
    `select
       enrolments.id as enrolment_id,
       enrolments.enrolment_number,
       enrolments.status as enrolment_status,
       enrolments.branch_id,
       branches.name as branch_name,
       students.organisation_id,
       people.id as person_id,
       people.status as person_status,
       people.full_name as person_name,
       person_identity_details.official_full_name,
       students.id as student_id,
       students.student_number,
       students.current_status as student_status,
       courses.id as course_id,
       courses.code as course_code,
       courses.name as course_name,
       courses.status as course_status,
       courses.duration_label,
       enrolments.joining_date,
       enrolments.actual_completion_date,
       null as batch_id,
       null as batch_name,
       certificate_applications.id as application_id,
       certificate_applications.status as application_status,
       certificate_applications.applied_at as application_applied_at,
       certificate_applications.low_feedback_flag as application_low_feedback_flag,
       certificates.id as certificate_id,
       certificates.certificate_number,
       certificates.verification_code
     from enrolments
     join students on students.id = enrolments.student_id
     join people on people.id = students.person_id
     left join person_identity_details on person_identity_details.person_id = people.id
     join courses on courses.id = enrolments.course_id
     left join branches on branches.id = enrolments.branch_id
     left join certificate_applications on certificate_applications.organisation_id = students.organisation_id
       and certificate_applications.enrolment_id = enrolments.id
       and certificate_applications.status in ('submitted', 'approved', 'needs_attention', 'certificate_issued')
     left join certificates on certificates.organisation_id = students.organisation_id
       and certificates.enrolment_id = enrolments.id
       and certificates.status = 'issued'
     where students.organisation_id = ?
       and people.id = ?
       and enrolments.id = ?
     limit 1`,
  )
    .bind(ORG_ID, personId, enrolmentId)
    .first<ApplicationEligibilityRow>();
}

async function activeApplicationForEnrolment(c: AppContext, enrolmentId: string) {
  return c.env.DB.prepare(
    `select *
     from certificate_applications
     where organisation_id = ?
       and enrolment_id = ?
       and status in ('submitted', 'approved', 'needs_attention')
     limit 1`,
  )
    .bind(ORG_ID, enrolmentId)
    .first<CertificateApplicationRecord>();
}

function applicationEvent(
  c: AppContext,
  input: {
    applicationId: string;
    branchId: string;
    actorLoginAccountId: string | null;
    actorPersonId: string | null;
    action: "submitted" | "needs_attention" | "approved" | "certificate_issued";
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    metadata: Record<string, unknown>;
    now: string;
  },
) {
  return c.env.DB.prepare(
    `insert into certificate_application_events
       (id, organisation_id, branch_id, application_id, actor_login_account_id, actor_person_id,
        action, from_status, to_status, note, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    createOpaqueId("certappevt"),
    ORG_ID,
    input.branchId,
    input.applicationId,
    input.actorLoginAccountId,
    input.actorPersonId,
    input.action,
    input.fromStatus,
    input.toStatus,
    input.note,
    JSON.stringify(input.metadata),
    input.now,
  );
}
