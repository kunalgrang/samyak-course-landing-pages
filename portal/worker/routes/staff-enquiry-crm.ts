import { z } from "zod";
import type { Context, Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { ORG_ID, mobileHash } from "../lib/auth-store";
import { isResponse, readJsonBody, requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { normalizeIndianMobile } from "../lib/mobile";
import { ADMISSION_STAFF_ROLES, requireStaffRoles } from "../lib/staff-auth";
import {
  LEAD_TEMPERATURES,
  PIPELINE_STAGES,
  assignEnquiry,
  assignmentInputSchema,
  branchScope,
  calculateLeadTemperature,
  contactForEnquiry,
  contactsForEnquiries,
  enquirySelectSql,
  fetchEventsForEnquiries,
  followUpInputSchema,
  isActiveStage,
  recordFollowUp,
  scopedEnquiry,
  scopedWhere,
  staffForBranch,
  type EnquiryCrmRow,
  type LeadTemperature,
  type PipelineStage,
} from "../lib/enquiry-crm";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;
type PortalContext = Context<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const queueSchema = z.enum(["hot_urgent", "hot", "warm", "cold", "today", "overdue", "new", "upcoming", "considering", "deferred", "admission_ready", "unassigned", "all"]).default("hot");
const CRM_LIMIT_MAX = 50;
const IST_TIME_ZONE = "Asia/Kolkata";

export function registerStaffEnquiryCrmRoutes(app: PortalHono) {
  app.get("/api/staff/enquiries/crm", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const scope = await branchScope(c, staff);
    if (!scope.canAccessAnyBranch) return jsonPlain(c, crmListPayload([], 0, listPagination(c), {}));

    const filters = await listFilters(c, staff.loginAccountId);
    const pagination = listPagination(c);
    const rows = await crmRows(c, scope, filters);
    const eventsByEnquiry = await fetchEventsForEnquiries(c, rows.map((row) => row.id));
    const now = new Date().toISOString();
    const enriched = [];
    for (const row of rows) {
      const events = eventsByEnquiry.get(row.id) || [];
      const temperature = calculateLeadTemperature(row, events, now);
      if (!matchesTemperatureFilter(filters, temperature.leadTemperature)) continue;
      if (!matchesQueue(row, temperature.leadTemperature, filters.queue, events, now)) continue;
      enriched.push({ row, temperature, eventCount: events.length });
    }
    enriched.sort((left, right) => comparePriority(now)(
      toCrmListItem(left.row, left.temperature, left.eventCount, emptyContact()),
      toCrmListItem(right.row, right.temperature, right.eventCount, emptyContact()),
    ));
    const page = enriched.slice(pagination.offset, pagination.offset + pagination.limit);
    const contactsByEnquiry = await contactsForEnquiries(c, page.map((item) => item.row));
    return jsonPlain(c, crmListPayload(page.map((item) => toCrmListItem(item.row, item.temperature, item.eventCount, contactsByEnquiry.get(item.row.id) || emptyContact())), enriched.length, pagination, filters));
  });

  app.post("/api/staff/enquiries/:enquiryId/follow-ups", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const body = await readJsonBody(c, followUpInputSchema);
    if (isResponse(body)) return body;
    const result = await recordFollowUp(c, staff, c.req.param("enquiryId"), body);
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message });
    return jsonPlain(c, { success: true, ...result }, { status: 201 });
  });

  app.patch("/api/staff/enquiries/:enquiryId/assignment", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const body = await readJsonBody(c, assignmentInputSchema);
    if (isResponse(body)) return body;
    const result = await assignEnquiry(c, staff, c.req.param("enquiryId"), body.counsellorLoginAccountId);
    if (!result.ok) return jsonError(c, { status: result.status as 400, code: result.code, message: result.message });
    return jsonPlain(c, { success: true, ...result });
  });

  app.get("/api/staff/enquiries/:enquiryId/crm", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const enquiry = await scopedEnquiry(c, staff, c.req.param("enquiryId"));
    if (!enquiry) return jsonError(c, { status: 404, code: "enquiry_not_found", message: "Enquiry was not found." });
    const events = (await fetchEventsForEnquiries(c, [enquiry.id], 200)).get(enquiry.id) || [];
    const temperature = calculateLeadTemperature(enquiry, events);
    return jsonPlain(c, {
      success: true,
      crm: toCrmListItem(enquiry, temperature, events.length, await contactForEnquiry(c, enquiry)),
      timeline: events.map((event) => ({
        id: event.id,
        channel: event.channel,
        outcome: event.outcome,
        note: event.note,
        occurredAt: event.occurred_at,
        nextFollowUpAtSnapshot: event.next_follow_up_at_snapshot,
        pipelineStageSnapshot: event.pipeline_stage_snapshot,
        actorLoginAccountId: event.actor_login_account_id,
      })),
      assignees: await staffForBranch(c, enquiry.branch_id),
    });
  });
}

type ListFilters = Awaited<ReturnType<typeof listFilters>>;

async function crmRows(c: Parameters<typeof branchScope>[0], scope: Awaited<ReturnType<typeof branchScope>>, filters: ListFilters) {
  const clauses = ["enquiries.organisation_id = ?"];
  const params: Array<string | number | null> = [ORG_ID];
  if (filters.stage) push(clauses, params, "enquiries.pipeline_stage = ?", filters.stage);
  if (filters.source) push(clauses, params, "enquiries.source = ?", filters.source);
  if (filters.courseId) push(clauses, params, "enquiries.course_interest_id = ?", filters.courseId);
  if (filters.assignedTo === "me") push(clauses, params, "enquiries.counsellor_login_account_id = ?", filters.staffLoginAccountId);
  else if (filters.assignedTo) push(clauses, params, "enquiries.counsellor_login_account_id = ?", filters.assignedTo);
  if (filters.fromDate) push(clauses, params, "enquiries.created_at >= ?", `${filters.fromDate}T00:00:00.000Z`);
  if (filters.toDate) push(clauses, params, "enquiries.created_at <= ?", `${filters.toDate}T23:59:59.999Z`);
  if (filters.search) {
    const q = `%${filters.search}%`;
    const searchClauses = [
      "enquiries.enquiry_number like ?",
      "people.full_name like ?",
      "people.public_name like ?",
      "person_identity_details.official_full_name like ?",
      "referrals.prospect_name like ?",
      "courses.name like ?",
      "enquiry_course_interests.course_interest_text like ?",
      "students.student_number like ?",
      "enrolments.enrolment_number like ?",
    ];
    params.push(q, q, q, q, q, q, q, q, q);
    if (filters.searchMobileHash) {
      searchClauses.push(
        "enquiries.mobile_used = ?",
        "exists (select 1 from person_contacts where person_contacts.person_id = people.id and person_contacts.contact_type = 'mobile' and person_contacts.normalized_value = ?)",
        "referrals.prospect_mobile_hash = ?",
      );
      params.push(filters.searchMobileHash, filters.searchMobileHash, filters.searchMobileHash);
    }
    clauses.push(`(${searchClauses.join(" or ")})`);
  }
  applyQueueSqlFilters(filters.queue, clauses);
  const where = scopedWhere(scope, clauses, params, "enquiries");
  const rows = await c.env.DB.prepare(
    `${enquirySelectSql()}
     ${where.sql}
     order by
       case when enquiries.next_follow_up_at is null then 1 else 0 end,
       enquiries.next_follow_up_at asc,
       enquiries.created_at asc`,
  )
    .bind(...where.params)
    .all<EnquiryCrmRow>();
  return rows.results || [];
}

function applyQueueSqlFilters(queue: string, clauses: string[]) {
  if (queue === "new") clauses.push("enquiries.pipeline_stage = 'new' and not exists (select 1 from enquiry_follow_up_events where enquiry_follow_up_events.enquiry_id = enquiries.id)");
  if (queue === "unassigned") clauses.push("enquiries.counsellor_login_account_id is null and enquiries.pipeline_stage in ('new', 'contacting', 'engaged', 'considering', 'deferred', 'admission_ready')");
  if (["considering", "deferred", "admission_ready"].includes(queue)) clauses.push(`enquiries.pipeline_stage = '${queue}'`);
  if (queue === "today") clauses.push("enquiries.pipeline_stage in ('new', 'contacting', 'engaged', 'considering', 'deferred', 'admission_ready') and enquiries.next_follow_up_at is not null");
  if (queue === "overdue") clauses.push("enquiries.pipeline_stage in ('new', 'contacting', 'engaged', 'considering', 'deferred', 'admission_ready') and enquiries.next_follow_up_at is not null");
  if (queue === "upcoming") clauses.push("enquiries.pipeline_stage in ('new', 'contacting', 'engaged', 'considering', 'deferred', 'admission_ready') and enquiries.next_follow_up_at is not null");
}

function toCrmListItem(row: EnquiryCrmRow, temperature: { leadTemperature: LeadTemperature | null; leadTemperatureReason: string }, eventCount: number, contact: ReturnType<typeof emptyContact>) {
  const authorizedConvertedEnrolmentId = row.converted_enrolment_id && row.enrolment_id === row.converted_enrolment_id ? row.converted_enrolment_id : null;
  return {
    enquiry: {
      id: row.id,
      enquiryNumber: row.enquiry_number,
      status: row.status,
      pipelineStage: row.pipeline_stage,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    prospect: {
      displayName: row.full_name || "Prospect not recorded",
    },
    contact,
    prospectContact: contact,
    course: {
      id: row.course_interest_id,
      name: row.course_name || row.course_interest_text || "Course not recorded",
    },
    source: row.source,
    sourceDetail: row.source_detail,
    referral: row.referral_id ? { id: row.referral_id, status: row.referral_status, referrerName: row.referrer_name } : null,
    pipelineStage: row.pipeline_stage,
    leadTemperature: temperature.leadTemperature,
    leadTemperatureReason: temperature.leadTemperatureReason,
    assignedCounsellor: row.counsellor_login_account_id
      ? { accountId: row.counsellor_login_account_id, displayName: row.assigned_counsellor_display_name || "Unknown staff" }
      : null,
    assignedCounsellorLoginAccountId: row.counsellor_login_account_id,
    assignedAt: row.assigned_at,
    lastContactedAt: row.last_contacted_at,
    nextFollowUpAt: row.next_follow_up_at,
    expectedJoiningDate: row.preferred_joining_date,
    branch: { id: row.branch_id, name: row.branch_name, code: row.branch_code },
    admission: {
      convertedEnrolmentId: authorizedConvertedEnrolmentId,
      convertedAt: row.converted_at,
      enrolmentId: row.enrolment_id,
      enrolmentNumber: row.enrolment_number,
      enrolmentStatus: row.enrolment_status,
      studentId: row.student_id,
      studentNumber: row.student_number,
      paymentLedgerAvailable: Boolean(authorizedConvertedEnrolmentId && row.student_id && row.fee_agreement_id),
    },
    closedReason: row.closed_reason,
    followUpEventCount: eventCount,
  };
}

function matchesTemperatureFilter(filters: ListFilters, temperature: LeadTemperature | null) {
  return !filters.leadTemperature || temperature === filters.leadTemperature;
}

export function matchesQueue(row: EnquiryCrmRow, temperature: LeadTemperature | null, queue: string, events: unknown[], nowIso: string) {
  if (queue === "hot") return temperature === "hot_urgent" || temperature === "hot";
  if (["hot_urgent", "warm", "cold"].includes(queue)) return temperature === queue;
  if (queue === "today") return isActiveStage(row.pipeline_stage) && isToday(row.next_follow_up_at, nowIso);
  if (queue === "overdue") return isActiveStage(row.pipeline_stage) && Boolean(row.next_follow_up_at) && Date.parse(row.next_follow_up_at!) < Date.parse(nowIso);
  if (queue === "upcoming") return isActiveStage(row.pipeline_stage) && Boolean(row.next_follow_up_at) && Date.parse(row.next_follow_up_at!) > Date.parse(nowIso) && !isToday(row.next_follow_up_at, nowIso);
  if (queue === "new") return row.pipeline_stage === "new" && events.length === 0;
  return true;
}

function emptyContact() {
  return { mobile: null as string | null, mobileDisplay: null as string | null, whatsappUrl: null as string | null, callUrl: null as string | null };
}

function comparePriority(nowIso: string) {
  const rank = { hot_urgent: 0, hot: 2, warm: 4, cold: 8, none: 9 } as const;
  return (left: ReturnType<typeof toCrmListItem>, right: ReturnType<typeof toCrmListItem>) => {
    const leftTemp = left.leadTemperature || "none";
    const rightTemp = right.leadTemperature || "none";
    const leftDue = dueRank(left.nextFollowUpAt, nowIso);
    const rightDue = dueRank(right.nextFollowUpAt, nowIso);
    const leftRank = (rank[leftTemp] ?? 9) + leftDue;
    const rightRank = (rank[rightTemp] ?? 9) + rightDue;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return Date.parse(left.nextFollowUpAt || left.enquiry.createdAt) - Date.parse(right.nextFollowUpAt || right.enquiry.createdAt);
  };
}

function dueRank(value: string | null, nowIso: string) {
  if (!value) return 3;
  if (Date.parse(value) < Date.parse(nowIso)) return 0;
  if (isToday(value, nowIso)) return 1;
  return 2;
}

async function listFilters(c: PortalContext, staffLoginAccountId: string) {
  const url = new URL(c.req.url);
  const queue = queueSchema.catch("hot").parse(url.searchParams.get("queue") || "hot");
  const stageValue = url.searchParams.get("stage");
  const leadTemperatureValue = url.searchParams.get("leadTemperature");
  const search = clean(url.searchParams.get("search"));
  const normalizedSearchMobile = search ? normalizeIndianMobile(search) : null;
  return {
    queue,
    stage: PIPELINE_STAGES.includes(stageValue as PipelineStage) ? (stageValue as PipelineStage) : null,
    leadTemperature: LEAD_TEMPERATURES.includes(leadTemperatureValue as LeadTemperature) ? (leadTemperatureValue as LeadTemperature) : null,
    source: clean(url.searchParams.get("source")),
    courseId: clean(url.searchParams.get("courseId")),
    assignedTo: clean(url.searchParams.get("assignedTo")),
    fromDate: dateParam(url.searchParams.get("fromDate")),
    toDate: dateParam(url.searchParams.get("toDate")),
    search,
    searchMobileHash: normalizedSearchMobile ? await mobileHash(c, normalizedSearchMobile) : null,
    staffLoginAccountId,
  };
}

function listPagination(c: PortalContext) {
  const url = new URL(c.req.url);
  return {
    limit: clampInteger(url.searchParams.get("limit"), 20, 1, CRM_LIMIT_MAX),
    offset: clampInteger(url.searchParams.get("offset"), 0, 0, 5000),
  };
}

function crmListPayload(items: unknown[], total: number, pagination: { limit: number; offset: number }, filters: Record<string, unknown>) {
  return {
    success: true,
    filters,
    pagination: {
      ...pagination,
      total,
      hasMore: pagination.offset + pagination.limit < total,
    },
    queues: ["hot", "hot_urgent", "warm", "cold", "today", "overdue", "new", "upcoming", "considering", "deferred", "admission_ready", "unassigned", "all"],
    items,
  };
}

function push(clauses: string[], params: Array<string | number | null>, clause: string, value: string | number | null) {
  clauses.push(clause);
  params.push(value);
}

function clean(value: string | null) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function dateParam(value: string | null) {
  const trimmed = clean(value);
  return trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isToday(value: string | null, nowIso: string) {
  return Boolean(value) && localDateKey(value!) === localDateKey(nowIso);
}

function localDateKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function forbidden(c: PortalContext) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });
}
