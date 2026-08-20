import { z } from "zod";
import type { AppContext } from "./http";
import { ORG_ID } from "./auth-store";
import { createOpaqueId, decryptText } from "./crypto";
import type { StaffContext } from "./staff-auth";

export const PIPELINE_STAGES = ["new", "contacting", "engaged", "considering", "deferred", "admission_ready", "converted", "lost", "invalid", "duplicate"] as const;
export const ACTIVE_PIPELINE_STAGES = ["new", "contacting", "engaged", "considering", "deferred", "admission_ready"] as const;
export const LEAD_TEMPERATURES = ["hot_urgent", "hot", "warm", "cold"] as const;
export const FOLLOW_UP_CHANNELS = ["call", "whatsapp", "in_person", "email", "other"] as const;
export const FOLLOW_UP_OUTCOMES = [
  "call_connected",
  "call_no_answer",
  "call_busy",
  "whatsapp_sent",
  "whatsapp_replied",
  "whatsapp_no_response",
  "callback_requested",
  "course_details_shared",
  "fee_discussed",
  "batch_discussed",
  "visit_scheduled",
  "demo_scheduled",
  "demo_completed",
  "thinking",
  "deferred_joining",
  "not_interested",
  "joined_elsewhere",
  "invalid_contact",
  "other",
] as const;
export const LOST_REASONS = ["not_interested", "joined_elsewhere", "fee_budget_issue", "batch_timing_issue", "location_travel_issue", "course_not_suitable", "no_response", "postponed_indefinitely", "other"] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];
export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOMES)[number];
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];
export type LostReason = (typeof LOST_REASONS)[number];

const ACTIVE_STAGE_SET = new Set<string>(ACTIVE_PIPELINE_STAGES);
const TERMINAL_STAGE_SET = new Set<string>(["converted", "lost", "invalid", "duplicate"]);
const UNSUCCESSFUL_OUTCOMES = new Set<string>(["call_no_answer", "whatsapp_no_response"]);
const MEANINGFUL_OUTCOMES = new Set<string>([
  "call_connected",
  "whatsapp_replied",
  "callback_requested",
  "course_details_shared",
  "fee_discussed",
  "batch_discussed",
  "visit_scheduled",
  "demo_scheduled",
  "demo_completed",
  "thinking",
  "deferred_joining",
]);
const HOT_OUTCOMES = new Set<string>([
  "call_connected",
  "whatsapp_replied",
  "callback_requested",
  "course_details_shared",
  "fee_discussed",
  "batch_discussed",
  "visit_scheduled",
  "demo_scheduled",
  "thinking",
]);
const URGENT_SOURCE_VALUES = new Set(["referral", "student referral", "alumni referral", "walk-in"]);
const SYSTEM_ADMIN_ROLES = new Set(["owner", "admin", "system_admin"]);
const IST_TIME_ZONE = "Asia/Kolkata";
const COLD_MIN_ATTEMPTS = 10;
const COLD_MIN_ELAPSED_DAYS = 14;
const HOT_URGENT_SOURCE_WINDOW_DAYS = 1;
const HOT_SOURCE_WINDOW_DAYS = 7;
const HOT_OUTCOME_WINDOW_DAYS = 7;
const DEMO_COMPLETED_URGENT_WINDOW_DAYS = 7;
const DEMO_COMPLETED_HOT_WINDOW_DAYS = 30;
const NEAR_JOINING_WINDOW_DAYS = 7;
const ADMISSION_READY_OUTCOMES = new Set<string>(["fee_discussed", "batch_discussed", "visit_scheduled", "demo_completed"]);

export const followUpInputSchema = z.object({
  channel: z.enum(FOLLOW_UP_CHANNELS),
  outcome: z.enum(FOLLOW_UP_OUTCOMES),
  note: z.string().trim().max(1000).optional().nullable(),
  pipelineStage: z.enum(PIPELINE_STAGES),
  nextFollowUpAt: z.string().trim().max(40).optional().nullable(),
  expectedJoiningDate: z.string().trim().max(20).optional().nullable(),
  closedReason: z.enum(LOST_REASONS).optional().nullable(),
});

export const assignmentInputSchema = z.object({
  counsellorLoginAccountId: z.string().trim().min(1).max(160).nullable(),
});

export type EnquiryCrmRow = {
  id: string;
  organisation_id: string;
  branch_id: string;
  person_id: string | null;
  enquiry_number: string;
  mobile_used: string;
  course_interest_id: string | null;
  source: string;
  source_detail: string | null;
  counsellor_login_account_id: string | null;
  preferred_timing: string | null;
  preferred_joining_date: string | null;
  status: string;
  pipeline_stage: PipelineStage;
  next_follow_up_at: string | null;
  assigned_at: string | null;
  last_contacted_at: string | null;
  lost_reason: string | null;
  closed_reason: string | null;
  converted_enrolment_id: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
  full_name: string | null;
  official_full_name: string | null;
  course_name: string | null;
  course_interest_text: string | null;
  branch_name: string | null;
  branch_code: string | null;
  referral_id: string | null;
  referral_status: string | null;
  referrer_name: string | null;
  prospect_name: string | null;
  prospect_mobile_hash: string | null;
  prospect_mobile_ciphertext: string | null;
  prospect_mobile_last_four: string | null;
  referral_link_id: string | null;
  enrolment_id: string | null;
  enrolment_number: string | null;
  enrolment_status: string | null;
  fee_agreement_id: string | null;
  student_id: string | null;
  student_number: string | null;
  assigned_counsellor_display_name: string | null;
};

export type FollowUpEventRecord = {
  id: string;
  enquiry_id: string;
  organisation_id: string;
  branch_id: string;
  actor_login_account_id: string;
  channel: FollowUpChannel;
  outcome: FollowUpOutcome;
  note: string | null;
  occurred_at: string;
  next_follow_up_at_snapshot: string | null;
  pipeline_stage_snapshot: PipelineStage;
  created_at: string;
};

export type BranchScope = {
  canAccessAnyBranch: boolean;
  allBranches: boolean;
  branchIds: string[];
};

export type TemperatureResult = {
  leadTemperature: LeadTemperature | null;
  leadTemperatureReason: string;
};

export async function branchScope(c: AppContext, staff: StaffContext): Promise<BranchScope> {
  if (staff.roles.some((role) => SYSTEM_ADMIN_ROLES.has(role))) return { canAccessAnyBranch: true, allBranches: true, branchIds: [] };
  const rows = await c.env.DB.prepare(
    `select distinct login_account_roles.branch_id
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.code in ('owner', 'system_admin', 'admin', 'counsellor', 'admission_admin')`,
  )
    .bind(staff.loginAccountId)
    .all<{ branch_id: string | null }>();
  const hasGlobalStaffRole = (rows.results || []).some((row) => !row.branch_id);
  const branchIds = (rows.results || []).map((row) => row.branch_id).filter((value): value is string => Boolean(value));
  return { canAccessAnyBranch: hasGlobalStaffRole || branchIds.length > 0, allBranches: hasGlobalStaffRole, branchIds };
}

export function scopedWhere(scope: BranchScope, clauses: string[], params: Array<string | number | null>, tableAlias = "enquiries") {
  if (!scope.allBranches) {
    if (scope.branchIds.length === 0) clauses.push("1 = 0");
    else {
      clauses.push(`${tableAlias}.branch_id in (${scope.branchIds.map(() => "?").join(",")})`);
      params.push(...scope.branchIds);
    }
  }
  return { sql: `where ${clauses.join(" and ")}`, params };
}

export function mapStatusToPipelineStage(status: string): PipelineStage {
  if (status === "attempted_contact") return "contacting";
  if (["contacted", "demo_scheduled"].includes(status)) return "engaged";
  if (["follow_up", "counselling_completed", "interested"].includes(status)) return "considering";
  if (status === "admission_pending") return "admission_ready";
  if (status === "converted") return "converted";
  if (["not_interested", "lost"].includes(status)) return "lost";
  if (status === "duplicate") return "duplicate";
  if (status === "invalid") return "invalid";
  return "new";
}

export function legacyStatusForPipelineStage(stage: PipelineStage, outcome?: FollowUpOutcome): string {
  if (stage === "new") return "new";
  if (stage === "contacting") return "attempted_contact";
  if (stage === "engaged") return outcome === "demo_scheduled" ? "demo_scheduled" : "contacted";
  if (stage === "considering") return "interested";
  if (stage === "deferred") return "follow_up";
  if (stage === "admission_ready") return "admission_pending";
  if (stage === "lost") return outcome === "not_interested" ? "not_interested" : "lost";
  if (stage === "invalid") return "invalid";
  if (stage === "duplicate") return "duplicate";
  return "converted";
}

export function validatePipelineUpdate(input: {
  currentStage: PipelineStage;
  nextStage: PipelineStage;
  outcome?: FollowUpOutcome;
  nextFollowUpAt?: string | null;
  preferredJoiningDate?: string | null;
  closedReason?: LostReason | null;
  nowIso?: string;
}) {
  const nowIso = input.nowIso || new Date().toISOString();
  if (input.nextStage === "converted") return "Converted is admission-derived and cannot be set from follow-up.";
  if (input.currentStage === "converted") return "Converted enquiries cannot be edited.";
  if (TERMINAL_STAGE_SET.has(input.currentStage)) return "Terminal enquiries cannot be edited.";
  if (input.nextFollowUpAt && !isValidDateTime(input.nextFollowUpAt)) return "Next follow-up date/time is invalid.";
  if (input.nextFollowUpAt && !isQuarterHourInBranchTime(input.nextFollowUpAt)) return "Next follow-up must use 15-minute increments.";
  if (input.nextFollowUpAt && Date.parse(input.nextFollowUpAt) <= Date.parse(nowIso)) return "Next follow-up must be in the future.";
  if (input.preferredJoiningDate && !isValidDateOnly(input.preferredJoiningDate)) return "Expected joining date is invalid.";
  if (input.preferredJoiningDate && !hasFutureDate(input.preferredJoiningDate, nowIso)) return "Expected joining date cannot be in the past.";
  if (input.nextStage === "deferred" && (!input.preferredJoiningDate || !input.nextFollowUpAt)) {
    return "Deferred enquiries require expected joining and next follow-up dates.";
  }
  if (input.nextStage === "lost" && !input.closedReason) return "Lost enquiries require a closed reason.";
  if (["not_interested", "joined_elsewhere"].includes(input.outcome || "") && input.nextStage !== "lost") return "This outcome must close the enquiry as Lost.";
  if (input.outcome === "invalid_contact" && input.nextStage !== "invalid") return "Invalid contact must use the Invalid pipeline stage.";
  if (input.outcome === "deferred_joining" && input.nextStage !== "deferred") return "Deferred joining must use the Deferred pipeline stage.";
  if (input.nextStage === "admission_ready" && !ADMISSION_READY_OUTCOMES.has(input.outcome || "")) return "Admission-ready requires a high-intent follow-up outcome.";
  if (["invalid", "duplicate"].includes(input.nextStage) && input.closedReason) return "Invalid and duplicate are distinct terminal states and do not use lost reasons.";
  if (input.nextStage === "new" && input.currentStage !== "new") return "Only untouched enquiries may remain New.";
  return null;
}

export function calculateLeadTemperature(enquiry: Pick<EnquiryCrmRow, "pipeline_stage" | "source" | "created_at" | "preferred_joining_date" | "next_follow_up_at">, events: FollowUpEventRecord[], nowIso = new Date().toISOString()): TemperatureResult {
  if (!ACTIVE_STAGE_SET.has(enquiry.pipeline_stage)) {
    return { leadTemperature: null, leadTemperatureReason: "Terminal enquiry; no active lead temperature" };
  }
  if (enquiry.pipeline_stage === "admission_ready") {
    return { leadTemperature: "hot_urgent", leadTemperatureReason: "Admission ready" };
  }

  const now = Date.parse(nowIso);
  const orderedEvents = [...events].sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at));
  const cold = coldStreak(orderedEvents, nowIso);
  if (cold.isCold && !(enquiry.pipeline_stage === "deferred" && hasFutureDate(enquiry.preferred_joining_date, nowIso) && hasFutureDateTime(enquiry.next_follow_up_at, nowIso))) {
    return {
      leadTemperature: "cold",
      leadTemperatureReason: `${cold.count} consecutive unsuccessful attempts over ${cold.elapsedDays} days`,
    };
  }

  if (enquiry.pipeline_stage === "deferred" && hasFutureDate(enquiry.preferred_joining_date, nowIso)) {
    return { leadTemperature: "warm", leadTemperatureReason: `Deferred joining planned for ${formatMonth(enquiry.preferred_joining_date)}` };
  }

  const recentDemo = firstRecentOutcome(orderedEvents, "demo_completed", now, DEMO_COMPLETED_URGENT_WINDOW_DAYS);
  if (recentDemo) return { leadTemperature: "hot_urgent", leadTemperatureReason: `Demo completed ${relativeDays(recentDemo.occurred_at, nowIso)}` };

  if (joiningWithinDays(enquiry.preferred_joining_date, nowIso, NEAR_JOINING_WINDOW_DAYS)) {
    return { leadTemperature: "hot_urgent", leadTemperatureReason: `Expected joining is within ${NEAR_JOINING_WINDOW_DAYS} days` };
  }

  if (isUrgentSource(enquiry.source) && daysBetween(enquiry.created_at, nowIso) <= HOT_URGENT_SOURCE_WINDOW_DAYS && !cold.count) {
    return { leadTemperature: "hot_urgent", leadTemperatureReason: `${sourceLabel(enquiry.source)} enquiry received ${relativeDays(enquiry.created_at, nowIso)}` };
  }

  const recentHot = orderedEvents.find((event) => HOT_OUTCOMES.has(event.outcome) && daysBetween(event.occurred_at, nowIso) <= HOT_OUTCOME_WINDOW_DAYS);
  if (recentHot) return { leadTemperature: "hot", leadTemperatureReason: `${outcomeLabel(recentHot.outcome)} ${relativeDays(recentHot.occurred_at, nowIso)}` };

  const staleDemo = firstRecentOutcome(orderedEvents, "demo_completed", now, DEMO_COMPLETED_HOT_WINDOW_DAYS);
  if (staleDemo) return { leadTemperature: "hot", leadTemperatureReason: `Demo completed ${relativeDays(staleDemo.occurred_at, nowIso)}` };

  if (isUrgentSource(enquiry.source) && daysBetween(enquiry.created_at, nowIso) <= HOT_SOURCE_WINDOW_DAYS && cold.count < 3) {
    return { leadTemperature: "hot", leadTemperatureReason: `${sourceLabel(enquiry.source)} enquiry still recent` };
  }

  if (orderedEvents.some((event) => MEANINGFUL_OUTCOMES.has(event.outcome))) {
    return { leadTemperature: "warm", leadTemperatureReason: "Earlier engagement has cooled" };
  }
  return { leadTemperature: "warm", leadTemperatureReason: "New enquiry, no strong buying signal yet" };
}

export function coldStreak(events: FollowUpEventRecord[], nowIso = new Date().toISOString()) {
  const ordered = [...events].sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at));
  const streak: FollowUpEventRecord[] = [];
  for (const event of ordered) {
    if (MEANINGFUL_OUTCOMES.has(event.outcome)) break;
    if (UNSUCCESSFUL_OUTCOMES.has(event.outcome)) streak.push(event);
  }
  const oldest = streak.at(-1);
  const elapsedDays = oldest ? Math.floor(daysBetween(oldest.occurred_at, nowIso)) : 0;
  return { count: streak.length, elapsedDays, isCold: streak.length >= COLD_MIN_ATTEMPTS && elapsedDays >= COLD_MIN_ELAPSED_DAYS };
}

export async function contactForEnquiry(c: AppContext, enquiry: EnquiryCrmRow) {
  const mobile = enquiry.person_id ? await personPrimaryMobile(c, enquiry.person_id) : await referralProspectMobile(c, enquiry);
  return crmContactFromMobile(enquiry, mobile);
}

export async function contactsForEnquiries(c: AppContext, enquiries: EnquiryCrmRow[]) {
  const contacts = new Map<string, ReturnType<typeof emptyCrmContact>>();
  const personIds = [...new Set(enquiries.map((enquiry) => enquiry.person_id).filter((value): value is string => Boolean(value)))];
  const personContacts = personIds.length
    ? await c.env.DB.prepare(
        `select person_contacts.person_id, person_contacts.id, person_contact_secrets.value_ciphertext
         from person_contacts
         left join person_contact_details on person_contact_details.contact_id = person_contacts.id
         left join person_contact_secrets on person_contact_secrets.contact_id = person_contacts.id
         where person_contacts.person_id in (${personIds.map(() => "?").join(",")})
           and person_contacts.contact_type = 'mobile'
           and coalesce(person_contact_details.status, 'active') = 'active'
         order by person_contacts.person_id, person_contacts.is_primary desc, person_contacts.created_at desc`,
      )
        .bind(...personIds)
        .all<{ person_id: string; id: string; value_ciphertext: string | null }>()
    : { results: [] };
  const mobileByPerson = new Map<string, string>();
  for (const contact of personContacts.results || []) {
    if (mobileByPerson.has(contact.person_id) || !contact.value_ciphertext) continue;
    const mobile = await decryptText(c.env.SESSION_PEPPER, `contact:${contact.id}`, contact.value_ciphertext).catch(() => null);
    if (mobile) mobileByPerson.set(contact.person_id, mobile);
  }
  for (const enquiry of enquiries) {
    const mobile = enquiry.person_id ? mobileByPerson.get(enquiry.person_id) || null : await referralProspectMobile(c, enquiry);
    contacts.set(enquiry.id, crmContactFromMobile(enquiry, mobile));
  }
  return contacts;
}

function crmContactFromMobile(enquiry: EnquiryCrmRow, mobile: string | null) {
  if (!mobile) return { mobile: null, mobileDisplay: null, whatsappUrl: null, callUrl: null };
  const coursePhrase = enquiry.course_name || enquiry.course_interest_text || "course";
  const text = `Hi, this is Samyak Computer Classes, Sion. I'm following up on your ${coursePhrase} enquiry.`;
  return {
    mobile,
    mobileDisplay: formatIndianMobileDisplay(mobile),
    whatsappUrl: `https://wa.me/91${mobile}?text=${encodeURIComponent(text)}`,
    callUrl: `tel:+91${mobile}`,
  };
}

export async function fetchEventsForEnquiries(c: AppContext, enquiryIds: string[], limitPerEnquiry = 80) {
  const uniqueIds = [...new Set(enquiryIds)].filter(Boolean);
  if (!uniqueIds.length) return new Map<string, FollowUpEventRecord[]>();
  const rows = await c.env.DB.prepare(
    `select *
     from enquiry_follow_up_events
     where organisation_id = ?
       and enquiry_id in (${uniqueIds.map(() => "?").join(",")})
     order by enquiry_id, occurred_at desc`,
  )
    .bind(ORG_ID, ...uniqueIds)
    .all<FollowUpEventRecord>();
  const map = new Map<string, FollowUpEventRecord[]>();
  for (const row of rows.results || []) {
    const list = map.get(row.enquiry_id) || [];
    if (list.length < limitPerEnquiry) list.push(row);
    map.set(row.enquiry_id, list);
  }
  return map;
}

export async function assignEnquiry(c: AppContext, staff: StaffContext, enquiryId: string, assigneeId: string | null) {
  const enquiry = await scopedEnquiry(c, staff, enquiryId);
  if (!enquiry) return { ok: false as const, status: 404, code: "enquiry_not_found", message: "Enquiry was not found." };
  if (TERMINAL_STAGE_SET.has(enquiry.pipeline_stage)) return { ok: false as const, status: 409, code: "terminal_enquiry", message: "Terminal enquiries cannot be reassigned." };
  const canAdminAssign = staff.roles.some((role) => SYSTEM_ADMIN_ROLES.has(role));
  const selfClaim = !enquiry.counsellor_login_account_id && assigneeId === staff.loginAccountId && staff.roles.includes("counsellor");
  if (!canAdminAssign && !selfClaim) return { ok: false as const, status: 403, code: "assignment_forbidden", message: "You can only claim unassigned enquiries for yourself." };
  if (assigneeId) {
    const target = await c.env.DB.prepare(
      `select login_accounts.id
       from login_accounts
       join login_account_roles on login_account_roles.login_account_id = login_accounts.id
       join roles on roles.id = login_account_roles.role_id
       where login_accounts.id = ?
         and login_accounts.organisation_id = ?
         and login_accounts.status = 'active'
         and roles.code in ('owner', 'system_admin', 'admin', 'counsellor', 'admission_admin')
         and (login_account_roles.branch_id is null or login_account_roles.branch_id = ?)
       limit 1`,
    )
      .bind(assigneeId, ORG_ID, enquiry.branch_id)
      .first<{ id: string }>();
    if (!target) return { ok: false as const, status: 400, code: "invalid_assignee", message: "Select an active staff member for this branch." };
  }
  const now = new Date().toISOString();
  if (selfClaim) {
    const result = await c.env.DB.prepare("update enquiries set counsellor_login_account_id = ?, assigned_at = ?, updated_at = ? where id = ? and organisation_id = ? and counsellor_login_account_id is null")
      .bind(assigneeId, now, now, enquiry.id, ORG_ID)
      .run();
    if (!changed(result)) return { ok: false as const, status: 409, code: "assignment_taken", message: "This enquiry has already been claimed." };
    await auditStatement(c, staff, enquiry.branch_id, "enquiry_assigned", "enquiry", enquiry.id, { from: null, to: assigneeId }).run();
  } else {
    await c.env.DB.batch([
      c.env.DB.prepare("update enquiries set counsellor_login_account_id = ?, assigned_at = ?, updated_at = ? where id = ? and organisation_id = ?")
        .bind(assigneeId, assigneeId ? now : null, now, enquiry.id, ORG_ID),
      auditStatement(c, staff, enquiry.branch_id, "enquiry_assigned", "enquiry", enquiry.id, { from: enquiry.counsellor_login_account_id, to: assigneeId }),
    ]);
  }
  return { ok: true as const, enquiryId: enquiry.id, assignedTo: assigneeId };
}

export async function recordFollowUp(c: AppContext, staff: StaffContext, enquiryId: string, input: z.infer<typeof followUpInputSchema>) {
  const enquiry = await scopedEnquiry(c, staff, enquiryId);
  if (!enquiry) return { ok: false as const, status: 404, code: "enquiry_not_found", message: "Enquiry was not found." };
  const preferredJoiningDate = input.expectedJoiningDate || enquiry.preferred_joining_date || null;
  const validation = validatePipelineUpdate({
    currentStage: enquiry.pipeline_stage,
    nextStage: input.pipelineStage,
    outcome: input.outcome,
    nextFollowUpAt: input.nextFollowUpAt || null,
    preferredJoiningDate,
    closedReason: input.closedReason || null,
  });
  if (validation) return { ok: false as const, status: 400, code: "invalid_pipeline", message: validation };

  const now = new Date().toISOString();
  const terminal = TERMINAL_STAGE_SET.has(input.pipelineStage);
  const lastContactedAt = contactAttemptAt(input.outcome) ? now : enquiry.last_contacted_at;
  const status = legacyStatusForPipelineStage(input.pipelineStage, input.outcome);
  const closedReason = input.pipelineStage === "lost" ? input.closedReason || null : null;
  const lostReason = input.pipelineStage === "lost" ? input.closedReason || input.outcome : null;
  const nextFollowUpAt = terminal ? null : input.nextFollowUpAt || null;
  const eventId = createOpaqueId("enqevt");
  await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into enquiry_follow_up_events
        (id, enquiry_id, organisation_id, branch_id, actor_login_account_id, channel, outcome, note, occurred_at,
         next_follow_up_at_snapshot, pipeline_stage_snapshot, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(eventId, enquiry.id, ORG_ID, enquiry.branch_id, staff.loginAccountId, input.channel, input.outcome, safeNote(input.note), now, nextFollowUpAt, input.pipelineStage, now),
    c.env.DB.prepare(
      `update enquiries
       set pipeline_stage = ?,
           status = ?,
           next_follow_up_at = ?,
           last_contacted_at = ?,
           preferred_joining_date = ?,
           lost_reason = ?,
           closed_reason = ?,
           updated_at = ?
       where id = ? and organisation_id = ?`,
    ).bind(input.pipelineStage, status, nextFollowUpAt, lastContactedAt, preferredJoiningDate, lostReason, closedReason, now, enquiry.id, ORG_ID),
    auditStatement(c, staff, enquiry.branch_id, "enquiry_follow_up_recorded", "enquiry", enquiry.id, {
      channel: input.channel,
      outcome: input.outcome,
      pipelineStage: input.pipelineStage,
    }),
  ]);
  const refreshed = await getEnquiryById(c, enquiry.id);
  const events = refreshed ? (await fetchEventsForEnquiries(c, [refreshed.id])).get(refreshed.id) || [] : [];
  return {
    ok: true as const,
    enquiryId: enquiry.id,
    eventId,
    leadTemperature: refreshed ? calculateLeadTemperature(refreshed, events).leadTemperature : null,
    leadTemperatureReason: refreshed ? calculateLeadTemperature(refreshed, events).leadTemperatureReason : "",
  };
}

export async function scopedEnquiry(c: AppContext, staff: StaffContext, enquiryId: string) {
  const scope = await branchScope(c, staff);
  if (!scope.canAccessAnyBranch) return null;
  const where = scopedWhere(scope, ["enquiries.id = ?", "enquiries.organisation_id = ?"], [enquiryId, ORG_ID]);
  return c.env.DB.prepare(`${enquirySelectSql()} ${where.sql} limit 1`).bind(...where.params).first<EnquiryCrmRow>();
}

export function enquirySelectSql() {
  return `select
    enquiries.*,
    coalesce(person_identity_details.official_full_name, people.public_name, people.full_name, referrals.prospect_name) as full_name,
    person_identity_details.official_full_name,
    courses.name as course_name,
    enquiry_course_interests.course_interest_text,
    branches.name as branch_name,
    branches.code as branch_code,
    referrals.id as referral_id,
    referrals.status as referral_status,
    referrer_people.full_name as referrer_name,
    referrals.prospect_name,
    referrals.prospect_mobile_hash,
    referrals.prospect_mobile_ciphertext,
    referrals.prospect_mobile_last_four,
    referrals.referral_link_id,
    enrolments.id as enrolment_id,
    enrolments.enrolment_number,
    enrolments.status as enrolment_status,
    fee_agreements.id as fee_agreement_id,
    students.id as student_id,
    students.student_number,
    coalesce(assigned_people.public_name, assigned_people.full_name) as assigned_counsellor_display_name
   from enquiries
   left join people on people.id = enquiries.person_id
   left join person_identity_details on person_identity_details.person_id = people.id
   left join branches on branches.id = enquiries.branch_id
   left join courses on courses.id = enquiries.course_interest_id
   left join enquiry_course_interests on enquiry_course_interests.enquiry_id = enquiries.id
   left join referrals on referrals.enquiry_id = enquiries.id
   left join referrer_profiles on referrer_profiles.id = referrals.referrer_profile_id
   left join people referrer_people on referrer_people.id = referrer_profiles.person_id
   left join enrolments on enrolments.id = enquiries.converted_enrolment_id and enrolments.enquiry_id = enquiries.id
   left join fee_agreements on fee_agreements.enrolment_id = enrolments.id and fee_agreements.status = 'active'
   left join students on students.id = enrolments.student_id and students.organisation_id = enquiries.organisation_id
   left join login_accounts assigned_accounts on assigned_accounts.id = enquiries.counsellor_login_account_id
   left join login_account_people assigned_account_people on assigned_account_people.login_account_id = assigned_accounts.id and assigned_account_people.is_default = 1
   left join people assigned_people on assigned_people.id = assigned_account_people.person_id`;
}

export async function getEnquiryById(c: AppContext, enquiryId: string) {
  return c.env.DB.prepare(`${enquirySelectSql()} where enquiries.id = ? and enquiries.organisation_id = ? limit 1`)
    .bind(enquiryId, ORG_ID)
    .first<EnquiryCrmRow>();
}

export async function staffForBranch(c: AppContext, branchId: string) {
  const rows = await c.env.DB.prepare(
    `select distinct login_accounts.id, coalesce(people.public_name, people.full_name, 'Unknown staff') as label
     from login_accounts
     join login_account_roles on login_account_roles.login_account_id = login_accounts.id
     join roles on roles.id = login_account_roles.role_id
     left join login_account_people on login_account_people.login_account_id = login_accounts.id and login_account_people.is_default = 1
     left join people on people.id = login_account_people.person_id
     where login_accounts.organisation_id = ?
       and login_accounts.status = 'active'
       and roles.code in ('owner', 'system_admin', 'admin', 'counsellor', 'admission_admin')
       and (login_account_roles.branch_id is null or login_account_roles.branch_id = ?)
     order by label`,
  )
    .bind(ORG_ID, branchId)
    .all<{ id: string; label: string }>();
  return rows.results || [];
}

export function isActiveStage(stage: string) {
  return ACTIVE_STAGE_SET.has(stage);
}

export function isTerminalStage(stage: string) {
  return TERMINAL_STAGE_SET.has(stage);
}

function contactAttemptAt(outcome: FollowUpOutcome) {
  return !["other"].includes(outcome);
}

function safeNote(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
}

async function personPrimaryMobile(c: AppContext, personId: string) {
  const row = await c.env.DB.prepare(
    `select person_contacts.id, person_contact_secrets.value_ciphertext
     from person_contacts
     left join person_contact_details on person_contact_details.contact_id = person_contacts.id
     left join person_contact_secrets on person_contact_secrets.contact_id = person_contacts.id
     where person_contacts.person_id = ?
       and person_contacts.contact_type = 'mobile'
       and coalesce(person_contact_details.status, 'active') = 'active'
     order by person_contacts.is_primary desc, person_contacts.created_at desc
     limit 1`,
  )
    .bind(personId)
    .first<{ id: string; value_ciphertext: string | null }>();
  if (!row?.value_ciphertext) return null;
  return decryptText(c.env.SESSION_PEPPER, `contact:${row.id}`, row.value_ciphertext).catch(() => null);
}

async function referralProspectMobile(c: AppContext, enquiry: EnquiryCrmRow) {
  if (!enquiry.referral_link_id || !enquiry.prospect_mobile_hash || !enquiry.prospect_mobile_ciphertext) return null;
  return decryptText(c.env.SESSION_PEPPER, `referral-mobile:${enquiry.referral_link_id}:${enquiry.prospect_mobile_hash}`, enquiry.prospect_mobile_ciphertext).catch(() => null);
}

function emptyCrmContact() {
  return { mobile: null as string | null, mobileDisplay: null as string | null, whatsappUrl: null as string | null, callUrl: null as string | null };
}

function auditStatement(c: AppContext, staff: StaffContext, branchId: string | null, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  return c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(createOpaqueId("audit"), ORG_ID, branchId, staff.loginAccountId, staff.activePersonId, action, entityType, entityId, JSON.stringify(metadata), new Date().toISOString());
}

function isUrgentSource(source: string) {
  return URGENT_SOURCE_VALUES.has(source.trim().toLowerCase());
}

function sourceLabel(source: string) {
  return source.trim().toLowerCase() === "referral" ? "Referral" : source;
}

function firstRecentOutcome(events: FollowUpEventRecord[], outcome: FollowUpOutcome, now: number, maxDays: number) {
  return events.find((event) => event.outcome === outcome && (now - Date.parse(event.occurred_at)) / 86400000 <= maxDays);
}

function daysBetween(fromIso: string, toIso: string) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (to - from) / 86400000);
}

function relativeDays(fromIso: string, toIso: string) {
  const days = Math.floor(daysBetween(fromIso, toIso));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function joiningWithinDays(dateValue: string | null, nowIso: string, days: number) {
  if (!dateValue) return false;
  const nowDate = localDateKey(nowIso);
  const target = dateValue.slice(0, 10);
  const diff = (Date.parse(`${target}T00:00:00.000Z`) - Date.parse(`${nowDate}T00:00:00.000Z`)) / 86400000;
  return diff >= 0 && diff <= days;
}

function hasFutureDate(dateValue: string | null, nowIso: string) {
  if (!dateValue) return false;
  return Date.parse(`${dateValue.slice(0, 10)}T23:59:59.999Z`) >= Date.parse(`${localDateKey(nowIso)}T00:00:00.000Z`);
}

function hasFutureDateTime(dateValue: string | null, nowIso: string) {
  if (!dateValue) return false;
  return Date.parse(dateValue) >= Date.parse(nowIso);
}

function isValidDateTime(value: string) {
  return Number.isFinite(Date.parse(value));
}

function isQuarterHourInBranchTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) return false;
  const minute = Number(new Intl.DateTimeFormat("en-GB", { timeZone: IST_TIME_ZONE, minute: "2-digit" }).format(date));
  return [0, 15, 30, 45].includes(minute);
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && value === date.toISOString().slice(0, 10);
}

function localDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function formatMonth(dateValue: string | null) {
  if (!dateValue) return "a future date";
  const date = new Date(`${dateValue.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? dateValue : date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function outcomeLabel(outcome: FollowUpOutcome) {
  return outcome.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatIndianMobileDisplay(mobile: string) {
  return mobile.length === 10 ? `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}` : mobile;
}

function changed(result: { meta?: { changes?: number; rows_written?: number } }) {
  return Number(result.meta?.changes ?? result.meta?.rows_written ?? 0) > 0;
}
