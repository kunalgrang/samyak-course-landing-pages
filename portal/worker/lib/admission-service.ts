import { z } from "zod";
import type { AppContext } from "./http";
import { ORG_ID, mobileHash } from "./auth-store";
import { createOpaqueId, encryptText, hmacHex } from "./crypto";
import { DISCOUNT_APPROVER_ROLES, type StaffContext } from "./staff-auth";
import { normalizeIndianMobile } from "./mobile";

const nameSchema = z.string().trim().min(2).max(140).regex(/^[^\d]+$/, "Name cannot contain numbers.");
const optionalNameSchema = z.string().trim().max(140).regex(/^[^\d]*$/, "Name cannot contain numbers.").optional().or(z.literal(""));
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const paiseSchema = z.coerce.number().int().min(0);

export const admissionPayloadSchema = z.object({
  identity: z
    .object({
      officialFullName: z.string().trim().max(140).optional(),
      firstName: z.string().trim().max(60).optional(),
      middleName: z.string().trim().max(60).optional(),
      lastName: z.string().trim().max(60).optional(),
      dateOfBirth: z.string().trim().max(20).optional(),
      gender: z.string().trim().max(30).optional(),
      fatherName: z.string().trim().max(140).optional(),
      motherName: z.string().trim().max(140).optional(),
      identityConfirmed: z.boolean().optional(),
    })
    .partial()
    .optional(),
  contact: z
    .object({
      primaryMobile: z.string().trim().max(20).optional(),
      belongsTo: z.string().trim().max(30).optional(),
      isWhatsapp: z.boolean().optional(),
      alternateMobile: z.string().trim().max(20).optional(),
      email: z.string().trim().max(160).optional(),
      preferredLanguage: z.string().trim().max(60).optional(),
      preferredLanguageCode: z.string().trim().max(60).optional(),
    })
    .partial()
    .optional(),
  locality: z
    .object({
      locality: z.string().trim().max(160).optional(),
      city: z.string().trim().max(80).optional(),
      postalCode: z.string().trim().max(12).optional(),
      state: z.string().trim().max(80).optional(),
      residenceType: z.string().trim().max(40).optional(),
      fullAddress: z.string().trim().max(500).optional(),
      homeLocality: z.string().trim().max(160).optional(),
    })
    .partial()
    .optional(),
  education: z
    .object({
      qualificationLevel: z.string().trim().max(100).optional(),
      qualificationLevelCode: z.string().trim().max(60).optional(),
      qualificationName: z.string().trim().max(140).optional(),
      stream: z.string().trim().max(100).optional(),
      streamCode: z.string().trim().max(60).optional(),
      institutionName: z.string().trim().max(180).optional(),
      currentlyPursuing: z.boolean().optional(),
      currentYearSemester: z.string().trim().max(80).optional(),
      passingYear: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
      occupationStatus: z.string().trim().max(80).optional(),
      occupationStatusCode: z.string().trim().max(60).optional(),
      reasonForCourse: z.string().trim().max(300).optional(),
      placementAssistanceRequired: z.boolean().optional(),
    })
    .partial()
    .optional(),
  course: z
    .object({
      courseId: z.string().trim().optional(),
      branchId: z.string().trim().optional(),
      trainingMode: z.string().trim().optional(),
      batchPreference: z.string().trim().max(120).optional(),
      batchPreferenceCode: z.string().trim().max(60).optional(),
      admissionDate: z.string().trim().optional(),
      joiningDate: z.string().trim().optional(),
      expectedCompletionDate: z.string().trim().optional(),
      nsdcPreference: z.enum(["yes", "no", "decide_later"]).optional(),
      placementSupport: z.boolean().optional(),
    })
    .partial()
    .optional(),
  fee: z
    .object({
      // Retained for staff UI display only; confirmation always reloads Course Master default_fee_paise.
      standardFeePaise: paiseSchema.optional(),
      finalAgreedFeePaise: paiseSchema.optional(),
      discountReason: z.string().trim().max(240).optional(),
      discountReasonCode: z.string().trim().max(60).optional(),
      paymentPlanType: z.enum(["full", "two_instalments", "three_instalments", "custom"]).optional(),
      numberOfInstalments: z.coerce.number().int().min(1).max(24).optional().nullable(),
      initialPaymentExpectedPaise: paiseSchema.optional(),
      feeRemarks: z.string().trim().max(500).optional(),
    })
    .partial()
    .optional(),
  declarations: z
    .object({
      informationCorrect: z.boolean().optional(),
      nameDobMatchesAadhaar: z.boolean().optional(),
      courseRulesExplained: z.boolean().optional(),
      feeTermsAccepted: z.boolean().optional(),
      dataProcessingAccepted: z.boolean().optional(),
      nsdcProcessingAccepted: z.boolean().optional(),
      nsdcPendingDocumentsUnderstood: z.boolean().optional(),
      marketingMessages: z.boolean().optional(),
      alumniCommunication: z.boolean().optional(),
      referralProgramme: z.boolean().optional(),
      placementProfileSharing: z.boolean().optional(),
      photographTestimonialUse: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

export const saveAdmissionDraftSchema = z.object({
  payload: admissionPayloadSchema,
  currentStep: z.string().trim().min(1).max(40).default("identity"),
});

const confirmationSchema = admissionPayloadSchema.superRefine((payload, ctx) => {
  const identity = payload.identity || {};
  const locality = payload.locality || {};
  const education = payload.education || {};
  const course = payload.course || {};
  const fee = payload.fee || {};
  const declarations = payload.declarations || {};
  const contact = payload.contact || {};

  requireField(ctx, identity.officialFullName, ["identity", "officialFullName"], "Official Aadhaar name is required.");
  requireField(ctx, identity.dateOfBirth, ["identity", "dateOfBirth"], "Date of birth is required.");
  requireField(ctx, identity.gender, ["identity", "gender"], "Gender is required.");
  requireField(ctx, contact.primaryMobile, ["contact", "primaryMobile"], "Primary mobile is required.");
  requireField(ctx, locality.locality, ["locality", "locality"], "Locality is required.");
  requireField(ctx, locality.city, ["locality", "city"], "City is required.");
  requireField(ctx, contact.preferredLanguageCode, ["contact", "preferredLanguageCode"], "Preferred language is required.");
  requireField(ctx, education.qualificationLevelCode, ["education", "qualificationLevelCode"], "Highest/current qualification is required.");
  requireField(ctx, education.occupationStatusCode, ["education", "occupationStatusCode"], "Current occupation status is required.");
  requireField(ctx, course.courseId, ["course", "courseId"], "Select a configured course.");
  requireField(ctx, course.trainingMode, ["course", "trainingMode"], "Training mode is required.");
  requireField(ctx, course.admissionDate, ["course", "admissionDate"], "Admission date is required.");
  requireField(ctx, course.joiningDate, ["course", "joiningDate"], "Joining date is required.");
  requireField(ctx, fee.paymentPlanType, ["fee", "paymentPlanType"], "Payment plan is required.");

  if (!identity.identityConfirmed || !declarations.nameDobMatchesAadhaar) {
    ctx.addIssue({ code: "custom", path: ["identity", "identityConfirmed"], message: "Name and DOB must be confirmed against Aadhaar." });
  }
  for (const [key, message] of [
    ["informationCorrect", "Information correctness declaration is required."],
    ["courseRulesExplained", "Course rules declaration is required."],
    ["feeTermsAccepted", "Fee and cancellation terms acceptance is required."],
    ["dataProcessingAccepted", "Data processing acceptance is required."],
  ] as const) {
    if (!declarations[key]) ctx.addIssue({ code: "custom", path: ["declarations", key], message });
  }
  if (identity.officialFullName && !nameSchema.safeParse(identity.officialFullName).success) {
    ctx.addIssue({ code: "custom", path: ["identity", "officialFullName"], message: "Name cannot contain numbers." });
  }
  if (identity.fatherName && !optionalNameSchema.safeParse(identity.fatherName).success) {
    ctx.addIssue({ code: "custom", path: ["identity", "fatherName"], message: "Father's name cannot contain numbers." });
  }
  if (identity.dateOfBirth && (!dateSchema.safeParse(identity.dateOfBirth).success || Date.parse(identity.dateOfBirth) > Date.now())) {
    ctx.addIssue({ code: "custom", path: ["identity", "dateOfBirth"], message: "DOB cannot be in the future." });
  }
  if (contact.primaryMobile && !normalizeIndianMobile(String(contact.primaryMobile))) {
    ctx.addIssue({ code: "custom", path: ["contact", "primaryMobile"], message: "Enter a valid Indian primary mobile number." });
  }
  if (contact.alternateMobile && !normalizeIndianMobile(String(contact.alternateMobile))) {
    ctx.addIssue({ code: "custom", path: ["contact", "alternateMobile"], message: "Enter a valid Indian alternate mobile number." });
  }
  if (course.admissionDate && !validIsoDate(course.admissionDate)) {
    ctx.addIssue({ code: "custom", path: ["course", "admissionDate"], message: "Admission date must be a real YYYY-MM-DD date." });
  }
  if (education.currentlyPursuing) {
    requireField(ctx, education.currentYearSemester, ["education", "currentYearSemester"], "Current year/semester is required when the student is currently pursuing.");
    if (education.passingYear) {
      ctx.addIssue({ code: "custom", path: ["education", "passingYear"], message: "Passing year must be empty while currently pursuing." });
    }
  } else {
    if (!education.passingYear) {
      ctx.addIssue({ code: "custom", path: ["education", "passingYear"], message: "Passing year is required when the student is not currently pursuing." });
    }
    if (education.currentYearSemester?.trim()) {
      ctx.addIssue({ code: "custom", path: ["education", "currentYearSemester"], message: "Current year/semester must be empty when the student is not currently pursuing." });
    }
  }
  const finalFee = Number(fee.finalAgreedFeePaise ?? -1);
  if (finalFee < 0) ctx.addIssue({ code: "custom", path: ["fee", "finalAgreedFeePaise"], message: "Final agreed fee cannot be negative." });
  if (fee.paymentPlanType === "full" && Number(fee.numberOfInstalments || 1) !== 1) {
    ctx.addIssue({ code: "custom", path: ["fee", "numberOfInstalments"], message: "Full payment uses one instalment." });
  }
  if (fee.paymentPlanType === "two_instalments" && Number(fee.numberOfInstalments || 2) !== 2) {
    ctx.addIssue({ code: "custom", path: ["fee", "numberOfInstalments"], message: "Two instalments must use two instalments." });
  }
  if (fee.paymentPlanType === "three_instalments" && Number(fee.numberOfInstalments || 3) !== 3) {
    ctx.addIssue({ code: "custom", path: ["fee", "numberOfInstalments"], message: "Three instalments must use three instalments." });
  }
  if (course.nsdcPreference === "yes") {
    if (!identity.fatherName?.trim()) ctx.addIssue({ code: "custom", path: ["identity", "fatherName"], message: "Father's full name is required for NSDC." });
    if (!declarations.nsdcProcessingAccepted || !declarations.nsdcPendingDocumentsUnderstood) {
      ctx.addIssue({ code: "custom", path: ["declarations", "nsdcProcessingAccepted"], message: "NSDC processing declarations are required." });
    }
  }
});

type AdmissionPayload = z.infer<typeof admissionPayloadSchema>;
export type FieldErrors = Record<string, string[]>;
type AdmissionFailure = { ok: false; status: number; code: string; message: string; fieldErrors?: FieldErrors };

type AdmissionOptionRecord = {
  category: string;
  code: string;
  label: string;
  requires_custom_label: number | boolean;
  is_active: number | boolean;
};

type CourseRecord = {
  id: string;
  code: string;
  name: string;
  default_fee_paise: number | null;
  duration_months: number | null;
  lowest_acceptable_fee_paise: number | null;
  admission_configuration_complete: number | boolean;
};

type PaymentPlanRuleRecord = {
  plan_type: string;
  fixed_instalments: number | null;
};

type DiscountApprovalRecord = {
  id: string;
  status: string;
  course_id: string;
  listed_fee_paise: number;
  lowest_acceptable_fee_paise: number;
  requested_final_fee_paise: number;
  discount_amount_paise: number;
  approval_fingerprint: string;
  discount_reason_code: string;
  discount_reason_text: string | null;
  decided_by_login_account_id: string | null;
};

type EnquiryRecord = {
  id: string;
  organisation_id: string;
  branch_id: string;
  person_id: string;
  enquiry_number: string;
  status: string;
  pipeline_stage: string;
  converted_enrolment_id: string | null;
  converted_at: string | null;
  course_interest_id: string | null;
};

type DraftRecord = {
  id: string;
  organisation_id: string;
  branch_id: string;
  enquiry_id: string;
  person_id: string;
  payload_json: string;
  current_step: string;
  status: string;
  confirmed_at: string | null;
  confirmation_locked_at: string | null;
  confirmation_snapshot_json: string | null;
  confirmation_snapshot_version: string | null;
  confirmation_locked_by_login_account_id: string | null;
};

export type AdmissionConfirmationResult = {
  studentId: string;
  studentNumber: string;
  enrolmentId: string;
  enrolmentNumber: string;
  enquiryNumber: string;
  isNewStudent: boolean;
};

const REQUIRED_ADMISSION_OPTION_CATEGORIES = [
  "preferred_language",
  "qualification_level",
  "stream",
  "occupation_status",
  "batch_preference",
  "discount_reason",
] as const;

export function validateAdmissionDraftPayload(payload: unknown) {
  const sensitive = findSensitivePayloadKey(payload);
  if (sensitive) {
    return { success: false as const, message: `Admission draft cannot contain ${sensitive}.` };
  }
  const parsed = admissionPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false as const,
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }
  return { success: true as const, payload: parsed.data };
}

export function validateAdmissionForConfirmation(payload: unknown) {
  const sensitive = findSensitivePayloadKey(payload);
  if (sensitive) {
    return { success: false as const, message: `Admission draft cannot contain ${sensitive}.` };
  }
  const parsed = confirmationSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false as const,
      message: parsed.error.issues[0]?.message || "Please check the admission details.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }
  return { success: true as const, payload: parsed.data };
}

export async function getAdmissionDraft(c: AppContext, enquiryId: string) {
  return c.env.DB.prepare(
    `select * from admission_drafts
     where organisation_id = ? and enquiry_id = ? and status in ('draft', 'confirmed')
     order by created_at desc limit 1`,
  )
    .bind(ORG_ID, enquiryId)
    .first<DraftRecord>();
}

export async function saveAdmissionDraft(c: AppContext, staff: StaffContext, enquiryId: string, input: z.infer<typeof saveAdmissionDraftSchema>) {
  const enquiry = await getAdmissionEnquiry(c, enquiryId);
  if (!enquiry) return { ok: false as const, status: 404, code: "enquiry_not_found", message: "Enquiry was not found." };
  if (!enquiry.person_id) return { ok: false as const, status: 400, code: "person_required", message: "Enquiry must be linked to a person before admission." };
  if (enquiry.status === "converted" || enquiry.converted_enrolment_id) {
    return { ok: false as const, status: 409, code: "already_converted", message: "This enquiry is already converted." };
  }
  const existing = await getAdmissionDraft(c, enquiryId);
  if (existing?.confirmation_locked_at) {
    return {
      ok: false as const,
      status: 409,
      code: "admission_confirmation_locked",
      message: "Admission confirmation has started. The admission details are locked while the system completes or recovers the admission.",
    };
  }
  const validated = validateAdmissionDraftPayload(input.payload);
  if (!validated.success) return { ok: false as const, status: 400, code: "invalid_draft", message: validated.message, fieldErrors: validated.fieldErrors };
  const mobileFieldErrors: FieldErrors = {};
  if (validated.payload.contact?.primaryMobile && !normalizeIndianMobile(String(validated.payload.contact.primaryMobile))) {
    addFieldError(mobileFieldErrors, "contact.primaryMobile", "Enter a valid Indian primary mobile number.");
  }
  if (validated.payload.contact?.alternateMobile && !normalizeIndianMobile(String(validated.payload.contact.alternateMobile))) {
    addFieldError(mobileFieldErrors, "contact.alternateMobile", "Enter a valid Indian alternate mobile number.");
  }
  if (Object.keys(mobileFieldErrors).length) {
    return { ok: false as const, status: 400, code: "invalid_mobile", message: "Please correct the highlighted fields.", fieldErrors: mobileFieldErrors };
  }

  const now = new Date().toISOString();
  await upsertAdmissionContacts(c, enquiry.person_id, validated.payload.contact, now);
  const draftId = existing?.status === "draft" ? existing.id : createOpaqueId("draft");
  const normalizedPayload = await normalizeAdmissionOptionLabels(c, validated.payload);
  const normalizedCourseId = String(normalizedPayload.course?.courseId || "");
  const normalizedCourse = normalizedCourseId ? await getActiveCourse(c, normalizedCourseId) : null;
  await supersedeChangedDiscountApprovals(c, draftId, normalizedPayload, normalizedCourse);
  const storedPayload = sanitizeAdmissionDraftPayload(normalizedPayload);
  if (existing?.status === "draft") {
    await c.env.DB.prepare(
      `update admission_drafts
       set branch_id = ?, person_id = ?, payload_json = ?, current_step = ?, updated_by_login_account_id = ?, updated_at = ?
       where id = ? and status = 'draft'`,
    )
      .bind(enquiry.branch_id, enquiry.person_id, JSON.stringify(storedPayload), input.currentStep, staff.loginAccountId, now, draftId)
      .run();
  } else {
    await c.env.DB.prepare(
      `insert into admission_drafts
         (id, organisation_id, branch_id, enquiry_id, person_id, payload_json, current_step, status,
          created_by_login_account_id, updated_by_login_account_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    )
      .bind(draftId, ORG_ID, enquiry.branch_id, enquiry.id, enquiry.person_id, JSON.stringify(storedPayload), input.currentStep, staff.loginAccountId, staff.loginAccountId, now, now)
      .run();
  }
  await audit(c, staff, enquiry.branch_id, "admission_draft_saved", "admission_draft", draftId, { enquiryId });
  const readiness = await getAdmissionReadiness(c, enquiry, validated.payload, draftId);
  return { ok: true as const, draftId, payload: storedPayload, currentStep: input.currentStep, fieldErrors: readiness.fieldErrors };
}

export async function confirmAdmission(c: AppContext, staff: StaffContext, enquiryId: string): Promise<
  | { ok: true; result: AdmissionConfirmationResult }
  | AdmissionFailure
> {
  const enquiry = await getAdmissionEnquiry(c, enquiryId);
  if (!enquiry) return { ok: false, status: 404, code: "enquiry_not_found", message: "Enquiry was not found." };
  const draft = await getAdmissionDraft(c, enquiryId);
  if (!draft || !["draft", "confirmed"].includes(draft.status)) {
    if (enquiry.converted_enrolment_id) {
      const existing = await confirmationForEnrolment(c, enquiry, enquiry.converted_enrolment_id, false);
      if (existing) return { ok: true, result: existing };
    }
    return { ok: false, status: 404, code: "draft_not_found", message: "Save an admission draft before confirming." };
  }

  const snapshotResult = await getOrCreateConfirmationSnapshot(c, staff, enquiry, draft);
  if (!snapshotResult.ok) return snapshotResult;
  const snapshot = snapshotResult.snapshot;
  const validated = validateAdmissionForConfirmation(await payloadForConfirmationValidation(c, draft));
  if (!validated.success) return { ok: false, status: 400, code: "invalid_admission", message: validated.message, fieldErrors: validated.fieldErrors };
  const payload = JSON.parse(draft.payload_json) as AdmissionPayload;
  const identity = payload.identity!;
  const locality = payload.locality!;
  const education = payload.education!;
  const declarations = payload.declarations || {};

  const existingEnrolmentId = enquiry.converted_enrolment_id || (await getEnrolmentByEnquiry(c, enquiry.id))?.id || null;
  if (existingEnrolmentId) {
    const recovered = await finalizeExistingAdmission(c, staff, enquiry, draft, snapshot, payload, existingEnrolmentId);
    if (recovered.ok) return { ok: true, result: recovered.result };
    return recovered;
  }
  const admissionYear = admissionYearFromDate(snapshot.admissionDate);

  const now = new Date().toISOString();
  await upsertCanonicalPerson(c, draft.person_id, identity, snapshot.branchId, staff.loginAccountId, now);
  await upsertAdmissionContacts(c, draft.person_id, payload.contact, now);
  await upsertLocality(c, draft.id, draft.person_id, locality, now);
  await upsertEducation(c, draft.id, draft.person_id, education, now);

  let student = await c.env.DB.prepare(
    "select id, student_number from students where organisation_id = ? and person_id = ?",
  )
    .bind(ORG_ID, draft.person_id)
    .first<{ id: string; student_number: string }>();
  const isNewStudent = !student;
  if (!student) {
    const sequence = await allocateSequence(c, ORG_ID, snapshot.branchId, "student");
    const studentId = createOpaqueId("student");
    const studentNumber = `SYK-${snapshot.branchCode.toUpperCase()}-${formatSequence(sequence)}`;
    await c.env.DB.prepare(
      `insert or ignore into students
         (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, 'active', 'not_invited', ?, ?)`,
    )
      .bind(studentId, ORG_ID, draft.person_id, snapshot.branchId, studentNumber, sequence, snapshot.admissionDate, now, now)
      .run();
    student = await c.env.DB.prepare("select id, student_number from students where organisation_id = ? and person_id = ?")
      .bind(ORG_ID, draft.person_id)
      .first<{ id: string; student_number: string }>();
  }
  if (!student) return { ok: false, status: 500, code: "student_create_failed", message: "Could not create the student record." };

  const enrolmentSequence = await allocateSequence(c, ORG_ID, snapshot.branchId, `enrolment:${admissionYear}`);
  const enrolmentId = createOpaqueId("enrol");
  const enrolmentNumber = `ENR-${snapshot.branchCode.toUpperCase()}-${admissionYear}-${formatSequence(enrolmentSequence)}`;
  await c.env.DB.prepare(
    `insert or ignore into enrolments
       (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference,
        admission_date, joining_date, expected_completion_date, status, nsdc_preference, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
  )
    .bind(
      enrolmentId,
      student.id,
      snapshot.branchId,
      snapshot.courseId,
      enquiry.id,
      enrolmentNumber,
      snapshot.trainingMode,
      snapshot.batchPreference || null,
      snapshot.admissionDate,
      snapshot.joiningDate,
      snapshot.expectedCompletionDate || null,
      snapshot.nsdcPreference || "decide_later",
      now,
      now,
    )
    .run();

  const enrolment = await c.env.DB.prepare("select id, enrolment_number from enrolments where enquiry_id = ?")
    .bind(enquiry.id)
    .first<{ id: string; enrolment_number: string }>();
  if (!enrolment) return { ok: false, status: 500, code: "enrolment_create_failed", message: "Could not create the enrolment." };

  return finalizeAdmission(c, staff, enquiry, draft, {
    snapshot,
    personId: draft.person_id,
    studentId: student.id,
    studentNumber: student.student_number,
    enrolmentId: enrolment.id,
    enrolmentNumber: enrolment.enrolment_number,
    isNewStudent,
    declarations,
    now,
  });
}

async function getAdmissionEnquiry(c: AppContext, enquiryId: string) {
  return c.env.DB.prepare(
    "select * from enquiries where id = ? and organisation_id = ?",
  )
    .bind(enquiryId, ORG_ID)
    .first<EnquiryRecord>();
}

async function getEnrolmentByEnquiry(c: AppContext, enquiryId: string) {
  return c.env.DB.prepare("select id, student_id, enrolment_number from enrolments where enquiry_id = ?")
    .bind(enquiryId)
    .first<{ id: string; student_id: string; enrolment_number: string }>();
}

async function getBranch(c: AppContext, branchId: string) {
  return c.env.DB.prepare("select id, code, name from branches where id = ? and organisation_id = ? and status = 'active'")
    .bind(branchId, ORG_ID)
    .first<{ id: string; code: string; name: string }>();
}

async function getActiveCourse(c: AppContext, courseId: string) {
  return c.env.DB.prepare("select id, code, name, default_fee_paise, duration_months, lowest_acceptable_fee_paise, admission_configuration_complete from courses where id = ? and organisation_id = ? and status = 'active'")
    .bind(courseId, ORG_ID)
    .first<CourseRecord>();
}

async function finalizeExistingAdmission(c: AppContext, staff: StaffContext, enquiry: EnquiryRecord, draft: DraftRecord, snapshot: ConfirmationSnapshot, payload: AdmissionPayload, enrolmentId: string) {
  const enrolment = await c.env.DB.prepare(
    `select enrolments.id, enrolments.enrolment_number, enrolments.student_id, enrolments.branch_id,
            enrolments.course_id, enrolments.enquiry_id, enrolments.training_mode, enrolments.batch_preference,
            enrolments.admission_date, enrolments.joining_date, enrolments.expected_completion_date, enrolments.nsdc_preference,
            students.student_number, students.person_id
     from enrolments
     join students on students.id = enrolments.student_id
     where enrolments.id = ? and enrolments.enquiry_id = ?`,
  )
    .bind(enrolmentId, enquiry.id)
    .first<{
      id: string;
      enrolment_number: string;
      student_id: string;
      branch_id: string;
      course_id: string;
      enquiry_id: string | null;
      training_mode: string;
      batch_preference: string | null;
      admission_date: string;
      joining_date: string;
      expected_completion_date: string | null;
      nsdc_preference: string;
      student_number: string;
      person_id: string;
    }>();
  if (!enrolment) return { ok: false as const, status: 409, code: "enrolment_not_found", message: "Existing enrolment could not be recovered." };
  const integrityError = recoveryIntegrityErrorFor(snapshot, enrolment);
  if (integrityError) return integrityError;
  const now = new Date().toISOString();
  await upsertCanonicalPerson(c, draft.person_id, payload.identity!, snapshot.branchId, staff.loginAccountId, now);
  await upsertAdmissionContacts(c, draft.person_id, payload.contact, now);
  await upsertLocality(c, draft.id, draft.person_id, payload.locality!, now);
  await upsertEducation(c, draft.id, draft.person_id, payload.education!, now);
  return finalizeAdmission(c, staff, enquiry, draft, {
    snapshot,
    personId: draft.person_id,
    studentId: enrolment.student_id,
    studentNumber: enrolment.student_number,
    enrolmentId: enrolment.id,
    enrolmentNumber: enrolment.enrolment_number,
    isNewStudent: false,
    declarations: payload.declarations || {},
    now,
  });
}

async function finalizeAdmission(
  c: AppContext,
  staff: StaffContext,
  enquiry: EnquiryRecord,
  draft: DraftRecord,
  input: {
    snapshot: ConfirmationSnapshot;
    personId: string;
    studentId: string;
    studentNumber: string;
    enrolmentId: string;
    enrolmentNumber: string;
    isNewStudent: boolean;
    declarations: Record<string, boolean | undefined>;
    now: string;
  },
) {
  const snapshot = input.snapshot;
  if (snapshot.finalAgreedFeePaise < snapshot.lowestAcceptableFeePaise && (!snapshot.discountApprovalId || !snapshot.discountApprovedByLoginAccountId)) {
    return {
      ok: false as const,
      status: 400,
      code: "discount_approval_required",
      message: "Owner approval is required below the course floor price.",
      fieldErrors: { "fee.finalAgreedFeePaise": ["Owner approval is required below the course floor price."] },
    };
  }
  await c.env.DB.prepare(
    `insert into fee_agreements
       (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, discount_reason,
        discount_approved_by, discount_approval_id, payment_plan_type, number_of_instalments, initial_payment_expected_paise, status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
     on conflict(enrolment_id) do update set
       standard_fee_paise = excluded.standard_fee_paise,
       final_agreed_fee_paise = excluded.final_agreed_fee_paise,
       discount_paise = excluded.discount_paise,
       discount_reason = excluded.discount_reason,
       discount_approved_by = excluded.discount_approved_by,
       discount_approval_id = excluded.discount_approval_id,
       payment_plan_type = excluded.payment_plan_type,
       number_of_instalments = excluded.number_of_instalments,
       initial_payment_expected_paise = excluded.initial_payment_expected_paise,
       status = 'active',
       updated_at = excluded.updated_at`,
  )
    .bind(
      createOpaqueId("fee"),
      input.enrolmentId,
      snapshot.listedFeePaise,
      snapshot.finalAgreedFeePaise,
      snapshot.discountAmountPaise,
      snapshot.discountReasonText || null,
      snapshot.discountApprovedByLoginAccountId || null,
      snapshot.discountApprovalId || null,
      snapshot.paymentPlanType,
      snapshot.numberOfInstalments,
      snapshot.initialPaymentExpectedPaise,
      input.now,
      input.now,
    )
    .run();

  if (snapshot.nsdcPreference === "yes") {
    await c.env.DB.prepare(
      `insert into nsdc_profiles (id, enrolment_id, aadhaar_verified, status, created_at, updated_at)
       values (?, ?, 0, 'aadhaar_pending', ?, ?)
       on conflict(enrolment_id) do update set status = coalesce(nsdc_profiles.status, excluded.status), updated_at = excluded.updated_at`,
    )
      .bind(createOpaqueId("nsdc"), input.enrolmentId, input.now, input.now)
      .run();
  }

  await insertConsents(c, input.personId, input.enrolmentId, input.declarations, staff.loginAccountId, input.now);
  await c.env.DB.prepare(
    `update enquiries
     set status = 'converted',
         pipeline_stage = 'converted',
         next_follow_up_at = null,
         converted_enrolment_id = ?,
         converted_at = coalesce(converted_at, ?),
         updated_at = ?
     where id = ? and organisation_id = ? and (converted_enrolment_id is null or converted_enrolment_id = ?)`,
  )
    .bind(input.enrolmentId, input.now, input.now, enquiry.id, ORG_ID, input.enrolmentId)
    .run();
  await c.env.DB.prepare(
    `update admission_drafts
     set status = 'confirmed', updated_by_login_account_id = ?, updated_at = ?, confirmed_at = coalesce(confirmed_at, ?)
     where id = ? and status in ('draft', 'confirmed')`,
  )
    .bind(staff.loginAccountId, input.now, input.now, draft.id)
    .run();
  await auditAdmissionConfirmed(c, staff, snapshot.branchId, input.enrolmentId, {
    enquiryId: enquiry.id,
    studentId: input.studentId,
    studentNumber: input.studentNumber,
    enrolmentNumber: input.enrolmentNumber,
  });
  const finalCheck = await finalizationIntegrityError(c, enquiry, draft, input);
  if (finalCheck) return finalCheck;
  return {
    ok: true as const,
    result: {
      studentId: input.studentId,
      studentNumber: input.studentNumber,
      enrolmentId: input.enrolmentId,
      enrolmentNumber: input.enrolmentNumber,
      enquiryNumber: enquiry.enquiry_number,
      isNewStudent: input.isNewStudent,
    },
  };
}

async function finalizationIntegrityError(
  c: AppContext,
  enquiry: EnquiryRecord,
  draft: DraftRecord,
  input: {
    snapshot: ConfirmationSnapshot;
    personId: string;
    studentId: string;
    studentNumber: string;
    enrolmentId: string;
    enrolmentNumber: string;
    isNewStudent: boolean;
    declarations: Record<string, boolean | undefined>;
    now: string;
  },
) {
  const finalEnquiry = await getAdmissionEnquiry(c, enquiry.id);
  const finalDraft = await c.env.DB.prepare("select status, confirmed_at, confirmation_snapshot_json from admission_drafts where id = ?")
    .bind(draft.id)
    .first<{ status: string; confirmed_at: string | null; confirmation_snapshot_json: string | null }>();
  const finalSnapshot = finalDraft ? parseConfirmationSnapshot(finalDraft) : null;
  if (
    finalEnquiry?.converted_enrolment_id !== input.enrolmentId ||
    finalEnquiry.status !== "converted" ||
    finalEnquiry.pipeline_stage !== "converted" ||
    finalDraft?.status !== "confirmed" ||
    !finalDraft.confirmed_at ||
    !snapshotsMatch(input.snapshot, finalSnapshot)
  ) {
    return { ok: false as const, status: 409, code: "confirmation_inconsistent", message: "Admission confirmation could not be finalised consistently. Please retry." };
  }
  const enrolment = await c.env.DB.prepare(
    `select enrolments.id, enrolments.enrolment_number, enrolments.student_id, enrolments.branch_id,
            enrolments.course_id, enrolments.enquiry_id, enrolments.training_mode, enrolments.batch_preference,
            enrolments.admission_date, enrolments.joining_date, enrolments.expected_completion_date, enrolments.nsdc_preference,
            students.person_id
     from enrolments
     join students on students.id = enrolments.student_id
     where enrolments.id = ?`,
  )
    .bind(input.enrolmentId)
    .first<Record<string, unknown>>();
  if (!enrolment || recoveryIntegrityErrorFor(input.snapshot, enrolment)) {
    return { ok: false as const, status: 409, code: "recovery_integrity_error", message: "Admission recovery terms do not match the locked confirmation snapshot." };
  }
  const feeAgreement = await c.env.DB.prepare(
    `select standard_fee_paise, final_agreed_fee_paise, discount_paise, discount_approved_by, discount_approval_id,
            payment_plan_type, number_of_instalments, initial_payment_expected_paise
     from fee_agreements
     where enrolment_id = ?`,
  )
    .bind(input.enrolmentId)
    .first<Record<string, unknown>>();
  if (!feeAgreement || feeAgreementIntegrityErrorFor(input.snapshot, feeAgreement)) {
    return { ok: false as const, status: 409, code: "recovery_integrity_error", message: "Fee agreement does not match the locked confirmation snapshot." };
  }
  return null;
}

const CONFIRMATION_SNAPSHOT_VERSION = "admission-confirmation-v1";

type ConfirmationSnapshot = {
  version: string;
  organisationId: string;
  enquiryId: string;
  draftId: string;
  personId: string;
  branchId: string;
  branchCode: string;
  courseId: string;
  admissionDate: string;
  joiningDate: string;
  expectedCompletionDate: string | null;
  trainingMode: string;
  batchPreference: string | null;
  nsdcPreference: string;
  listedFeePaise: number;
  lowestAcceptableFeePaise: number;
  finalAgreedFeePaise: number;
  discountAmountPaise: number;
  discountReasonCode: string;
  discountReasonText: string | null;
  paymentPlanType: string;
  numberOfInstalments: number;
  initialPaymentExpectedPaise: number;
  discountApprovalId: string | null;
  discountApprovedByLoginAccountId: string | null;
  payloadFingerprint: string;
};

async function getOrCreateConfirmationSnapshot(c: AppContext, staff: StaffContext, enquiry: EnquiryRecord, draft: DraftRecord) {
  const existing = parseConfirmationSnapshot(draft);
  if (existing) return { ok: true as const, snapshot: existing };

  if (draft.status !== "draft") return { ok: false as const, status: 404, code: "draft_not_found", message: "Save an admission draft before confirming." };
  const validated = validateAdmissionForConfirmation(await payloadForConfirmationValidation(c, draft));
  if (!validated.success) return { ok: false as const, status: 400, code: "invalid_admission", message: validated.message, fieldErrors: validated.fieldErrors };
  const payload = validated.payload;
  const branchFieldErrors = await validateBranchLock(c, enquiry, payload, draft.branch_id);
  if (Object.keys(branchFieldErrors).length) {
    return { ok: false as const, status: 400, code: "invalid_branch", message: firstFieldError(branchFieldErrors) || "Admission branch must match the enquiry branch.", fieldErrors: branchFieldErrors };
  }
  const branch = await getBranch(c, enquiry.branch_id);
  if (!branch) return { ok: false as const, status: 400, code: "invalid_branch", message: "Select an active branch." };
  const course = await getActiveCourse(c, payload.course?.courseId || "");
  if (!course) return { ok: false as const, status: 400, code: "invalid_course", message: "Select an active configured course." };
  const readiness = await getAdmissionReadiness(c, enquiry, payload, draft.id, course);
  if (Object.keys(readiness.fieldErrors).length) {
    return { ok: false as const, status: 400, code: "invalid_admission", message: firstFieldError(readiness.fieldErrors) || "Please check the admission details.", fieldErrors: readiness.fieldErrors };
  }

  const snapshot = await buildConfirmationSnapshot(c, enquiry, draft, payload, branch, course);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `update admission_drafts
     set confirmation_locked_at = ?,
         confirmation_snapshot_json = ?,
         confirmation_snapshot_version = ?,
         confirmation_locked_by_login_account_id = ?,
         updated_by_login_account_id = ?,
         updated_at = ?
     where id = ?
       and status = 'draft'
       and confirmation_locked_at is null`,
  )
    .bind(now, JSON.stringify(snapshot), CONFIRMATION_SNAPSHOT_VERSION, staff.loginAccountId, staff.loginAccountId, now, draft.id)
    .run();

  const lockedDraft = await c.env.DB.prepare("select * from admission_drafts where id = ?")
    .bind(draft.id)
    .first<DraftRecord>();
  const lockedSnapshot = lockedDraft ? parseConfirmationSnapshot(lockedDraft) : null;
  if (!lockedSnapshot) {
    return { ok: false as const, status: 409, code: "admission_confirmation_lock_failed", message: "Admission confirmation could not be locked. Please retry confirmation." };
  }
  return { ok: true as const, snapshot: lockedSnapshot };
}

async function buildConfirmationSnapshot(c: AppContext, enquiry: EnquiryRecord, draft: DraftRecord, payload: AdmissionPayload, branch: { id: string; code: string }, course: CourseRecord): Promise<ConfirmationSnapshot> {
  const fee = payload.fee!;
  const courseInput = payload.course!;
  const listedFeePaise = Number(course.default_fee_paise || 0);
  const lowestAcceptableFeePaise = Number(course.lowest_acceptable_fee_paise || 0);
  const finalAgreedFeePaise = Number(fee.finalAgreedFeePaise || 0);
  const ownerApproval = await ownerApprovalForFeeAgreement(c, draft.id, course, fee);
  return {
    version: CONFIRMATION_SNAPSHOT_VERSION,
    organisationId: ORG_ID,
    enquiryId: enquiry.id,
    draftId: draft.id,
    personId: draft.person_id,
    branchId: branch.id,
    branchCode: branch.code,
    courseId: course.id,
    admissionDate: String(courseInput.admissionDate),
    joiningDate: String(courseInput.joiningDate),
    expectedCompletionDate: courseInput.expectedCompletionDate ? String(courseInput.expectedCompletionDate) : null,
    trainingMode: String(courseInput.trainingMode),
    batchPreference: courseInput.batchPreference ? String(courseInput.batchPreference) : null,
    nsdcPreference: String(courseInput.nsdcPreference || "decide_later"),
    listedFeePaise,
    lowestAcceptableFeePaise,
    finalAgreedFeePaise,
    discountAmountPaise: Math.max(0, listedFeePaise - finalAgreedFeePaise),
    discountReasonCode: String(fee.discountReasonCode || ""),
    discountReasonText: fee.discountReason ? String(fee.discountReason) : null,
    paymentPlanType: String(fee.paymentPlanType),
    numberOfInstalments: instalmentsFor(String(fee.paymentPlanType), Number(fee.numberOfInstalments || 0)),
    initialPaymentExpectedPaise: Number(fee.initialPaymentExpectedPaise || 0),
    discountApprovalId: ownerApproval?.id || null,
    discountApprovedByLoginAccountId: ownerApproval?.decided_by_login_account_id || null,
    payloadFingerprint: await hmacHex(c.env.SESSION_PEPPER, "admission-confirmation-payload", JSON.stringify(payload)),
  };
}

function parseConfirmationSnapshot(draft: Pick<DraftRecord, "confirmation_snapshot_json">): ConfirmationSnapshot | null {
  if (!draft.confirmation_snapshot_json) return null;
  try {
    const parsed = JSON.parse(draft.confirmation_snapshot_json) as ConfirmationSnapshot;
    return parsed.version === CONFIRMATION_SNAPSHOT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function recoveryIntegrityErrorFor(snapshot: ConfirmationSnapshot, enrolment: Record<string, unknown>) {
  const expected: Record<string, string | null> = {
    person_id: snapshot.personId,
    branch_id: snapshot.branchId,
    course_id: snapshot.courseId,
    enquiry_id: snapshot.enquiryId,
    admission_date: snapshot.admissionDate,
    joining_date: snapshot.joiningDate,
    expected_completion_date: snapshot.expectedCompletionDate,
    training_mode: snapshot.trainingMode,
    batch_preference: snapshot.batchPreference,
    nsdc_preference: snapshot.nsdcPreference,
  };
  for (const [key, value] of Object.entries(expected)) {
    if ((enrolment[key] ?? null) !== value) {
      return { ok: false as const, status: 409, code: "recovery_integrity_error", message: "Existing enrolment does not match the locked confirmation snapshot." };
    }
  }
  return null;
}

function feeAgreementIntegrityErrorFor(snapshot: ConfirmationSnapshot, feeAgreement: Record<string, unknown>) {
  const expected: Record<string, number | string | null> = {
    standard_fee_paise: snapshot.listedFeePaise,
    final_agreed_fee_paise: snapshot.finalAgreedFeePaise,
    discount_paise: snapshot.discountAmountPaise,
    discount_approved_by: snapshot.discountApprovedByLoginAccountId,
    discount_approval_id: snapshot.discountApprovalId,
    payment_plan_type: snapshot.paymentPlanType,
    number_of_instalments: snapshot.numberOfInstalments,
    initial_payment_expected_paise: snapshot.initialPaymentExpectedPaise,
  };
  for (const [key, value] of Object.entries(expected)) {
    if ((feeAgreement[key] ?? null) !== value) return true;
  }
  return false;
}

function snapshotsMatch(expected: ConfirmationSnapshot, actual: ConfirmationSnapshot | null) {
  return Boolean(actual && JSON.stringify(actual) === JSON.stringify(expected));
}

export async function getAdmissionConfiguration(c: AppContext) {
  const [options, paymentPlanRules] = await Promise.all([
    c.env.DB.prepare(
      `select category, code, label, sort_order, requires_custom_label, is_active
       from admission_option_values
       where organisation_id = ? and is_active = 1
       order by category, sort_order, label`,
    )
      .bind(ORG_ID)
      .all<AdmissionOptionRecord>(),
    c.env.DB.prepare(
      `select min_duration_months, max_duration_months, plan_type, fixed_instalments, is_active
       from payment_plan_rules
       where organisation_id = ? and is_active = 1
       order by min_duration_months, coalesce(max_duration_months, 999), fixed_instalments`,
    )
      .bind(ORG_ID)
      .all<Record<string, unknown>>(),
  ]);
  const activeOptions = options.results || [];
  const activePaymentPlanRules = paymentPlanRules.results || [];
  const availableCategories = new Set(activeOptions.map((option) => option.category));
  const missingCategories = REQUIRED_ADMISSION_OPTION_CATEGORIES.filter((category) => !availableCategories.has(category));
  return {
    options: activeOptions,
    paymentPlanRules: activePaymentPlanRules,
    configuration: {
      ready: missingCategories.length === 0 && activePaymentPlanRules.length > 0,
      missingCategories,
      paymentPlanRulesConfigured: activePaymentPlanRules.length > 0,
    },
  };
}

export async function requestDiscountApproval(c: AppContext, staff: StaffContext, enquiryId: string) {
  const enquiry = await getAdmissionEnquiry(c, enquiryId);
  if (!enquiry) return { ok: false as const, status: 404, code: "enquiry_not_found", message: "Enquiry was not found." };
  const draft = await getAdmissionDraft(c, enquiryId);
  if (!draft || draft.status !== "draft") return { ok: false as const, status: 404, code: "draft_not_found", message: "Save a draft before requesting approval." };
  const validated = validateAdmissionDraftPayload(JSON.parse(draft.payload_json));
  if (!validated.success) return { ok: false as const, status: 400, code: "invalid_draft", message: validated.message };
  const payload = validated.payload;
  const course = await getActiveCourse(c, payload.course?.courseId || "");
  if (!course) return { ok: false as const, status: 400, code: "invalid_course", message: "Select an active configured course." };
  const errors = await discountApprovalFieldErrors(c, payload, draft.id, course);
  const floor = Number(course.lowest_acceptable_fee_paise);
  if (Number(payload.fee?.finalAgreedFeePaise || 0) >= floor) {
    return { ok: false as const, status: 400, code: "approval_not_required", message: "Owner approval is only required below the course floor price." };
  }
  const reasonCode = String(payload.fee?.discountReasonCode || "");
  if (errors["fee.discountReasonCode"]) {
    return { ok: false as const, status: 400, code: "discount_reason_required", message: errors["fee.discountReasonCode"][0], fieldErrors: errors };
  }
  const now = new Date().toISOString();
  const snapshot = approvalSnapshot(draft.id, course, payload);
  await supersedeChangedDiscountApprovals(c, draft.id, payload, course);
  const existing = await matchingDiscountApproval(c, snapshot);
  if (existing?.status === "pending" || existing?.status === "approved") {
    return { ok: true as const, approvalId: existing.id, status: existing.status };
  }
  const approvalId = createOpaqueId("approval");
  await c.env.DB.prepare(
    `insert into admission_discount_approvals
       (id, organisation_id, admission_draft_id, enquiry_id, course_id, listed_fee_paise, lowest_acceptable_fee_paise,
        requested_final_fee_paise, discount_amount_paise, approval_fingerprint, discount_reason_code,
        discount_reason_text, status, requested_by_login_account_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
     on conflict do nothing`,
  )
    .bind(
      approvalId,
      ORG_ID,
      draft.id,
      enquiry.id,
      course.id,
      snapshot.listedFeePaise,
      snapshot.lowestAcceptableFeePaise,
      snapshot.requestedFinalFeePaise,
      snapshot.discountAmountPaise,
      snapshot.approvalFingerprint,
      snapshot.discountReasonCode,
      snapshot.discountReasonText || null,
      staff.loginAccountId,
      now,
      now,
    )
    .run();
  const active = await matchingDiscountApproval(c, snapshot);
  if (active?.status === "pending" || active?.status === "approved") {
    await audit(c, staff, enquiry.branch_id, "discount_approval_requested", "admission_discount_approval", active.id, { enquiryId, draftId: draft.id });
    return { ok: true as const, approvalId: active.id, status: active.status };
  }
  await audit(c, staff, enquiry.branch_id, "discount_approval_requested", "admission_discount_approval", approvalId, { enquiryId, draftId: draft.id });
  return { ok: true as const, approvalId, status: "pending" };
}

export async function listDiscountApprovals(c: AppContext) {
  const approvals = await c.env.DB.prepare(
    `select admission_discount_approvals.*, enquiries.enquiry_number, people.full_name, courses.name as course_name,
            coalesce(
              (select staff_people.public_name
               from login_account_people
               join people as staff_people on staff_people.id = login_account_people.person_id
               where login_account_people.login_account_id = admission_discount_approvals.requested_by_login_account_id
               order by login_account_people.is_default desc
               limit 1),
              admission_discount_approvals.requested_by_login_account_id
            ) as requested_by_name
     from admission_discount_approvals
     join enquiries on enquiries.id = admission_discount_approvals.enquiry_id
     left join people on people.id = enquiries.person_id
     join courses on courses.id = admission_discount_approvals.course_id
     where admission_discount_approvals.organisation_id = ?
     order by case admission_discount_approvals.status when 'pending' then 1 when 'approved' then 2 when 'rejected' then 3 else 4 end,
              admission_discount_approvals.created_at desc`,
  )
    .bind(ORG_ID)
    .all<Record<string, unknown>>();
  return approvals.results || [];
}

export async function decideDiscountApproval(c: AppContext, staff: StaffContext, approvalId: string, decision: "approved" | "rejected") {
  if (!staff.roles.some((role) => DISCOUNT_APPROVER_ROLES.includes(role as (typeof DISCOUNT_APPROVER_ROLES)[number]))) {
    return { ok: false as const, status: 403, code: "forbidden", message: "Owner approval is required." };
  }
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `update admission_discount_approvals
     set status = ?, decided_by_login_account_id = ?, decided_at = ?, updated_at = ?
     where id = ? and organisation_id = ? and status = 'pending'`,
  )
    .bind(decision, staff.loginAccountId, now, now, approvalId, ORG_ID)
    .run();
  if (!changed(result)) return { ok: false as const, status: 404, code: "approval_not_found", message: "Pending approval was not found." };
  await audit(c, staff, null, `discount_approval_${decision}`, "admission_discount_approval", approvalId, {});
  return { ok: true as const, approvalId, status: decision };
}

async function getAdmissionReadiness(c: AppContext, enquiry: EnquiryRecord, payload: AdmissionPayload, draftId: string, knownCourse?: CourseRecord) {
  const fieldErrors: FieldErrors = {};
  const syncValidation = validateAdmissionForConfirmation(payload);
  if (!syncValidation.success) mergeFieldErrors(fieldErrors, syncValidation.fieldErrors || {});
  mergeFieldErrors(fieldErrors, await validateBranchLock(c, enquiry, payload, enquiry.branch_id));
  mergeFieldErrors(fieldErrors, await validateAdmissionOptions(c, payload));
  const courseId = String(payload.course?.courseId || "");
  const course = knownCourse || (courseId ? await getActiveCourse(c, courseId) : null);
  if (!course) {
    addFieldError(fieldErrors, "course.courseId", "Select an active configured course.");
    return { fieldErrors };
  }
  mergeFieldErrors(fieldErrors, courseConfigurationFieldErrors(course));
  mergeFieldErrors(fieldErrors, await paymentPlanFieldErrors(c, payload, course));
  mergeFieldErrors(fieldErrors, await discountApprovalFieldErrors(c, payload, draftId, course));
  return { fieldErrors };
}

async function payloadForConfirmationValidation(c: AppContext, draft: DraftRecord) {
  const payload = JSON.parse(draft.payload_json) as AdmissionPayload;
  if (payload.contact?.primaryMobile) return payload;
  const hasStoredPrimary = await c.env.DB.prepare(
    "select id from person_contacts where person_id = ? and contact_type = 'mobile' and is_primary = 1 limit 1",
  )
    .bind(draft.person_id)
    .first<{ id: string }>();
  if (!hasStoredPrimary) return payload;
  // Draft JSON redacts mobile numbers; presence of the encrypted contact satisfies confirmation validation.
  return {
    ...payload,
    contact: {
      ...(payload.contact || {}),
      primaryMobile: "+919999999999",
    },
  } satisfies AdmissionPayload;
}

async function validateBranchLock(c: AppContext, enquiry: EnquiryRecord, payload: AdmissionPayload, expectedBranchId: string) {
  const fieldErrors: FieldErrors = {};
  const payloadBranchId = String(payload.course?.branchId || "");
  if (payloadBranchId && payloadBranchId !== expectedBranchId) {
    addFieldError(fieldErrors, "course.branchId", "Admission branch is locked to the enquiry branch.");
  }
  const branch = await getBranch(c, expectedBranchId);
  if (!branch) addFieldError(fieldErrors, "course.branchId", "The enquiry branch is not active.");
  return fieldErrors;
}

async function validateAdmissionOptions(c: AppContext, payload: AdmissionPayload) {
  const fieldErrors: FieldErrors = {};
  const map = await admissionOptionsMap(c);
  validateOptionSelection(fieldErrors, map, "preferred_language", payload.contact?.preferredLanguageCode, payload.contact?.preferredLanguage, "contact.preferredLanguageCode", "Preferred language");
  validateOptionSelection(fieldErrors, map, "qualification_level", payload.education?.qualificationLevelCode, payload.education?.qualificationLevel, "education.qualificationLevelCode", "Highest/current qualification");
  validateOptionSelection(fieldErrors, map, "stream", payload.education?.streamCode, payload.education?.stream, "education.streamCode", "Stream", false);
  validateOptionSelection(fieldErrors, map, "occupation_status", payload.education?.occupationStatusCode, payload.education?.occupationStatus, "education.occupationStatusCode", "Current occupation status");
  validateOptionSelection(fieldErrors, map, "batch_preference", payload.course?.batchPreferenceCode, payload.course?.batchPreference, "course.batchPreferenceCode", "Batch preference", false);
  if (Number(payload.fee?.finalAgreedFeePaise || 0) < Number(payload.fee?.standardFeePaise || 0)) {
    validateOptionSelection(fieldErrors, map, "discount_reason", payload.fee?.discountReasonCode, payload.fee?.discountReason, "fee.discountReasonCode", "Discount reason");
  } else if (payload.fee?.discountReasonCode) {
    validateOptionSelection(fieldErrors, map, "discount_reason", payload.fee.discountReasonCode, payload.fee.discountReason, "fee.discountReasonCode", "Discount reason", false);
  }
  return fieldErrors;
}

async function normalizeAdmissionOptionLabels(c: AppContext, payload: AdmissionPayload): Promise<AdmissionPayload> {
  const map = await admissionOptionsMap(c);
  const next: AdmissionPayload = {
    ...payload,
    contact: { ...(payload.contact || {}) } as NonNullable<AdmissionPayload["contact"]>,
    education: { ...(payload.education || {}) } as NonNullable<AdmissionPayload["education"]>,
    course: { ...(payload.course || {}) } as NonNullable<AdmissionPayload["course"]>,
    fee: { ...(payload.fee || {}) } as NonNullable<AdmissionPayload["fee"]>,
  };
  const contact = next.contact as Record<string, unknown>;
  const education = next.education as Record<string, unknown>;
  const course = next.course as Record<string, unknown>;
  const fee = next.fee as Record<string, unknown>;
  applyOptionLabel(contact, "preferredLanguageCode", "preferredLanguage", map.preferred_language);
  applyOptionLabel(education, "qualificationLevelCode", "qualificationLevel", map.qualification_level);
  applyOptionLabel(education, "streamCode", "stream", map.stream);
  applyOptionLabel(education, "occupationStatusCode", "occupationStatus", map.occupation_status);
  applyOptionLabel(course, "batchPreferenceCode", "batchPreference", map.batch_preference);
  applyOptionLabel(fee, "discountReasonCode", "discountReason", map.discount_reason);
  if (next.education?.currentlyPursuing) {
    next.education.passingYear = null;
  } else {
    if (next.education) next.education.currentYearSemester = "";
  }
  return next;
}

async function admissionOptionsMap(c: AppContext) {
  const rows = await c.env.DB.prepare(
    `select category, code, label, requires_custom_label, is_active
     from admission_option_values
     where organisation_id = ? and is_active = 1`,
  )
    .bind(ORG_ID)
    .all<AdmissionOptionRecord>();
  const map: Record<string, Record<string, AdmissionOptionRecord>> = {};
  for (const option of rows.results || []) {
    map[option.category] ||= {};
    map[option.category][option.code] = option;
  }
  return map as Record<string, Record<string, AdmissionOptionRecord>>;
}

function validateOptionSelection(
  fieldErrors: FieldErrors,
  optionsByCategory: Record<string, Record<string, AdmissionOptionRecord>>,
  category: string,
  code: unknown,
  label: unknown,
  path: string,
  fieldLabel: string,
  required = true,
) {
  const value = typeof code === "string" ? code.trim() : "";
  if (!value) {
    if (required) addFieldError(fieldErrors, path, `${fieldLabel} is required.`);
    return;
  }
  const option = optionsByCategory[category]?.[value];
  if (!option) {
    addFieldError(fieldErrors, path, `Select an active ${fieldLabel.toLowerCase()} option.`);
    return;
  }
  if (Boolean(option.requires_custom_label) && (typeof label !== "string" || !label.trim() || label.trim() === option.label)) {
    addFieldError(fieldErrors, path.replace(/Code$/, ""), `Enter the custom ${fieldLabel.toLowerCase()} label.`);
  }
}

function applyOptionLabel(target: Record<string, unknown>, codeKey: string, labelKey: string, options: Record<string, AdmissionOptionRecord> | undefined) {
  const code = typeof target[codeKey] === "string" ? String(target[codeKey]) : "";
  const option = code ? options?.[code] : null;
  if (!option) return;
  if (!option.requires_custom_label || !String(target[labelKey] || "").trim()) {
    target[labelKey] = option.label;
  }
}

function courseConfigurationFieldErrors(course: CourseRecord) {
  const fieldErrors: FieldErrors = {};
  const duration = Number(course.duration_months);
  const standard = Number(course.default_fee_paise);
  const floor = Number(course.lowest_acceptable_fee_paise);
  if (!Boolean(course.admission_configuration_complete)) addFieldError(fieldErrors, "course.courseId", "Selected course requires Course Master configuration before admission.");
  if (!Number.isInteger(duration) || duration < 1) addFieldError(fieldErrors, "course.courseId", "Selected course must have a duration of at least one month.");
  if (!Number.isInteger(standard) || standard < 0) addFieldError(fieldErrors, "fee.standardFeePaise", "Selected course must have a configured listed price.");
  if (!Number.isInteger(floor) || floor < 0) addFieldError(fieldErrors, "fee.finalAgreedFeePaise", "Selected course must have a configured floor price.");
  if (Number.isInteger(standard) && Number.isInteger(floor) && floor > standard) {
    addFieldError(fieldErrors, "fee.finalAgreedFeePaise", "Selected course floor price cannot exceed listed price.");
  }
  return fieldErrors;
}

async function paymentPlanFieldErrors(c: AppContext, payload: AdmissionPayload, course: CourseRecord) {
  const fieldErrors: FieldErrors = {};
  const rules = await c.env.DB.prepare(
    `select plan_type, fixed_instalments
     from payment_plan_rules
     where organisation_id = ?
       and is_active = 1
       and min_duration_months <= ?
       and (max_duration_months is null or max_duration_months >= ?)
     order by fixed_instalments`,
  )
    .bind(ORG_ID, Number(course.duration_months || 0), Number(course.duration_months || 0))
    .all<PaymentPlanRuleRecord>();
  const selected = String(payload.fee?.paymentPlanType || "");
  const rule = (rules.results || []).find((item) => item.plan_type === selected);
  if (!rule) {
    addFieldError(fieldErrors, "fee.paymentPlanType", "Select a payment plan allowed for the course duration.");
    return fieldErrors;
  }
  if (rule.fixed_instalments !== null && Number(payload.fee?.numberOfInstalments || rule.fixed_instalments) !== Number(rule.fixed_instalments)) {
    addFieldError(fieldErrors, "fee.numberOfInstalments", `${paymentPlanLabel(selected)} uses ${rule.fixed_instalments} instalment${rule.fixed_instalments === 1 ? "" : "s"}.`);
  }
  return fieldErrors;
}

async function discountApprovalFieldErrors(c: AppContext, payload: AdmissionPayload, draftId: string, course: CourseRecord) {
  const fieldErrors: FieldErrors = {};
  const finalFee = Number(payload.fee?.finalAgreedFeePaise || 0);
  const standard = Number(course.default_fee_paise || 0);
  const floor = Number(course.lowest_acceptable_fee_paise || 0);
  if (finalFee < 0) addFieldError(fieldErrors, "fee.finalAgreedFeePaise", "Final agreed fee cannot be negative.");
  if (finalFee < standard && !String(payload.fee?.discountReasonCode || "").trim()) {
    addFieldError(fieldErrors, "fee.discountReasonCode", "Discount reason is required when the final fee is lower than Course Master price.");
  }
  if (finalFee < floor) {
    const approval = await matchingDiscountApproval(c, approvalSnapshot(draftId, course, payload));
    const ownerApproved = approval?.status === "approved" && approval.decided_by_login_account_id && (await discountApprovalDecisionIsOwner(c, approval.id, approval.decided_by_login_account_id));
    if (!ownerApproved) {
      addFieldError(fieldErrors, "fee.finalAgreedFeePaise", "Owner approval is required below the course floor price.");
    }
  }
  return fieldErrors;
}

async function matchingDiscountApproval(c: AppContext, snapshot: ApprovalSnapshot) {
  return c.env.DB.prepare(
    `select id, status, course_id, listed_fee_paise, lowest_acceptable_fee_paise, requested_final_fee_paise,
            discount_amount_paise, approval_fingerprint, discount_reason_code, discount_reason_text,
            decided_by_login_account_id
     from admission_discount_approvals
     where admission_draft_id = ?
       and course_id = ?
       and listed_fee_paise = ?
       and lowest_acceptable_fee_paise = ?
       and requested_final_fee_paise = ?
       and discount_reason_code = ?
       and coalesce(discount_reason_text, '') = ?
       and approval_fingerprint = ?
       and status in ('pending', 'approved')
     order by updated_at desc limit 1`,
  )
    .bind(
      snapshot.draftId,
      snapshot.courseId,
      snapshot.listedFeePaise,
      snapshot.lowestAcceptableFeePaise,
      snapshot.requestedFinalFeePaise,
      snapshot.discountReasonCode,
      snapshot.discountReasonText,
      snapshot.approvalFingerprint,
    )
    .first<DiscountApprovalRecord>();
}

async function supersedeChangedDiscountApprovals(c: AppContext, draftId: string | null, payload: AdmissionPayload, course: CourseRecord | null) {
  if (!draftId) return;
  const snapshot = course
    ? approvalSnapshot(draftId, course, payload)
    : {
        approvalFingerprint: "",
        courseId: String(payload.course?.courseId || ""),
        listedFeePaise: 0,
        lowestAcceptableFeePaise: 0,
        requestedFinalFeePaise: Number(payload.fee?.finalAgreedFeePaise || 0),
        discountReasonCode: String(payload.fee?.discountReasonCode || ""),
        discountReasonText: String(payload.fee?.discountReason || ""),
      };
  await c.env.DB.prepare(
    `update admission_discount_approvals
     set status = 'superseded', updated_at = ?
     where admission_draft_id = ?
       and status in ('pending', 'approved')
       and approval_fingerprint != ?`,
  )
    .bind(new Date().toISOString(), draftId, snapshot.approvalFingerprint)
    .run();
}

type ApprovalSnapshot = {
  draftId: string;
  courseId: string;
  listedFeePaise: number;
  lowestAcceptableFeePaise: number;
  requestedFinalFeePaise: number;
  discountAmountPaise: number;
  discountReasonCode: string;
  discountReasonText: string;
  approvalFingerprint: string;
};

function approvalSnapshot(draftId: string, course: CourseRecord, payload: AdmissionPayload): ApprovalSnapshot {
  const listedFeePaise = Number(course.default_fee_paise || 0);
  const lowestAcceptableFeePaise = Number(course.lowest_acceptable_fee_paise || 0);
  const requestedFinalFeePaise = Number(payload.fee?.finalAgreedFeePaise || 0);
  const discountReasonCode = String(payload.fee?.discountReasonCode || "");
  const discountReasonText = String(payload.fee?.discountReason || "");
  const snapshot = {
    draftId,
    courseId: course.id,
    listedFeePaise,
    lowestAcceptableFeePaise,
    requestedFinalFeePaise,
    discountAmountPaise: Math.max(0, listedFeePaise - requestedFinalFeePaise),
    discountReasonCode,
    discountReasonText,
  };
  return {
    ...snapshot,
    approvalFingerprint: JSON.stringify(snapshot),
  };
}

async function ownerApprovalForFeeAgreement(c: AppContext, draftId: string, course: CourseRecord, feeInput: NonNullable<AdmissionPayload["fee"]>) {
  const finalFee = Number(feeInput.finalAgreedFeePaise || 0);
  if (finalFee >= Number(course.lowest_acceptable_fee_paise || 0)) return null;
  const approval = await matchingDiscountApproval(c, approvalSnapshot(draftId, course, { fee: feeInput } as AdmissionPayload));
  if (approval?.status !== "approved" || !approval.decided_by_login_account_id) return null;
  if (!(await discountApprovalDecisionIsOwner(c, approval.id, approval.decided_by_login_account_id))) return null;
  return approval;
}

async function discountApprovalDecisionIsOwner(c: AppContext, approvalId: string, loginAccountId: string) {
  const currentOwner = await c.env.DB.prepare(
    `select 1 as ok
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.organisation_id = ?
       and roles.code = 'owner'
     limit 1`,
  )
    .bind(loginAccountId, ORG_ID)
    .first<{ ok: number }>();
  if (currentOwner) return true;
  const historicalOwnerDecision = await c.env.DB.prepare(
    `select 1 as ok
     from audit_logs
     where organisation_id = ?
       and actor_login_account_id = ?
       and action = 'discount_approval_approved'
       and entity_type = 'admission_discount_approval'
       and entity_id = ?
     limit 1`,
  )
    .bind(ORG_ID, loginAccountId, approvalId)
    .first<{ ok: number }>();
  return Boolean(historicalOwnerDecision);
}

async function allocateSequence(c: AppContext, organisationId: string, branchId: string, sequenceKey: string) {
  const now = new Date().toISOString();
  const id = `seq_${organisationId}_${branchId}_${sequenceKey}`.replace(/[^a-zA-Z0-9_:-]/g, "_");
  await c.env.DB.prepare(
    `insert or ignore into number_sequences (id, organisation_id, branch_id, sequence_key, next_sequence, created_at, updated_at)
     values (?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, organisationId, branchId, sequenceKey, now, now)
    .run();
  const row = await c.env.DB.prepare(
    `update number_sequences
     set next_sequence = next_sequence + 1, updated_at = ?
     where organisation_id = ? and branch_id = ? and sequence_key = ?
     returning next_sequence - 1 as sequence`,
  )
    .bind(now, organisationId, branchId, sequenceKey)
    .first<{ sequence: number }>();
  if (!row) throw new Error("Could not allocate sequence");
  return Number(row.sequence);
}

async function upsertCanonicalPerson(c: AppContext, personId: string, identity: NonNullable<AdmissionPayload["identity"]>, branchId: string, staffId: string, now: string) {
  const fullName = identity.officialFullName!.trim();
  const dob = identity.dateOfBirth!.trim();
  await c.env.DB.batch([
    c.env.DB.prepare("update people set full_name = ?, public_name = ?, date_of_birth = ?, home_branch_id = coalesce(home_branch_id, ?), updated_at = ? where id = ? and organisation_id = ?")
      .bind(fullName, fullName, dob, branchId, now, personId, ORG_ID),
    c.env.DB.prepare(
      `insert into person_identity_details
         (person_id, official_full_name, first_name, middle_name, last_name, date_of_birth, gender, father_name, mother_name,
          occupation_status, identity_verified, identity_verified_at, identity_verified_by, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
       on conflict(person_id) do update set
         official_full_name = excluded.official_full_name,
         first_name = excluded.first_name,
         middle_name = excluded.middle_name,
         last_name = excluded.last_name,
         date_of_birth = excluded.date_of_birth,
         gender = excluded.gender,
         father_name = excluded.father_name,
         mother_name = excluded.mother_name,
         occupation_status = excluded.occupation_status,
         identity_verified = 1,
         identity_verified_at = excluded.identity_verified_at,
         identity_verified_by = excluded.identity_verified_by,
         updated_at = excluded.updated_at`,
    ).bind(
      personId,
      fullName,
      identity.firstName || null,
      identity.middleName || null,
      identity.lastName || null,
      dob,
      identity.gender || null,
      identity.fatherName || null,
      identity.motherName || null,
      null,
      now,
      staffId,
      now,
      now,
    ),
  ]);
}

async function upsertAdmissionContacts(c: AppContext, personId: string, contact: AdmissionPayload["contact"], now: string) {
  const primaryMobile = contact?.primaryMobile?.trim();
  const alternateMobile = contact?.alternateMobile?.trim();
  const normalizedPrimary = primaryMobile ? normalizeIndianMobile(primaryMobile) : null;
  const normalizedAlternate = alternateMobile ? normalizeIndianMobile(alternateMobile) : null;
  if (primaryMobile) {
    await upsertMobileContact(c, personId, {
      mobile: primaryMobile,
      belongsTo: contact?.belongsTo || "student",
      isWhatsapp: contact?.isWhatsapp ? 1 : 0,
      isPrimary: true,
      now,
    });
  }
  if (alternateMobile && normalizedAlternate !== normalizedPrimary) {
    await upsertMobileContact(c, personId, {
      mobile: alternateMobile,
      belongsTo: "other",
      isWhatsapp: 0,
      isPrimary: false,
      now,
    });
  }
}

async function upsertMobileContact(
  c: AppContext,
  personId: string,
  input: { mobile: string; belongsTo: string; isWhatsapp: number; isPrimary: boolean; now: string },
) {
  const normalizedMobile = normalizeIndianMobile(input.mobile);
  if (!normalizedMobile) throw new Error("Invalid mobile");
  const lookupHash = await mobileHash(c, normalizedMobile);
  const existing = await c.env.DB.prepare("select id from person_contacts where person_id = ? and contact_type = 'mobile' and normalized_value = ?")
    .bind(personId, lookupHash)
    .first<{ id: string }>();
  const contactId = existing?.id || createOpaqueId("contact");
  const ciphertext = await encryptText(c.env.SESSION_PEPPER, `contact:${contactId}`, normalizedMobile);
  const statements = [
    ...(input.isPrimary
      ? [
          c.env.DB.prepare("update person_contacts set is_primary = 0, updated_at = ? where person_id = ? and contact_type = 'mobile' and is_primary = 1 and id != ?")
            .bind(input.now, personId, contactId),
        ]
      : []),
    c.env.DB.prepare(
      `insert into person_contacts
         (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, created_at, updated_at)
       values (?, ?, 'mobile', ?, null, ?, ?, 0, ?, ?)
       on conflict(person_id, contact_type, normalized_value) do update set
         is_primary = excluded.is_primary,
         is_verified = case when excluded.is_primary = 1 then person_contacts.is_verified else 0 end,
         last_four = excluded.last_four,
         updated_at = excluded.updated_at`,
    ).bind(contactId, personId, lookupHash, normalizedMobile.slice(-4), input.isPrimary ? 1 : 0, input.now, input.now),
    c.env.DB.prepare(
      `insert into person_contact_details (contact_id, belongs_to, is_whatsapp, status, created_at, updated_at)
       values (?, ?, ?, 'active', ?, ?)
       on conflict(contact_id) do update set belongs_to = excluded.belongs_to, is_whatsapp = excluded.is_whatsapp, updated_at = excluded.updated_at`,
    ).bind(contactId, input.belongsTo, input.isWhatsapp, input.now, input.now),
    c.env.DB.prepare(
      `insert into person_contact_secrets (contact_id, value_ciphertext, encryption_version, created_at, updated_at)
       values (?, ?, 'v1', ?, ?)
       on conflict(contact_id) do update set value_ciphertext = excluded.value_ciphertext, updated_at = excluded.updated_at`,
    ).bind(contactId, ciphertext, input.now, input.now),
  ];
  await c.env.DB.batch(statements);
}

async function upsertLocality(c: AppContext, draftId: string, personId: string, locality: NonNullable<AdmissionPayload["locality"]>, now: string) {
  const localityId = stableAdmissionChildId("loc_admission", draftId);
  await c.env.DB.prepare("update person_localities set status = 'previous', valid_until = ?, updated_at = ? where person_id = ? and locality_type = 'current' and status = 'active' and id != ?")
    .bind(now, now, personId, localityId)
    .run();
  await c.env.DB.prepare(
    `insert into person_localities
       (id, person_id, locality_type, locality, city, postal_code, state, residence_type, full_address, valid_from, status, created_at, updated_at)
     values (?, ?, 'current', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
     on conflict(id) do update set
       locality = excluded.locality,
       city = excluded.city,
       postal_code = excluded.postal_code,
       state = excluded.state,
       residence_type = excluded.residence_type,
       full_address = excluded.full_address,
       valid_until = null,
       status = 'active',
       updated_at = excluded.updated_at`,
  )
    .bind(localityId, personId, locality.locality, locality.city, locality.postalCode || null, locality.state || "Maharashtra", locality.residenceType || null, locality.fullAddress || null, now, now, now)
    .run();
}

async function upsertEducation(c: AppContext, draftId: string, personId: string, education: NonNullable<AdmissionPayload["education"]>, now: string) {
  await c.env.DB.prepare(
    `insert into education_records
       (id, person_id, qualification_level, qualification_name, stream, institution_name, currently_pursuing, current_year_semester, passing_year, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       qualification_level = excluded.qualification_level,
       qualification_name = excluded.qualification_name,
       stream = excluded.stream,
       institution_name = excluded.institution_name,
       currently_pursuing = excluded.currently_pursuing,
       current_year_semester = excluded.current_year_semester,
       passing_year = excluded.passing_year,
       updated_at = excluded.updated_at`,
  )
    .bind(
      stableAdmissionChildId("edu_admission", draftId),
      personId,
      education.qualificationLevel,
      education.qualificationName || null,
      education.stream || null,
      education.institutionName || null,
      education.currentlyPursuing ? 1 : 0,
      education.currentYearSemester || null,
      education.passingYear || null,
      now,
      now,
    )
    .run();
  await c.env.DB.prepare(
    "update person_identity_details set occupation_status = ?, updated_at = ? where person_id = ?",
  )
    .bind(education.occupationStatus, now, personId)
    .run();
}

async function insertConsents(c: AppContext, personId: string, enrolmentId: string, declarations: Record<string, boolean | undefined>, staffId: string, now: string) {
  const consentTypes = [
    "information_correct",
    "name_dob_matches_aadhaar",
    "course_rules_explained",
    "fee_terms_accepted",
    "data_processing_accepted",
    "nsdc_processing_accepted",
    "nsdc_pending_documents_understood",
    "marketing_messages",
    "alumni_communication",
    "referral_programme",
    "placement_profile_sharing",
    "photograph_testimonial_use",
  ] as const;
  const statements = consentTypes.map((type) => {
    const camel = type.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    return c.env.DB.prepare(
      `insert into student_consents
         (id, person_id, enrolment_id, consent_type, consent_given, consent_version, captured_method, captured_by, captured_at)
       values (?, ?, ?, ?, ?, 'admission-v1', 'staff_form', ?, ?)
       on conflict(enrolment_id, consent_type) where enrolment_id is not null do update set
         person_id = excluded.person_id,
         consent_given = excluded.consent_given,
         consent_version = excluded.consent_version,
         captured_method = excluded.captured_method,
         captured_by = excluded.captured_by,
         captured_at = excluded.captured_at,
         withdrawn_at = null`,
    ).bind(createOpaqueId("consent"), personId, enrolmentId, type, declarations[camel] ? 1 : 0, staffId, now);
  });
  await c.env.DB.batch(statements);
}

async function confirmationForEnrolment(c: AppContext, enquiry: EnquiryRecord, enrolmentId: string, isNewStudent: boolean) {
  const row = await c.env.DB.prepare(
    `select students.id as student_id, students.student_number, enrolments.id as enrolment_id, enrolments.enrolment_number
     from enrolments
     join students on students.id = enrolments.student_id
     where enrolments.id = ?`,
  )
    .bind(enrolmentId)
    .first<{ student_id: string; student_number: string; enrolment_id: string; enrolment_number: string }>();
  if (!row) return null;
  return {
    studentId: row.student_id,
    studentNumber: row.student_number,
    enrolmentId: row.enrolment_id,
    enrolmentNumber: row.enrolment_number,
    enquiryNumber: enquiry.enquiry_number,
    isNewStudent,
  };
}

async function audit(c: AppContext, staff: StaffContext, branchId: string | null, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  await c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(createOpaqueId("audit"), ORG_ID, branchId, staff.loginAccountId, staff.activePersonId, action, entityType, entityId, JSON.stringify(metadata), new Date().toISOString())
    .run();
}

async function auditAdmissionConfirmed(c: AppContext, staff: StaffContext, branchId: string | null, enrolmentId: string, metadata: Record<string, unknown>) {
  await c.env.DB.prepare(
    `insert or ignore into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, 'admission_confirmed', 'enrolment', ?, ?, ?)`,
  )
    .bind(stableAdmissionChildId("audit_admission_confirmed", enrolmentId), ORG_ID, branchId, staff.loginAccountId, staff.activePersonId, enrolmentId, JSON.stringify(metadata), new Date().toISOString())
    .run();
}

function requireField(ctx: z.RefinementCtx, value: unknown, path: (string | number)[], message: string) {
  if (typeof value !== "string" || !value.trim()) ctx.addIssue({ code: "custom", path, message });
}

export function fieldErrorsFromIssues(issues: z.ZodIssue[]): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of issues) addFieldError(fieldErrors, issue.path.join("."), issue.message);
  return fieldErrors;
}

function addFieldError(fieldErrors: FieldErrors, path: string, message: string) {
  fieldErrors[path] ||= [];
  if (!fieldErrors[path].includes(message)) fieldErrors[path].push(message);
}

function mergeFieldErrors(target: FieldErrors, source: FieldErrors) {
  for (const [path, messages] of Object.entries(source)) {
    for (const message of messages) addFieldError(target, path, message);
  }
}

function firstFieldError(fieldErrors: FieldErrors) {
  return Object.values(fieldErrors)[0]?.[0] || null;
}

function paymentPlanLabel(value: string) {
  if (value === "full") return "Full payment";
  if (value === "two_instalments") return "Two instalments";
  if (value === "three_instalments") return "Three instalments";
  return "Custom payment plan";
}

function changed(result: { meta?: { changes?: number; rows_written?: number } }) {
  return Number(result.meta?.changes ?? result.meta?.rows_written ?? 0) > 0;
}

function findSensitivePayloadKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (normalized.includes("aadhaar") && !["namedobmatchesaadhaar", "identityconfirmed"].includes(normalized)) return key;
    if (normalized.includes("bank") || normalized.includes("secret")) return key;
    const found = findSensitivePayloadKey(nested);
    if (found) return found;
  }
  return null;
}

function formatSequence(sequence: number) {
  return String(sequence).padStart(6, "0");
}

function stableAdmissionChildId(prefix: string, draftId: string) {
  return `${prefix}_${draftId.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90)}`;
}

function validIsoDate(value: string) {
  if (!dateSchema.safeParse(value).success) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function admissionYearFromDate(value: string | undefined) {
  if (!value || !validIsoDate(value)) throw new Error("Invalid admission date");
  return value.slice(0, 4);
}

function instalmentsFor(paymentPlanType: string | undefined, custom: number | null | undefined) {
  if (paymentPlanType === "full") return 1;
  if (paymentPlanType === "two_instalments") return 2;
  if (paymentPlanType === "three_instalments") return 3;
  return custom || 1;
}

function sanitizeAdmissionDraftPayload(payload: AdmissionPayload): AdmissionPayload {
  return {
    ...payload,
    contact: {
      ...(payload.contact || {}),
      primaryMobile: "",
      alternateMobile: "",
    },
  };
}
