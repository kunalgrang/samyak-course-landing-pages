import { z } from "zod";
import type { AppContext } from "./http";
import { ORG_ID, mobileHash } from "./auth-store";
import { createOpaqueId, encryptText } from "./crypto";
import type { StaffContext } from "./staff-auth";

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
      qualificationName: z.string().trim().max(140).optional(),
      stream: z.string().trim().max(100).optional(),
      institutionName: z.string().trim().max(180).optional(),
      currentlyPursuing: z.boolean().optional(),
      currentYearSemester: z.string().trim().max(80).optional(),
      passingYear: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
      occupationStatus: z.string().trim().max(80).optional(),
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
  requireField(ctx, locality.locality, ["locality", "locality"], "Locality is required.");
  requireField(ctx, locality.city, ["locality", "city"], "City is required.");
  requireField(ctx, education.qualificationLevel, ["education", "qualificationLevel"], "Highest/current qualification is required.");
  requireField(ctx, education.occupationStatus, ["education", "occupationStatus"], "Current occupation status is required.");
  requireField(ctx, course.courseId, ["course", "courseId"], "Select a configured course.");
  requireField(ctx, course.branchId, ["course", "branchId"], "Select a branch.");
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

type EnquiryRecord = {
  id: string;
  organisation_id: string;
  branch_id: string;
  person_id: string;
  enquiry_number: string;
  status: string;
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
};

export type AdmissionConfirmationResult = {
  studentId: string;
  studentNumber: string;
  enrolmentId: string;
  enrolmentNumber: string;
  enquiryNumber: string;
  isNewStudent: boolean;
};

export function validateAdmissionDraftPayload(payload: unknown) {
  const sensitive = findSensitivePayloadKey(payload);
  if (sensitive) {
    return { success: false as const, message: `Admission draft cannot contain ${sensitive}.` };
  }
  const parsed = admissionPayloadSchema.safeParse(payload);
  if (!parsed.success) return { success: false as const, message: "Please check the admission draft details." };
  return { success: true as const, payload: parsed.data };
}

export function validateAdmissionForConfirmation(payload: unknown) {
  const sensitive = findSensitivePayloadKey(payload);
  if (sensitive) {
    return { success: false as const, message: `Admission draft cannot contain ${sensitive}.` };
  }
  const parsed = confirmationSchema.safeParse(payload);
  if (!parsed.success) return { success: false as const, message: parsed.error.issues[0]?.message || "Please check the admission details." };
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
  const validated = validateAdmissionDraftPayload(input.payload);
  if (!validated.success) return { ok: false as const, status: 400, code: "invalid_draft", message: validated.message };
  if (validated.payload.contact?.primaryMobile && !normalizeIndianMobile(String(validated.payload.contact.primaryMobile))) {
    return { ok: false as const, status: 400, code: "invalid_mobile", message: "Enter a valid Indian primary mobile number." };
  }
  if (validated.payload.contact?.alternateMobile && !normalizeIndianMobile(String(validated.payload.contact.alternateMobile))) {
    return { ok: false as const, status: 400, code: "invalid_mobile", message: "Enter a valid Indian alternate mobile number." };
  }

  const now = new Date().toISOString();
  await upsertAdmissionContacts(c, enquiry.person_id, validated.payload.contact, now);
  const storedPayload = sanitizeAdmissionDraftPayload(validated.payload);
  const existing = await getAdmissionDraft(c, enquiryId);
  const draftId = existing?.status === "draft" ? existing.id : createOpaqueId("draft");
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
  return { ok: true as const, draftId, payload: storedPayload, currentStep: input.currentStep };
}

export async function confirmAdmission(c: AppContext, staff: StaffContext, enquiryId: string): Promise<
  | { ok: true; result: AdmissionConfirmationResult }
  | { ok: false; status: number; code: string; message: string }
> {
  const enquiry = await getAdmissionEnquiry(c, enquiryId);
  if (!enquiry) return { ok: false, status: 404, code: "enquiry_not_found", message: "Enquiry was not found." };
  const draft = await getAdmissionDraft(c, enquiryId);
  const existingEnrolmentId = enquiry.converted_enrolment_id || (await getEnrolmentByEnquiry(c, enquiry.id))?.id || null;
  if (existingEnrolmentId && draft) {
    const recovered = await finalizeExistingAdmission(c, staff, enquiry, draft, existingEnrolmentId);
    if (recovered.ok) return { ok: true, result: recovered.result };
    return recovered;
  }
  if (enquiry.converted_enrolment_id) {
    const existing = await confirmationForEnrolment(c, enquiry, enquiry.converted_enrolment_id, false);
    if (existing) return { ok: true, result: existing };
    return { ok: false, status: 409, code: "already_converted", message: "This enquiry is already converted." };
  }

  if (!draft || draft.status !== "draft") return { ok: false, status: 404, code: "draft_not_found", message: "Save an admission draft before confirming." };
  const validated = validateAdmissionForConfirmation(JSON.parse(draft.payload_json));
  if (!validated.success) return { ok: false, status: 400, code: "invalid_admission", message: validated.message };
  const payload = validated.payload;
  const branch = await getBranch(c, payload.course?.branchId || draft.branch_id);
  if (!branch) return { ok: false, status: 400, code: "invalid_branch", message: "Select an active branch." };
  const course = await getActiveCourse(c, payload.course?.courseId || "");
  if (!course) return { ok: false, status: 400, code: "invalid_course", message: "Select an active configured course." };
  const identity = payload.identity!;
  const courseInput = payload.course!;
  const feeInput = payload.fee!;
  const locality = payload.locality!;
  const education = payload.education!;
  const declarations = payload.declarations || {};
  if (course.default_fee_paise === null || course.default_fee_paise === undefined) {
    return { ok: false, status: 400, code: "course_fee_required", message: "Selected course must have a configured standard fee." };
  }
  const courseStandardFeePaise = Number(course.default_fee_paise);
  if (Number(feeInput.finalAgreedFeePaise || 0) < courseStandardFeePaise && !feeInput.discountReason?.trim()) {
    return { ok: false, status: 400, code: "discount_reason_required", message: "Discount reason is required when the final fee is lower than Course Master fee." };
  }
  const admissionYear = admissionYearFromDate(courseInput.admissionDate);

  const now = new Date().toISOString();
  await upsertCanonicalPerson(c, draft.person_id, identity, branch.id, staff.loginAccountId, now);
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
    const sequence = await allocateSequence(c, ORG_ID, branch.id, "student");
    const studentId = createOpaqueId("student");
    const studentNumber = `SYK-${branch.code.toUpperCase()}-${formatSequence(sequence)}`;
    await c.env.DB.prepare(
      `insert or ignore into students
         (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, 'active', 'not_invited', ?, ?)`,
    )
      .bind(studentId, ORG_ID, draft.person_id, branch.id, studentNumber, sequence, courseInput.admissionDate, now, now)
      .run();
    student = await c.env.DB.prepare("select id, student_number from students where organisation_id = ? and person_id = ?")
      .bind(ORG_ID, draft.person_id)
      .first<{ id: string; student_number: string }>();
  }
  if (!student) return { ok: false, status: 500, code: "student_create_failed", message: "Could not create the student record." };

  const enrolmentSequence = await allocateSequence(c, ORG_ID, branch.id, `enrolment:${admissionYear}`);
  const enrolmentId = createOpaqueId("enrol");
  const enrolmentNumber = `ENR-${branch.code.toUpperCase()}-${admissionYear}-${formatSequence(enrolmentSequence)}`;
  await c.env.DB.prepare(
    `insert or ignore into enrolments
       (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference,
        admission_date, joining_date, expected_completion_date, status, nsdc_preference, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
  )
    .bind(
      enrolmentId,
      student.id,
      branch.id,
      course.id,
      enquiry.id,
      enrolmentNumber,
      courseInput.trainingMode,
      courseInput.batchPreference || null,
      courseInput.admissionDate,
      courseInput.joiningDate,
      courseInput.expectedCompletionDate || null,
      courseInput.nsdcPreference || "decide_later",
      now,
      now,
    )
    .run();

  const enrolment = await c.env.DB.prepare("select id, enrolment_number from enrolments where enquiry_id = ?")
    .bind(enquiry.id)
    .first<{ id: string; enrolment_number: string }>();
  if (!enrolment) return { ok: false, status: 500, code: "enrolment_create_failed", message: "Could not create the enrolment." };

  return finalizeAdmission(c, staff, enquiry, draft, {
    branchId: branch.id,
    personId: draft.person_id,
    studentId: student.id,
    studentNumber: student.student_number,
    enrolmentId: enrolment.id,
    enrolmentNumber: enrolment.enrolment_number,
    isNewStudent,
    feeInput,
    declarations,
    nsdcPreference: courseInput.nsdcPreference,
    courseStandardFeePaise,
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
  return c.env.DB.prepare("select id, code, name, default_fee_paise from courses where id = ? and organisation_id = ? and status = 'active'")
    .bind(courseId, ORG_ID)
    .first<{ id: string; code: string; name: string; default_fee_paise: number | null }>();
}

async function finalizeExistingAdmission(c: AppContext, staff: StaffContext, enquiry: EnquiryRecord, draft: DraftRecord, enrolmentId: string) {
  const validated = validateAdmissionForConfirmation(JSON.parse(draft.payload_json));
  if (!validated.success) return { ok: false as const, status: 400, code: "invalid_admission", message: validated.message };
  const payload = validated.payload;
  const course = await getActiveCourse(c, payload.course?.courseId || "");
  if (!course) return { ok: false as const, status: 400, code: "invalid_course", message: "Select an active configured course." };
  if (course.default_fee_paise === null || course.default_fee_paise === undefined) {
    return { ok: false as const, status: 400, code: "course_fee_required", message: "Selected course must have a configured standard fee." };
  }
  const courseStandardFeePaise = Number(course.default_fee_paise);
  const feeInput = payload.fee!;
  if (Number(feeInput.finalAgreedFeePaise || 0) < courseStandardFeePaise && !feeInput.discountReason?.trim()) {
    return { ok: false as const, status: 400, code: "discount_reason_required", message: "Discount reason is required when the final fee is lower than Course Master fee." };
  }
  const enrolment = await c.env.DB.prepare(
    `select enrolments.id, enrolments.enrolment_number, enrolments.student_id, enrolments.branch_id,
            students.student_number, students.person_id
     from enrolments
     join students on students.id = enrolments.student_id
     where enrolments.id = ? and enrolments.enquiry_id = ?`,
  )
    .bind(enrolmentId, enquiry.id)
    .first<{ id: string; enrolment_number: string; student_id: string; branch_id: string; student_number: string; person_id: string }>();
  if (!enrolment) return { ok: false as const, status: 409, code: "enrolment_not_found", message: "Existing enrolment could not be recovered." };
  const now = new Date().toISOString();
  await upsertCanonicalPerson(c, draft.person_id, payload.identity!, enrolment.branch_id, staff.loginAccountId, now);
  await upsertAdmissionContacts(c, draft.person_id, payload.contact, now);
  await upsertLocality(c, draft.id, draft.person_id, payload.locality!, now);
  await upsertEducation(c, draft.id, draft.person_id, payload.education!, now);
  return finalizeAdmission(c, staff, enquiry, draft, {
    branchId: enrolment.branch_id,
    personId: draft.person_id,
    studentId: enrolment.student_id,
    studentNumber: enrolment.student_number,
    enrolmentId: enrolment.id,
    enrolmentNumber: enrolment.enrolment_number,
    isNewStudent: false,
    feeInput,
    declarations: payload.declarations || {},
    nsdcPreference: payload.course?.nsdcPreference,
    courseStandardFeePaise,
    now,
  });
}

async function finalizeAdmission(
  c: AppContext,
  staff: StaffContext,
  enquiry: EnquiryRecord,
  draft: DraftRecord,
  input: {
    branchId: string;
    personId: string;
    studentId: string;
    studentNumber: string;
    enrolmentId: string;
    enrolmentNumber: string;
    isNewStudent: boolean;
    feeInput: NonNullable<AdmissionPayload["fee"]>;
    declarations: Record<string, boolean | undefined>;
    nsdcPreference: string | undefined;
    courseStandardFeePaise: number;
    now: string;
  },
) {
  const discountPaise = Math.max(0, input.courseStandardFeePaise - Number(input.feeInput.finalAgreedFeePaise || 0));
  await c.env.DB.prepare(
    `insert into fee_agreements
       (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, discount_reason,
        discount_approved_by, payment_plan_type, number_of_instalments, initial_payment_expected_paise, status, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
     on conflict(enrolment_id) do update set
       standard_fee_paise = excluded.standard_fee_paise,
       final_agreed_fee_paise = excluded.final_agreed_fee_paise,
       discount_paise = excluded.discount_paise,
       discount_reason = excluded.discount_reason,
       discount_approved_by = excluded.discount_approved_by,
       payment_plan_type = excluded.payment_plan_type,
       number_of_instalments = excluded.number_of_instalments,
       initial_payment_expected_paise = excluded.initial_payment_expected_paise,
       status = 'active',
       updated_at = excluded.updated_at`,
  )
    .bind(
      createOpaqueId("fee"),
      input.enrolmentId,
      input.courseStandardFeePaise,
      input.feeInput.finalAgreedFeePaise || 0,
      discountPaise,
      input.feeInput.discountReason || null,
      discountPaise > 0 ? staff.loginAccountId : null,
      input.feeInput.paymentPlanType,
      instalmentsFor(input.feeInput.paymentPlanType, input.feeInput.numberOfInstalments),
      input.feeInput.initialPaymentExpectedPaise || 0,
      input.now,
      input.now,
    )
    .run();

  if (input.nsdcPreference === "yes") {
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
     set status = 'converted', converted_enrolment_id = ?, converted_at = coalesce(converted_at, ?), updated_at = ?
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
  await auditAdmissionConfirmed(c, staff, input.branchId, input.enrolmentId, {
    enquiryId: enquiry.id,
    studentId: input.studentId,
    studentNumber: input.studentNumber,
    enrolmentNumber: input.enrolmentNumber,
  });
  const finalEnquiry = await getAdmissionEnquiry(c, enquiry.id);
  const finalDraft = await c.env.DB.prepare("select status, confirmed_at from admission_drafts where id = ?")
    .bind(draft.id)
    .first<{ status: string; confirmed_at: string | null }>();
  if (finalEnquiry?.converted_enrolment_id !== input.enrolmentId || finalEnquiry.status !== "converted" || finalDraft?.status !== "confirmed" || !finalDraft.confirmed_at) {
    return { ok: false as const, status: 409, code: "confirmation_inconsistent", message: "Admission confirmation could not be finalised consistently. Please retry." };
  }
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

function normalizeIndianMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
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
