import { z } from "zod";
import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { ORG_ID } from "../lib/auth-store";
import { confirmAdmission, getAdmissionDraft, saveAdmissionDraft, saveAdmissionDraftSchema } from "../lib/admission-service";
import { ADMISSION_STAFF_ROLES, COURSE_ADMIN_ROLES, requireStaffRoles, type StaffContext } from "../lib/staff-auth";
import { createOpaqueId, decryptText } from "../lib/crypto";
import { jsonError, jsonPlain } from "../lib/json-response";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const courseSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(140),
  durationLabel: z.string().trim().max(80).nullable().optional(),
  standardFeePaise: z.coerce.number().int().min(0),
  nsdcAvailable: z.boolean().default(false),
  status: z.enum(["active", "inactive", "archived"]).default("active"),
});

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

export function registerStaffAdmissionRoutes(app: PortalHono) {
  app.get("/api/staff/courses/active", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const courses = await c.env.DB.prepare(
      `select id, code, name, duration_label, default_fee_paise, nsdc_available, status
       from courses
       where organisation_id = ? and status = 'active'
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
      `select id, code, name, duration_label, default_fee_paise, nsdc_available, status, created_at, updated_at
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
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_course", message: "Please check course details." });
    const now = new Date().toISOString();
    const courseId = createOpaqueId("course");
    try {
      await c.env.DB.prepare(
        `insert into courses
           (id, organisation_id, code, name, duration_label, default_fee_paise, nsdc_available, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          courseId,
          ORG_ID,
          parsed.data.code.toUpperCase(),
          parsed.data.name,
          parsed.data.durationLabel || null,
          parsed.data.standardFeePaise,
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
    const parsed = courseSchema.partial().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_course", message: "Please check course details." });
    const existing = await c.env.DB.prepare("select id from courses where id = ? and organisation_id = ?")
      .bind(c.req.param("courseId"), ORG_ID)
      .first<{ id: string }>();
    if (!existing) return jsonError(c, { status: 404, code: "course_not_found", message: "Course was not found." });
    const current = await c.env.DB.prepare("select * from courses where id = ?").bind(existing.id).first<Record<string, unknown>>();
    const next = { ...current, ...toCourseRow(parsed.data), updated_at: new Date().toISOString() };
    try {
      await c.env.DB.prepare(
        `update courses
         set code = ?, name = ?, duration_label = ?, default_fee_paise = ?, nsdc_available = ?, status = ?, updated_at = ?
         where id = ? and organisation_id = ?`,
      )
        .bind(next.code, next.name, next.duration_label ?? null, next.default_fee_paise ?? 0, next.nsdc_available ? 1 : 0, next.status, next.updated_at, existing.id, ORG_ID)
        .run();
    } catch {
      return jsonError(c, { status: 409, code: "course_code_exists", message: "Course code already exists." });
    }
    await audit(c, staff, "course_updated", "course", existing.id, { status: next.status });
    return jsonPlain(c, { success: true, courseId: existing.id });
  });

  app.get("/api/staff/enquiries/:enquiryId", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const detail = await getEnquiryDetail(c, c.req.param("enquiryId"));
    if (!detail) return jsonError(c, { status: 404, code: "enquiry_not_found", message: "Enquiry was not found." });
    return jsonPlain(c, detail);
  });

  app.patch("/api/staff/enquiries/:enquiryId", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = enquiryStatusSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_status", message: "Select a valid enquiry status." });
    const result = await c.env.DB.prepare(
      "update enquiries set status = ?, updated_at = ? where id = ? and organisation_id = ? and status != 'converted'",
    )
      .bind(parsed.data.status, new Date().toISOString(), c.req.param("enquiryId"), ORG_ID)
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
          }
        : null,
    });
  });

  app.post("/api/staff/enquiries/:enquiryId/admission-draft", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const parsed = saveAdmissionDraftSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_draft", message: "Please check the admission draft." });
    const result = await saveAdmissionDraft(c, staff, c.req.param("enquiryId"), parsed.data);
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message });
    return jsonPlain(c, { success: true, draftId: result.draftId, payload: result.payload, currentStep: result.currentStep });
  });

  app.post("/api/staff/enquiries/:enquiryId/confirm-admission", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const result = await confirmAdmission(c, staff, c.req.param("enquiryId"));
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message });
    return jsonPlain(c, { success: true, ...result.result });
  });

  app.get("/api/staff/students/:studentId", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const profile = await getStudentProfile(c, c.req.param("studentId"));
    if (!profile) return jsonError(c, { status: 404, code: "student_not_found", message: "Student was not found." });
    return jsonPlain(c, profile);
  });
}

async function getEnquiryDetail(c: Parameters<typeof getAdmissionDraft>[0], enquiryId: string) {
  const enquiry = await c.env.DB.prepare(
    `select enquiries.*, people.full_name, people.date_of_birth, students.id as student_id, students.student_number,
            courses.name as course_name, courses.id as course_id, enquiry_course_interests.course_interest_text
     from enquiries
     left join people on people.id = enquiries.person_id
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
  const primaryMobile = enquiry.person_id ? await fullPrimaryMobile(c, String(enquiry.person_id)) : null;
  const draft = await getAdmissionDraft(c, enquiryId);
  return {
    enquiry,
    primaryMobile,
    mobileDisplay: primaryMobile ? maskMobile(primaryMobile) : null,
    previousEnrolments: enrolments.results || [],
    activeDraft: draft ? { id: draft.id, status: draft.status, currentStep: draft.current_step } : null,
  };
}

async function getStudentProfile(c: Parameters<typeof getAdmissionDraft>[0], studentId: string) {
  const student = await c.env.DB.prepare(
    `select students.*, people.full_name, people.date_of_birth
     from students
     join people on people.id = students.person_id
     where students.id = ? and students.organisation_id = ?`,
  )
    .bind(studentId, ORG_ID)
    .first<Record<string, unknown>>();
  if (!student) return null;
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
  return {
    student,
    primaryMobile,
    mobileDisplay: primaryMobile ? maskMobile(primaryMobile) : null,
    locality: localities.results?.[0] || null,
    education: education.results?.[0] || null,
    enrolments: enrolments.results || [],
    enquiries: enquiries.results || [],
  };
}

async function fullPrimaryMobile(c: Parameters<typeof getAdmissionDraft>[0], personId: string) {
  const contact = await c.env.DB.prepare(
    `select person_contacts.id, person_contact_secrets.value_ciphertext
     from person_contacts
     left join person_contact_secrets on person_contact_secrets.contact_id = person_contacts.id
     where person_contacts.person_id = ? and person_contacts.contact_type = 'mobile'
     order by person_contacts.is_primary desc, person_contacts.created_at desc
     limit 1`,
  )
    .bind(personId)
    .first<{ id: string; value_ciphertext: string | null }>();
  if (!contact?.value_ciphertext) return null;
  return decryptText(c.env.SESSION_PEPPER, `contact:${contact.id}`, contact.value_ciphertext).catch(() => null);
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

function toCourseRow(input: Partial<z.infer<typeof courseSchema>>) {
  return {
    ...(input.code ? { code: input.code.toUpperCase() } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.durationLabel !== undefined ? { duration_label: input.durationLabel || null } : {}),
    ...(input.standardFeePaise !== undefined ? { default_fee_paise: input.standardFeePaise } : {}),
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
