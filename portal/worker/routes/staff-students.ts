import { z } from "zod";
import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { ORG_ID, getSessionFromRequest, mobileHash } from "../lib/auth-store";
import { createOpaqueId } from "../lib/crypto";
import { jsonError, jsonPlain } from "../lib/json-response";
import { normalizeIndianMobile as normalizeCanonicalIndianMobile } from "../lib/mobile";
import { addMobileIfMissing } from "../lib/person-contact";
import { ADMISSION_STAFF_ROLES, requireStaffRoles } from "../lib/staff-auth";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const createEnquirySchema = z
  .object({
    mobile: z.string().min(10).max(20),
    fullName: z.string().trim().min(2).max(120),
    branchId: z.string().min(1),
    courseInterestId: z.string().min(1).nullable().optional(),
    courseInterestText: z.string().trim().max(120).nullable().optional(),
    source: z.string().trim().min(1).max(60),
    sourceDetail: z.string().trim().max(200).nullable().optional(),
    preferredTiming: z.string().trim().max(120).nullable().optional(),
    preferredJoiningDate: z.string().trim().max(20).nullable().optional(),
    existingPersonId: z.string().min(1).nullable().optional(),
  })
  .refine((value) => Boolean(value.courseInterestId || value.courseInterestText), {
    message: "Select or enter the course of interest.",
    path: ["courseInterestText"],
  });

export function registerStaffStudentRoutes(app: PortalHono) {
  app.get("/api/staff/enquiry-options", async (c) => {
    const staff = await requireStaff(c);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });

    const [branches, courses] = await Promise.all([
      c.env.DB.prepare(
        "select id, code, name from branches where organisation_id = ? and status = 'active' order by name",
      )
        .bind(ORG_ID)
        .all(),
      c.env.DB.prepare(
        "select id, code, name, duration_label, default_fee_paise, nsdc_available from courses where organisation_id = ? and status = 'active' and admission_configuration_complete = 1 order by name",
      )
        .bind(ORG_ID)
        .all(),
    ]);

    return jsonPlain(c, {
      branches: branches.results || [],
      courses: courses.results || [],
      sources: [
        "Google Ads",
        "Google Organic",
        "Google Maps",
        "Instagram",
        "Facebook",
        "Website",
        "WhatsApp",
        "Walk-in",
        "Student Referral",
        "Alumni Referral",
        "Friend or Family",
        "Existing Student",
        "Corporate Enquiry",
        "Other",
      ],
    });
  });

  app.get("/api/staff/student-search", async (c) => {
    const staff = await requireStaff(c);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });

    const normalizedMobile = normalizeIndianMobile(c.req.query("mobile") || "");
    if (!normalizedMobile) {
      return jsonError(c, { status: 400, code: "invalid_mobile", message: "Enter a valid 10-digit Indian mobile number." });
    }

    const lookupHash = await mobileHash(c, normalizedMobile);
    const people = await c.env.DB.prepare(
      `select
         people.id as person_id,
         coalesce(person_identity_details.official_full_name, people.full_name) as full_name,
         person_identity_details.date_of_birth as date_of_birth,
         students.id as student_id,
         students.student_number as student_number,
         students.current_status as student_status,
         person_contacts.last_four as mobile_last_four
       from person_contacts
       join people on people.id = person_contacts.person_id
       left join person_identity_details on person_identity_details.person_id = people.id
       left join students on students.person_id = people.id and students.organisation_id = ?
       where person_contacts.contact_type = 'mobile'
         and person_contacts.normalized_value = ?
         and people.organisation_id = ?
         and people.status != 'archived'
       order by students.student_since desc, people.created_at desc`,
    )
      .bind(ORG_ID, lookupHash, ORG_ID)
      .all();

    const enquiries = await c.env.DB.prepare(
      `select enquiries.id, enquiries.enquiry_number, enquiries.person_id, enquiries.status,
              enquiries.source, enquiries.created_at,
              coalesce(courses.name, enquiry_course_interests.course_interest_text) as course_name
       from enquiries
       left join courses on courses.id = enquiries.course_interest_id
       left join enquiry_course_interests on enquiry_course_interests.enquiry_id = enquiries.id
       where enquiries.organisation_id = ? and enquiries.mobile_used = ?
       order by enquiries.created_at desc
       limit 20`,
    )
      .bind(ORG_ID, lookupHash)
      .all();

    return jsonPlain(c, {
      mobileLastFour: normalizedMobile.slice(-4),
      possiblePeople: people.results || [],
      enquiries: enquiries.results || [],
    });
  });

  app.post("/api/staff/enquiries", async (c) => {
    const staff = await requireStaff(c);
    if (!staff) return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });

    const parsed = createEnquirySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(c, { status: 400, code: "invalid_request", message: "Please check the enquiry details." });
    }

    const normalizedMobile = normalizeIndianMobile(parsed.data.mobile);
    if (!normalizedMobile) {
      return jsonError(c, { status: 400, code: "invalid_mobile", message: "Enter a valid 10-digit Indian mobile number." });
    }

    const branch = await c.env.DB.prepare(
      "select id, code from branches where id = ? and organisation_id = ? and status = 'active'",
    )
      .bind(parsed.data.branchId, ORG_ID)
      .first<{ id: string; code: string }>();
    if (!branch) return jsonError(c, { status: 400, code: "invalid_branch", message: "Select an active branch." });

    if (parsed.data.courseInterestId) {
      const course = await c.env.DB.prepare(
        "select id from courses where id = ? and organisation_id = ? and status = 'active' and admission_configuration_complete = 1",
      )
        .bind(parsed.data.courseInterestId, ORG_ID)
        .first();
      if (!course) return jsonError(c, { status: 400, code: "invalid_course", message: "Select an active course." });
    }

    const now = new Date().toISOString();
    const lookupHash = await mobileHash(c, normalizedMobile);
    let personId = parsed.data.existingPersonId || null;

    if (personId) {
      const existing = await c.env.DB.prepare(
        "select id from people where id = ? and organisation_id = ? and status != 'archived'",
      )
        .bind(personId, ORG_ID)
        .first();
      if (!existing) return jsonError(c, { status: 404, code: "person_not_found", message: "The selected person was not found." });
      await addMobileIfMissing(c, personId, normalizedMobile, lookupHash, now);
    } else {
      personId = createOpaqueId("person");
      await c.env.DB.prepare(
        `insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
        .bind(personId, ORG_ID, branch.id, parsed.data.fullName, parsed.data.fullName, now, now)
        .run();
      await addMobileIfMissing(c, personId, normalizedMobile, lookupHash, now, true);
    }

    const enquiryId = createOpaqueId("enq");
    const enquiryNumber = buildEnquiryNumber(branch.code, now);
    const statements = [
      c.env.DB.prepare(
        `insert into enquiries
           (id, organisation_id, branch_id, person_id, enquiry_number, mobile_used, course_interest_id,
            source, source_detail, counsellor_login_account_id, preferred_timing, preferred_joining_date,
            status, pipeline_stage, assigned_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'new', ?, ?, ?)`,
      ).bind(
        enquiryId,
        ORG_ID,
        branch.id,
        personId,
        enquiryNumber,
        lookupHash,
        parsed.data.courseInterestId || null,
        parsed.data.source,
        parsed.data.sourceDetail || null,
        staff.loginAccountId,
        parsed.data.preferredTiming || null,
        parsed.data.preferredJoiningDate || null,
        now,
        now,
        now,
      ),
    ];

    if (!parsed.data.courseInterestId && parsed.data.courseInterestText) {
      statements.push(
        c.env.DB.prepare(
          `insert into enquiry_course_interests (enquiry_id, course_interest_text, created_at, updated_at)
           values (?, ?, ?, ?)`,
        ).bind(enquiryId, parsed.data.courseInterestText, now, now),
      );
    }

    await c.env.DB.batch(statements);
    return jsonPlain(c, { success: true, enquiryId, enquiryNumber, personId }, { status: 201 });
  });
}

async function requireStaff(c: Parameters<typeof getSessionFromRequest>[0]) {
  return requireStaffRoles(c, ADMISSION_STAFF_ROLES);
}

export function normalizeIndianMobile(value: string) {
  return normalizeCanonicalIndianMobile(value);
}

function buildEnquiryNumber(branchCode: string, nowIso: string) {
  const year = nowIso.slice(0, 4);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `ENQ-${branchCode.toUpperCase()}-${year}-${suffix}`;
}
