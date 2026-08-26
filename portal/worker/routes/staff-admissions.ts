import { z } from "zod";
import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { ORG_ID, mobileHash } from "../lib/auth-store";
import {
  confirmAdmission,
  decideDiscountApproval,
  fieldErrorsFromIssues,
  getAdmissionConfiguration,
  getAdmissionDraft,
  getAdmissionReceiptSummary,
  listDiscountApprovals,
  recordAdmissionReceipt,
  recordAdmissionReceiptSchema,
  requestDiscountApproval,
  saveAdmissionDraft,
  saveAdmissionDraftSchema,
} from "../lib/admission-service";
import { ADMISSION_STAFF_ROLES, COURSE_ADMIN_ROLES, DISCOUNT_APPROVER_ROLES, requireStaffRoles, type StaffContext } from "../lib/staff-auth";
import { createOpaqueId, decryptText, hmacHex } from "../lib/crypto";
import { mapStatusToPipelineStage } from "../lib/enquiry-crm";
import { isResponse, readJsonBody, requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { normalizeIndianMobile } from "../lib/mobile";
import { changeStudentPrimaryMobile, getStudentContactHistory, getStudentContactVersion } from "../lib/owner-student-maintenance";
import { addMobileIfMissing } from "../lib/person-contact";
import { getRecoverableReferralLink, rotateReferralLink, type ReferralServiceEnv } from "../lib/referral-service";
import { requireReferralTokenPepper } from "../lib/referral-token";
import { listStaffStudents } from "../lib/student-directory";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;
type PortalContext = Parameters<typeof getAdmissionDraft>[0];

const REFERRAL_PROGRAMME_ID = "rprog_samyak_skill_circle";
const REFERRAL_PUBLIC_ORIGIN = "https://go.samyaksion.com";

const baseCourseSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(140),
  categoryId: z.string().trim().max(120).nullable().optional(),
  durationLabel: z.string().trim().max(80).nullable().optional(),
  durationMonths: z.coerce.number().min(0.5),
  standardFeePaise: z.coerce.number().int().min(0),
  lowestAcceptableFeePaise: z.coerce.number().int().min(0),
  nsdcAvailable: z.boolean().default(false),
  status: z.enum(["active", "inactive", "archived"]).default("active"),
});

const courseSchema = baseCourseSchema.refine((course) => course.lowestAcceptableFeePaise <= course.standardFeePaise, {
  path: ["lowestAcceptableFeePaise"],
  message: "Lowest acceptable fee cannot exceed listed price.",
});
const coursePatchSchema = baseCourseSchema.partial();

const discountDecisionSchema = z.object({ decision: z.enum(["approved", "rejected"]) });
const personLinkSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), personId: z.string().trim().min(1) }),
  z.object({ mode: z.literal("create"), idempotencyKey: z.string().trim().min(8).max(160) }),
]);
type AdmissionPersonLinkInput = z.infer<typeof personLinkSchema>;

const enquiryStatusSchema = z.object({
  status: z.enum([
    "new",
    "attempted_contact",
    "contacted",
    "follow_up",
    "counselling_completed",
    "demo_scheduled",
    "interested",
    "admission_pending",
    "not_interested",
    "lost",
    "duplicate",
    "invalid",
  ]),
});
const studentMobileChangeSchema = z.object({
  newMobile: z.string().trim().min(10).max(20),
  confirmSharedMobile: z.boolean().default(false),
  reason: z.string().trim().max(160).optional(),
  expectedContactVersion: z.string().trim().min(16).max(256),
});
const studentDirectoryQuerySchema = z.object({
  status: z.enum(["all", "current", "alumni"]).default("all"),
  search: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerStaffAdmissionRoutes(app: PortalHono) {
  app.get("/api/staff/courses/active", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const courses = await c.env.DB.prepare(
      `select id, code, name, category_id, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status
       from courses
       where organisation_id = ? and status = 'active' and admission_configuration_complete = 1
       order by name`,
    )
      .bind(ORG_ID)
      .all();
    return jsonPlain(c, { courses: courses.results || [] });
  });

  app.get("/api/staff/courses", async (c) => {
    const staff = await requireStaffRoles(c, COURSE_ADMIN_ROLES);
    if (!staff) return forbidden(c);
    const courses = await c.env.DB.prepare(
      `select id, code, name, category_id, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at
       from courses
       where organisation_id = ?
       order by case status when 'active' then 1 when 'inactive' then 2 else 3 end, name`,
    )
      .bind(ORG_ID)
      .all();
    return jsonPlain(c, { courses: courses.results || [] });
  });

  app.post("/api/staff/courses", async (c) => {
    const staff = await requireStaffRoles(c, COURSE_ADMIN_ROLES);
    if (!staff) return forbidden(c);
    const parsed = courseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_course", message: parsed.error.issues[0]?.message || "Please check course details." });
    const now = new Date().toISOString();
    const courseId = createOpaqueId("course");
    try {
      await c.env.DB.prepare(
        `insert into courses
           (id, organisation_id, code, name, category_id, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
        .bind(
          courseId,
          ORG_ID,
          parsed.data.code.toUpperCase(),
          parsed.data.name,
          parsed.data.categoryId || null,
          parsed.data.durationLabel || null,
          parsed.data.durationMonths,
          parsed.data.standardFeePaise,
          parsed.data.lowestAcceptableFeePaise,
          parsed.data.nsdcAvailable ? 1 : 0,
          parsed.data.status,
          now,
          now,
        )
        .run();
    } catch {
      return jsonError(c, { status: 409, code: "course_code_exists", message: "Course code already exists." });
    }
    await audit(c, staff, "course_created", "course", courseId, { code: parsed.data.code.toUpperCase() });
    return jsonPlain(c, { success: true, courseId }, { status: 201 });
  });

  app.patch("/api/staff/courses/:courseId", async (c) => {
    const staff = await requireStaffRoles(c, COURSE_ADMIN_ROLES);
    if (!staff) return forbidden(c);
    const parsed = coursePatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_course", message: parsed.error.issues[0]?.message || "Please check course details." });
    const existing = await c.env.DB.prepare("select id from courses where id = ? and organisation_id = ?")
      .bind(c.req.param("courseId"), ORG_ID)
      .first<{ id: string }>();
    if (!existing) return jsonError(c, { status: 404, code: "course_not_found", message: "Course was not found." });
    const current = await c.env.DB.prepare("select * from courses where id = ?").bind(existing.id).first<Record<string, unknown>>();
    const next = { ...current, ...toCourseRow(parsed.data), updated_at: new Date().toISOString() };
    if (Number(next.lowest_acceptable_fee_paise ?? 0) > Number(next.default_fee_paise ?? 0)) {
      return jsonError(c, { status: 400, code: "invalid_course", message: "Lowest acceptable fee cannot exceed listed price." });
    }
    const explicitlyValidatedConfiguration =
      parsed.data.durationMonths !== undefined &&
      parsed.data.standardFeePaise !== undefined &&
      parsed.data.lowestAcceptableFeePaise !== undefined;
    const admissionConfigurationComplete = Boolean(current?.admission_configuration_complete) || explicitlyValidatedConfiguration;
    const coursePriceChanged =
      Number(current?.default_fee_paise ?? 0) !== Number(next.default_fee_paise ?? 0) ||
      Number(current?.lowest_acceptable_fee_paise ?? 0) !== Number(next.lowest_acceptable_fee_paise ?? 0);
    try {
      await c.env.DB.prepare(
        `update courses
         set code = ?, name = ?, category_id = ?, duration_label = ?, duration_months = ?, default_fee_paise = ?, lowest_acceptable_fee_paise = ?, admission_configuration_complete = ?, nsdc_available = ?, status = ?, updated_at = ?
         where id = ? and organisation_id = ?`,
      )
        .bind(next.code, next.name, next.category_id ?? null, next.duration_label ?? null, next.duration_months, next.default_fee_paise ?? 0, next.lowest_acceptable_fee_paise ?? 0, admissionConfigurationComplete ? 1 : 0, next.nsdc_available ? 1 : 0, next.status, next.updated_at, existing.id, ORG_ID)
        .run();
    } catch {
      return jsonError(c, { status: 409, code: "course_code_exists", message: "Course code already exists." });
    }
    if (coursePriceChanged) await supersedeCoursePriceApprovals(c, existing.id);
    await audit(c, staff, "course_updated", "course", existing.id, { status: next.status });
    return jsonPlain(c, { success: true, courseId: existing.id });
  });

  app.get("/api/staff/admission-configuration", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    return jsonPlain(c, await getAdmissionConfiguration(c));
  });

  app.get("/api/staff/enquiries/:enquiryId", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const detail = await getEnquiryDetail(c, c.req.param("enquiryId"));
    if (!detail) return jsonError(c, { status: 404, code: "enquiry_not_found", message: "Enquiry was not found." });
    return jsonPlain(c, detail);
  });

  app.post("/api/staff/enquiries/:enquiryId/person-link", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = personLinkSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_person_link", message: "Select an existing student or create a new student record." });
    const result = await linkAdmissionEnquiryPerson(c, staff, c.req.param("enquiryId"), parsed.data);
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message });
    return jsonPlain(c, { success: true, enquiryId: result.enquiryId, personId: result.personId, mode: result.mode, alreadyLinked: result.alreadyLinked });
  });

  app.patch("/api/staff/enquiries/:enquiryId", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = enquiryStatusSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_status", message: "Select a valid enquiry status." });
    const pipelineStage = mapStatusToPipelineStage(parsed.data.status);
    const result = await c.env.DB.prepare(
      "update enquiries set status = ?, pipeline_stage = ?, next_follow_up_at = case when ? in ('lost', 'invalid', 'duplicate') then null else next_follow_up_at end, updated_at = ? where id = ? and organisation_id = ? and status != 'converted'",
    )
      .bind(parsed.data.status, pipelineStage, pipelineStage, new Date().toISOString(), c.req.param("enquiryId"), ORG_ID)
      .run();
    if (!changed(result)) return jsonError(c, { status: 409, code: "status_not_updated", message: "Converted enquiries cannot be edited." });
    await audit(c, staff, "enquiry_status_updated", "enquiry", c.req.param("enquiryId"), { status: parsed.data.status });
    return jsonPlain(c, { success: true });
  });

  app.get("/api/staff/enquiries/:enquiryId/admission-draft", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const draft = await getAdmissionDraft(c, c.req.param("enquiryId"));
    return jsonPlain(c, {
      draft: draft
        ? {
            id: draft.id,
            currentStep: draft.current_step,
            status: draft.status,
            payload: JSON.parse(draft.payload_json),
            confirmedAt: draft.confirmed_at,
            confirmationLockedAt: draft.confirmation_locked_at,
            confirmationSnapshotVersion: draft.confirmation_snapshot_version,
          }
        : null,
      financialSummary: await getAdmissionReceiptSummary(c, c.req.param("enquiryId")),
    });
  });

  app.post("/api/staff/enquiries/:enquiryId/admission-draft", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = saveAdmissionDraftSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_draft", message: "Please correct the highlighted fields.", fieldErrors: fieldErrorsFromIssues(parsed.error.issues) });
    const result = await saveAdmissionDraft(c, staff, c.req.param("enquiryId"), parsed.data);
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
    return jsonPlain(c, { success: true, draftId: result.draftId, payload: result.payload, currentStep: result.currentStep, fieldErrors: result.fieldErrors });
  });

  app.post("/api/staff/enquiries/:enquiryId/confirm-admission", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const result = await confirmAdmission(c, staff, c.req.param("enquiryId"));
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
    return jsonPlain(c, { success: true, ...result.result });
  });

  app.post("/api/staff/admissions/:enquiryId/receipts", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = recordAdmissionReceiptSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_receipt", message: "Please correct receipt details.", fieldErrors: fieldErrorsFromIssues(parsed.error.issues) });
    const result = await recordAdmissionReceipt(c, staff, c.req.param("enquiryId"), parsed.data);
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
    return jsonPlain(c, { success: true, receipt: result.receipt, financialSummary: result.financialSummary }, { status: 201 });
  });

  app.post("/api/staff/enquiries/:enquiryId/discount-approval", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const result = await requestDiscountApproval(c, staff, c.req.param("enquiryId"));
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message, fieldErrors: result.fieldErrors });
    return jsonPlain(c, { success: true, approvalId: result.approvalId, status: result.status }, { status: 201 });
  });

  app.get("/api/staff/discount-approvals", async (c) => {
    const staff = await requireStaffRoles(c, DISCOUNT_APPROVER_ROLES);
    if (!staff) return forbidden(c);
    return jsonPlain(c, { approvals: await listDiscountApprovals(c) });
  });

  app.post("/api/staff/discount-approvals/:approvalId/decision", async (c) => {
    const staff = await requireStaffRoles(c, DISCOUNT_APPROVER_ROLES);
    if (!staff) return forbidden(c);
    const parsed = discountDecisionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_decision", message: "Select approve or reject." });
    const result = await decideDiscountApproval(c, staff, c.req.param("approvalId"), parsed.data.decision);
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message });
    return jsonPlain(c, { success: true, approvalId: result.approvalId, status: result.status });
  });

  app.get("/api/staff/students", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = studentDirectoryQuerySchema.safeParse({
      status: c.req.query("status") || "all",
      search: c.req.query("search") || "",
      limit: c.req.query("limit") || undefined,
      offset: c.req.query("offset") || undefined,
    });
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_student_directory_query", message: "Check student filters and pagination." });
    return jsonPlain(c, await listStaffStudents(c, staff, parsed.data));
  });

  app.get("/api/staff/students/:studentId", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const profile = await getStudentProfile(c, staff, c.req.param("studentId"));
    if (!profile) return jsonError(c, { status: 404, code: "student_not_found", message: "Student was not found." });
    return jsonPlain(c, profile);
  });

  app.patch("/api/staff/students/:studentId/contact/mobile", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Only owner accounts can maintain student contact details." });
    const body = await readJsonBody(c, studentMobileChangeSchema);
    if (isResponse(body)) return body;
    const result = await changeStudentPrimaryMobile(c, staff, c.req.param("studentId"), body);
    if (!result.ok) {
      return jsonError(c, {
        status: result.status as 400,
        code: result.code,
        message: result.message,
        ...(result.sharedMobileMatches ? { details: { sharedMobileMatches: result.sharedMobileMatches } } : {}),
      });
    }
    return jsonPlain(c, { success: true, ...result });
  });

  app.post("/api/staff/students/:studentId/referral-link/replace", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Only owner accounts can replace student referral links." });
    const student = await findStudentReferralTarget(c, c.req.param("studentId"));
    if (!student) return jsonError(c, { status: 404, code: "student_not_found", message: "Student was not found." });
    if (!(await hasOwnerMaintenanceAccessForBranch(c, staff, student.home_branch_id))) {
      return jsonError(c, { status: 403, code: "forbidden", message: "Only owner accounts can replace student referral links." });
    }
    if (!student.referrer_profile_id) {
      return jsonError(c, { status: 409, code: "referrer_not_eligible", message: "This student does not have an active referral profile." });
    }
    const active = await activeStudentReferralLink(c, student.referrer_profile_id);
    if (!active) {
      return jsonError(c, { status: 409, code: "referral_link_missing", message: "This student does not have an active referral link yet." });
    }
    const rotated = await rotateReferralLink(referralEnv(c), {
      organisationId: ORG_ID,
      referralProgrammeId: REFERRAL_PROGRAMME_ID,
      referrerProfileId: student.referrer_profile_id,
      loginAccountId: staff.loginAccountId,
      personId: staff.activePersonId,
      now: new Date().toISOString(),
    });
    return jsonPlain(c, {
      created: true,
      rotated: true,
      link: buildPublicReferralUrl(rotated.rawToken),
      shownOnce: true,
      lastFour: rotated.link.tokenLastFour,
      previousLinkId: rotated.previousLinkId,
    }, { status: 201 });
  });
}

async function getEnquiryDetail(c: Parameters<typeof getAdmissionDraft>[0], enquiryId: string) {
  const enquiry = await c.env.DB.prepare(
    `select enquiries.*, people.full_name, people.date_of_birth, students.id as student_id, students.student_number,
            courses.name as course_name, courses.id as course_id, branches.name as branch_name, branches.code as branch_code, enquiry_course_interests.course_interest_text
     from enquiries
     left join people on people.id = enquiries.person_id
     left join branches on branches.id = enquiries.branch_id
     left join students on students.person_id = enquiries.person_id and students.organisation_id = enquiries.organisation_id
     left join courses on courses.id = enquiries.course_interest_id
     left join enquiry_course_interests on enquiry_course_interests.enquiry_id = enquiries.id
     where enquiries.id = ? and enquiries.organisation_id = ?`,
  )
    .bind(enquiryId, ORG_ID)
    .first<Record<string, unknown>>();
  if (!enquiry) return null;
  const enrolments = enquiry.person_id
    ? await c.env.DB.prepare(
        `select enrolments.id, enrolments.enrolment_number, enrolments.status, enrolments.joining_date, courses.name as course_name
         from enrolments
         join students on students.id = enrolments.student_id
         join courses on courses.id = enrolments.course_id
         where students.person_id = ?
         order by enrolments.created_at desc`,
      )
        .bind(enquiry.person_id)
        .all()
    : { results: [] };
  const mobiles = enquiry.person_id ? await fullMobileContacts(c, String(enquiry.person_id)) : { primaryMobile: null, alternateMobile: null };
  const personLinkCandidate = enquiry.person_id ? null : await admissionPersonLinkCandidate(c, enquiryId);
  const draft = await getAdmissionDraft(c, enquiryId);
  return {
    enquiry: safeAdmissionEnquiry(enquiry),
    primaryMobile: mobiles.primaryMobile,
    alternateMobile: mobiles.alternateMobile,
    mobileDisplay: mobiles.primaryMobile ? maskMobile(mobiles.primaryMobile) : null,
    alternateMobileDisplay: mobiles.alternateMobile ? maskMobile(mobiles.alternateMobile) : null,
    personLinkCandidate,
    previousEnrolments: enrolments.results || [],
    activeDraft: draft ? { id: draft.id, status: draft.status, currentStep: draft.current_step } : null,
  };
}

function safeAdmissionEnquiry(enquiry: Record<string, unknown>) {
  const { mobile_used: _mobileUsed, campaign_data_json: _campaignDataJson, ...safe } = enquiry;
  return safe;
}

async function linkAdmissionEnquiryPerson(c: PortalContext, staff: StaffContext, enquiryId: string, input: AdmissionPersonLinkInput) {
  const enquiry = await c.env.DB.prepare(
    `select id, organisation_id, branch_id, person_id, enquiry_number
     from enquiries
     where id = ? and organisation_id = ?`,
  )
    .bind(enquiryId, ORG_ID)
    .first<{ id: string; organisation_id: string; branch_id: string; person_id: string | null; enquiry_number: string }>();
  if (!enquiry) return { ok: false as const, status: 404, code: "enquiry_not_found", message: "Enquiry was not found." };
  if (!(await hasAdmissionAccessForBranch(c, staff, enquiry.branch_id))) {
    return { ok: false as const, status: 403, code: "forbidden", message: "This role cannot link students for this branch." };
  }

  if (input.mode === "existing") return linkExistingAdmissionPerson(c, staff, enquiry, input.personId);
  return createAndLinkAdmissionPerson(c, staff, enquiry, input.idempotencyKey);
}

async function linkExistingAdmissionPerson(c: PortalContext, staff: StaffContext, enquiry: { id: string; branch_id: string; person_id: string | null; enquiry_number: string }, personId: string) {
  const person = await c.env.DB.prepare("select id from people where id = ? and organisation_id = ? and status != 'archived'")
    .bind(personId, ORG_ID)
    .first<{ id: string }>();
  if (!person) return { ok: false as const, status: 404, code: "person_not_found", message: "The selected student record was not found." };
  if (enquiry.person_id) {
    if (enquiry.person_id === personId) return { ok: true as const, enquiryId: enquiry.id, personId, mode: "existing" as const, alreadyLinked: true };
    return { ok: false as const, status: 409, code: "person_already_linked", message: "This enquiry is already linked to another student record." };
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare("update enquiries set person_id = ?, updated_at = ? where id = ? and organisation_id = ? and person_id is null")
    .bind(personId, now, enquiry.id, ORG_ID)
    .run();
  if (!changed(result)) return personLinkConflict(c, enquiry.id);
  await c.env.DB.prepare("update referrals set prospect_person_id = coalesce(prospect_person_id, ?), updated_at = ? where organisation_id = ? and enquiry_id = ?")
    .bind(personId, now, ORG_ID, enquiry.id)
    .run();
  await auditPersonLink(c, staff, enquiry.branch_id, "admission_enquiry_person_linked", enquiry.id, { enquiryNumber: enquiry.enquiry_number, personId, linkMode: "existing" });
  return { ok: true as const, enquiryId: enquiry.id, personId, mode: "existing" as const, alreadyLinked: false };
}

async function createAndLinkAdmissionPerson(c: PortalContext, staff: StaffContext, enquiry: { id: string; branch_id: string; person_id: string | null; enquiry_number: string }, idempotencyKey: string) {
  if (enquiry.person_id) return { ok: true as const, enquiryId: enquiry.id, personId: enquiry.person_id, mode: "create" as const, alreadyLinked: true };
  const candidate = await admissionPersonLinkCandidate(c, enquiry.id);
  if (!candidate?.mobile) {
    return { ok: false as const, status: 400, code: "prospect_contact_required", message: "Referral prospect contact is unavailable. Link an existing student record instead." };
  }

  const now = new Date().toISOString();
  const idHash = await hmacHex(c.env.SESSION_PEPPER, "admission-person-create", `${enquiry.id}:${idempotencyKey}`);
  const personId = `person_${idHash.slice(0, 32)}`;
  const lookupHash = await mobileHash(c, candidate.mobile);
  let insertedPerson = false;
  try {
    await c.env.DB.prepare(
      `insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at)
       values (?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
      .bind(personId, ORG_ID, enquiry.branch_id, candidate.displayName, candidate.displayName, now, now)
      .run();
    insertedPerson = true;
  } catch {
    const linked = await c.env.DB.prepare("select person_id from enquiries where id = ? and organisation_id = ?")
      .bind(enquiry.id, ORG_ID)
      .first<{ person_id: string | null }>();
    if (linked?.person_id === personId) return { ok: true as const, enquiryId: enquiry.id, personId, mode: "create" as const, alreadyLinked: true };
  }

  await addMobileIfMissing(c, personId, candidate.mobile, lookupHash, now, true);
  const result = await c.env.DB.prepare("update enquiries set person_id = ?, updated_at = ? where id = ? and organisation_id = ? and person_id is null")
    .bind(personId, now, enquiry.id, ORG_ID)
    .run();
  if (!changed(result)) {
    if (insertedPerson) await cleanupUnlinkedCreatedPerson(c, personId);
    return personLinkConflict(c, enquiry.id);
  }
  await c.env.DB.prepare("update referrals set prospect_person_id = coalesce(prospect_person_id, ?), updated_at = ? where organisation_id = ? and enquiry_id = ?")
    .bind(personId, now, ORG_ID, enquiry.id)
    .run();
  await auditPersonLink(c, staff, enquiry.branch_id, "admission_enquiry_person_created_and_linked", enquiry.id, { enquiryNumber: enquiry.enquiry_number, personId, linkMode: "create" });
  return { ok: true as const, enquiryId: enquiry.id, personId, mode: "create" as const, alreadyLinked: false };
}

async function personLinkConflict(c: PortalContext, enquiryId: string) {
  const linked = await c.env.DB.prepare("select person_id from enquiries where id = ? and organisation_id = ?")
    .bind(enquiryId, ORG_ID)
    .first<{ person_id: string | null }>();
  if (linked?.person_id) {
    return { ok: false as const, status: 409, code: "person_already_linked", message: "This enquiry was already linked to a student record. Refresh admission to continue." };
  }
  return { ok: false as const, status: 409, code: "person_link_conflict", message: "Student link could not be saved. Refresh and retry." };
}

async function admissionPersonLinkCandidate(c: PortalContext, enquiryId: string) {
  const referral = await c.env.DB.prepare(
    `select referrals.prospect_name, referrals.referral_link_id, referrals.prospect_mobile_hash, referrals.prospect_mobile_ciphertext,
            enquiries.enquiry_number
     from referrals
     join enquiries on enquiries.id = referrals.enquiry_id
     where referrals.organisation_id = ? and referrals.enquiry_id = ?
     limit 1`,
  )
    .bind(ORG_ID, enquiryId)
    .first<{ prospect_name: string; referral_link_id: string | null; prospect_mobile_hash: string | null; prospect_mobile_ciphertext: string | null; enquiry_number: string }>();
  if (!referral) return null;
  const mobile = await referralProspectMobile(c, referral);
  return {
    displayName: referral.prospect_name || "Referral prospect",
    mobile,
    mobileDisplay: mobile ? formatIndianMobileDisplay(mobile) : null,
    enquiryNumber: referral.enquiry_number,
  };
}

async function referralProspectMobile(c: PortalContext, referral: { referral_link_id: string | null; prospect_mobile_hash: string | null; prospect_mobile_ciphertext: string | null }) {
  if (!referral.referral_link_id || !referral.prospect_mobile_hash || !referral.prospect_mobile_ciphertext) return null;
  const value = await decryptText(c.env.SESSION_PEPPER, `referral-mobile:${referral.referral_link_id}:${referral.prospect_mobile_hash}`, referral.prospect_mobile_ciphertext).catch(() => null);
  return value ? normalizeIndianMobile(value) : null;
}

async function cleanupUnlinkedCreatedPerson(c: PortalContext, personId: string) {
  const contacts = await c.env.DB.prepare("select id from person_contacts where person_id = ?").bind(personId).all<{ id: string }>();
  for (const contact of contacts.results || []) {
    await c.env.DB.batch([
      c.env.DB.prepare("delete from person_contact_secrets where contact_id = ?").bind(contact.id),
      c.env.DB.prepare("delete from person_contact_details where contact_id = ?").bind(contact.id),
      c.env.DB.prepare("delete from person_contacts where id = ?").bind(contact.id),
    ]);
  }
  await c.env.DB.prepare("delete from people where id = ? and not exists (select 1 from enquiries where enquiries.person_id = people.id)").bind(personId).run();
}

async function hasAdmissionAccessForBranch(c: PortalContext, staff: StaffContext, branchId: string) {
  if (!staff.roles.some((role) => ADMISSION_STAFF_ROLES.includes(role as (typeof ADMISSION_STAFF_ROLES)[number]))) return false;
  const row = await c.env.DB.prepare(
    `select 1 as ok
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.organisation_id = ?
       and roles.code in ('owner', 'system_admin', 'admin', 'admission_admin', 'counsellor')
       and (login_account_roles.branch_id is null or login_account_roles.branch_id = ?)
     limit 1`,
  )
    .bind(staff.loginAccountId, ORG_ID, branchId)
    .first<{ ok: number }>();
  return Boolean(row);
}

async function hasOwnerMaintenanceAccessForBranch(c: PortalContext, staff: StaffContext, branchId: string) {
  const row = await c.env.DB.prepare(
    `select 1 as ok
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.organisation_id = ?
       and roles.code = 'owner'
       and (login_account_roles.branch_id is null or login_account_roles.branch_id = ?)
     limit 1`,
  )
    .bind(staff.loginAccountId, ORG_ID, branchId)
    .first<{ ok: number }>();
  return Boolean(row);
}

async function auditPersonLink(c: PortalContext, staff: StaffContext, branchId: string, action: string, enquiryId: string, metadata: Record<string, unknown>) {
  await c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, 'enquiry', ?, ?, ?)`,
  )
    .bind(createOpaqueId("audit"), ORG_ID, branchId, staff.loginAccountId, staff.activePersonId, action, enquiryId, JSON.stringify(metadata), new Date().toISOString())
    .run();
}

function formatIndianMobileDisplay(mobile: string) {
  return `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`;
}

async function getStudentProfile(c: Parameters<typeof getAdmissionDraft>[0], staff: StaffContext, studentId: string) {
  const student = await c.env.DB.prepare(
    `select students.*, people.full_name, people.date_of_birth
     from students
     join people on people.id = students.person_id
     where students.id = ? and students.organisation_id = ? and people.organisation_id = ? and people.status != 'archived'`,
  )
    .bind(studentId, ORG_ID, ORG_ID)
    .first<Record<string, unknown>>();
  if (!student) return null;
  if (!(await hasAdmissionAccessForBranch(c, staff, String(student.home_branch_id)))) return null;
  const [localities, education, enrolments, enquiries] = await Promise.all([
    c.env.DB.prepare("select * from person_localities where person_id = ? and status = 'active' order by created_at desc limit 1")
      .bind(student.person_id)
      .all(),
    c.env.DB.prepare("select * from education_records where person_id = ? order by created_at desc limit 1").bind(student.person_id).all(),
    c.env.DB.prepare(
      `select enrolments.*, courses.name as course_name, fee_agreements.final_agreed_fee_paise, fee_agreements.payment_plan_type,
              nsdc_profiles.status as nsdc_status
       from enrolments
       join courses on courses.id = enrolments.course_id
       left join fee_agreements on fee_agreements.enrolment_id = enrolments.id
       left join nsdc_profiles on nsdc_profiles.enrolment_id = enrolments.id
       where enrolments.student_id = ?
       order by enrolments.created_at desc`,
    )
      .bind(studentId)
      .all(),
    c.env.DB.prepare("select id, enquiry_number, status, created_at from enquiries where person_id = ? order by created_at desc")
      .bind(student.person_id)
      .all(),
  ]);
  const primaryMobile = await fullPrimaryMobile(c, String(student.person_id));
  const canMaintainContact = await hasOwnerMaintenanceAccessForBranch(c, staff, String(student.home_branch_id));
  const referralLink = await studentReferralLinkPayload(c, String(student.person_id));
  return {
    student,
    primaryMobile: null,
    mobileDisplay: primaryMobile ? maskMobile(primaryMobile) : null,
    canMaintainContact,
    canReplaceReferralLink: canMaintainContact,
    referralLink,
    contactVersion: canMaintainContact ? await getStudentContactVersion(c, String(student.person_id)) : null,
    contactHistory: canMaintainContact ? await getStudentContactHistory(c, String(student.person_id)) : [],
    locality: localities.results?.[0] || null,
    education: education.results?.[0] || null,
    enrolments: enrolments.results || [],
    enquiries: enquiries.results || [],
  };
}

async function studentReferralLinkPayload(c: PortalContext, personId: string) {
  const referrer = await c.env.DB.prepare(
    `select id
     from referrer_profiles
     where organisation_id = ? and person_id = ? and active = 1
     limit 1`,
  )
    .bind(ORG_ID, personId)
    .first<{ id: string }>();
  if (!referrer) return null;
  const active = await activeStudentReferralLink(c, referrer.id);
  if (!active) return {
    hasActiveLink: false,
    lastFour: null,
    activatedAt: null,
    publicUrl: null,
    recoverable: false,
    message: "No active referral link.",
  };
  const recovered = await getRecoverableReferralLink(referralEnv(c), {
    link: { id: active.id, organisation_id: active.organisation_id, token_hash: active.token_hash },
    publicOrigin: REFERRAL_PUBLIC_ORIGIN,
  });
  return {
    hasActiveLink: true,
    lastFour: active.token_last_four,
    activatedAt: active.activated_at,
    publicUrl: recovered.recoverable ? recovered.publicUrl : null,
    recoverable: recovered.recoverable,
    message: recovered.recoverable
      ? "Referral link is ready to copy or open."
      : "This link was created before secure link recovery was enabled. Replace it only when needed.",
  };
}

async function findStudentReferralTarget(c: PortalContext, studentId: string) {
  return c.env.DB.prepare(
    `select students.id, students.person_id, students.home_branch_id, referrer_profiles.id as referrer_profile_id
     from students
     join people on people.id = students.person_id
       and people.organisation_id = students.organisation_id
     left join referrer_profiles on referrer_profiles.person_id = students.person_id
       and referrer_profiles.organisation_id = students.organisation_id
       and referrer_profiles.active = 1
     where students.id = ?
       and students.organisation_id = ?
       and people.status != 'archived'
     limit 1`,
  )
    .bind(studentId, ORG_ID)
    .first<{ id: string; person_id: string; home_branch_id: string; referrer_profile_id: string | null }>();
}

async function activeStudentReferralLink(c: PortalContext, referrerProfileId: string) {
  const now = new Date().toISOString();
  return c.env.DB.prepare(
    `select id, organisation_id, token_hash, token_last_four, activated_at
     from referral_links
     where organisation_id = ?
       and referral_programme_id = ?
       and referrer_profile_id = ?
       and status = 'active'
       and revoked_at is null
       and (expires_at is null or expires_at > ?)
     order by activated_at desc, id desc
     limit 1`,
  )
    .bind(ORG_ID, REFERRAL_PROGRAMME_ID, referrerProfileId, now)
    .first<{ id: string; organisation_id: string; token_hash: string; token_last_four: string | null; activated_at: string | null }>();
}

function referralEnv(c: PortalContext): ReferralServiceEnv {
  return {
    DB: c.env.DB,
    SESSION_PEPPER: c.env.SESSION_PEPPER,
    referralTokenPepper: requireReferralTokenPepper(String(c.env.REFERRAL_TOKEN_PEPPER || "")),
  };
}

function buildPublicReferralUrl(rawToken: string) {
  return `${REFERRAL_PUBLIC_ORIGIN}/r/${encodeURIComponent(rawToken)}`;
}

async function fullPrimaryMobile(c: Parameters<typeof getAdmissionDraft>[0], personId: string) {
  return (await fullMobileContacts(c, personId)).primaryMobile;
}

async function fullMobileContacts(c: Parameters<typeof getAdmissionDraft>[0], personId: string) {
  const rows = await c.env.DB.prepare(
    `select person_contacts.id, person_contacts.is_primary, person_contact_secrets.value_ciphertext
     from person_contacts
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     left join person_contact_secrets on person_contact_secrets.contact_id = person_contacts.id
     where person_contacts.person_id = ?
       and person_contacts.contact_type = 'mobile'
       and coalesce(person_contact_details.status, 'active') = 'active'
     order by person_contacts.is_primary desc, person_contacts.created_at desc`,
  )
    .bind(personId)
    .all<{ id: string; is_primary: number; value_ciphertext: string | null }>();
  let primaryMobile: string | null = null;
  let alternateMobile: string | null = null;
  for (const contact of rows.results || []) {
    if (!contact.value_ciphertext) continue;
    const value = await decryptText(c.env.SESSION_PEPPER, `contact:${contact.id}`, contact.value_ciphertext).catch(() => null);
    if (!value) continue;
    if (contact.is_primary && !primaryMobile) {
      primaryMobile = value;
    } else if (!alternateMobile) {
      alternateMobile = value;
    }
  }
  return { primaryMobile, alternateMobile };
}

async function audit(c: Parameters<typeof getAdmissionDraft>[0], staff: StaffContext, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  await c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(createOpaqueId("audit"), ORG_ID, staff.loginAccountId, staff.activePersonId, action, entityType, entityId, JSON.stringify(metadata), new Date().toISOString())
    .run();
}

async function supersedeCoursePriceApprovals(c: Parameters<typeof getAdmissionDraft>[0], courseId: string) {
  await c.env.DB.prepare(
    `update admission_discount_approvals
     set status = 'superseded', updated_at = ?
     where organisation_id = ?
       and course_id = ?
       and status in ('pending', 'approved')`,
  )
    .bind(new Date().toISOString(), ORG_ID, courseId)
    .run();
}

function toCourseRow(input: Partial<z.infer<typeof courseSchema>>) {
  return {
    ...(input.code ? { code: input.code.toUpperCase() } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.categoryId !== undefined ? { category_id: input.categoryId || null } : {}),
    ...(input.durationLabel !== undefined ? { duration_label: input.durationLabel || null } : {}),
    ...(input.durationMonths !== undefined ? { duration_months: input.durationMonths } : {}),
    ...(input.standardFeePaise !== undefined ? { default_fee_paise: input.standardFeePaise } : {}),
    ...(input.lowestAcceptableFeePaise !== undefined ? { lowest_acceptable_fee_paise: input.lowestAcceptableFeePaise } : {}),
    ...(input.nsdcAvailable !== undefined ? { nsdc_available: input.nsdcAvailable ? 1 : 0 } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}

function maskMobile(value: string) {
  return value.replace(/\d(?=\d{4})/g, "*");
}

function changed(result: { meta?: { changes?: number; rows_written?: number } }) {
  return Number(result.meta?.changes ?? result.meta?.rows_written ?? 0) > 0;
}

function forbidden(c: Parameters<typeof getAdmissionDraft>[0]) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });
}
