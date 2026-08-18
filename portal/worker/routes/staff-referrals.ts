import { z } from "zod";
import type { Context, Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { ORG_ID } from "../lib/auth-store";
import { createOpaqueId, decryptText } from "../lib/crypto";
import { requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { normalizeIndianMobile } from "../lib/mobile";
import { ADMISSION_STAFF_ROLES, requireStaffRoles, type StaffContext } from "../lib/staff-auth";
import {
  REFERRAL_STATUSES,
  assertReferralStatusTransition,
  calculateMinimumQualifyingPaymentPaise,
  type ReferralStatus,
} from "../lib/referral-domain";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

type PortalContext = Context<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const MAX_STATUS_BODY_BYTES = 2048;

const statusSchema = z.object({
  status: z.enum(REFERRAL_STATUSES),
  note: z.string().trim().max(500).optional(),
});

type ReferralListRow = {
  referral_id: string;
  referral_link_id: string | null;
  branch_id: string;
  branch_name: string | null;
  submitted_at: string;
  valid_until: string;
  status: ReferralStatus;
  updated_at: string;
  prospect_name: string;
  prospect_mobile_hash: string | null;
  prospect_mobile_ciphertext: string | null;
  prospect_contact_id: string | null;
  prospect_contact_ciphertext: string | null;
  referrer_name: string | null;
  referrer_public_name: string | null;
  referrer_type: string | null;
  course_name: string | null;
  enquiry_id: string | null;
  enquiry_number: string | null;
  enquiry_status: string | null;
  enrolment_id: string | null;
  enrolment_number: string | null;
  enrolment_status: string | null;
  enrolment_admission_date: string | null;
  final_agreed_fee_paise: number | null;
  minimum_fee_percentage: number | null;
  reward_snapshot_id: string | null;
  cash_reward_paise: number | null;
  course_credit_paise: number | null;
  slab_id: string | null;
};

type ReferralDetailRow = ReferralListRow & {
  referral_programme_name: string;
  validity_days: number;
  external_referrer_id: string | null;
  prospect_person_id: string | null;
  person_name: string | null;
  fee_agreement_id: string | null;
  payment_plan_type: string | null;
  minimum_qualifying_payment_paise: number | null;
  snapshot_json: string | null;
};

export function registerStaffReferralRoutes(app: PortalHono) {
  app.get("/api/staff/referrals", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);

    const scope = await branchScope(c, staff);
    if (!scope.canAccessAnyBranch) return jsonPlain(c, emptyListPayload(listPagination(c)));

    const filters = listFilters(c);
    const pagination = listPagination(c);
    const where = await listWhere(c, scope, filters);
    const rows = await c.env.DB.prepare(
      `${listSelectSql()}
       ${where.sql}
       order by referrals.submitted_at desc, referrals.id desc
       limit ? offset ?`,
    )
      .bind(...where.params, pagination.limit + 1, pagination.offset)
      .all<ReferralListRow>();

    const total = await c.env.DB.prepare(`select count(distinct referrals.id) as count ${listFromSql()} ${where.sql}`)
      .bind(...where.params)
      .first<{ count: number }>();

    const pageRows = (rows.results || []).slice(0, pagination.limit);
    return jsonPlain(c, {
      success: true,
      summary: summarize(pageRows),
      pagination: {
        ...pagination,
        total: Number(total?.count || 0),
        hasMore: (rows.results || []).length > pagination.limit,
      },
      filters,
      referrals: await Promise.all(pageRows.map((row) => toListItem(c, row))),
    });
  });

  app.get("/api/staff/referrals/:referralId", async (c) => {
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const detail = await referralDetail(c, staff, c.req.param("referralId"));
    if (!detail) return jsonError(c, { status: 404, code: "referral_not_found", message: "Referral was not found." });
    return jsonPlain(c, detail);
  });

  app.post("/api/staff/referrals/:referralId/status", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ADMISSION_STAFF_ROLES);
    if (!staff) return forbidden(c);
    const contentType = c.req.header("Content-Type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) return jsonError(c, { status: 415, code: "json_required", message: "Only JSON requests are accepted." });
    const bodyText = await c.req.raw.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_STATUS_BODY_BYTES) {
      return jsonError(c, { status: 413, code: "request_too_large", message: "Please shorten the status note." });
    }
    const parsed = statusSchema.safeParse(safeJson(bodyText));
    if (!parsed.success) return jsonError(c, { status: 400, code: "invalid_status", message: "Select a valid referral status." });

    const existing = await scopedReferral(c, staff, c.req.param("referralId"));
    if (!existing) return jsonError(c, { status: 404, code: "referral_not_found", message: "Referral was not found." });
    if (existing.status === parsed.data.status) return jsonPlain(c, { success: true, referralId: existing.id, status: existing.status, idempotent: true });

    try {
      assertReferralStatusTransition(existing.status, parsed.data.status);
    } catch {
      return jsonError(c, { status: 409, code: "invalid_transition", message: "This referral cannot move to that status." });
    }

    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare("update referrals set status = ?, updated_at = ?, closed_at = case when ? in ('closed', 'cancelled', 'rejected') then coalesce(closed_at, ?) else closed_at end, expired_at = case when ? = 'expired' then coalesce(expired_at, ?) else expired_at end where id = ? and organisation_id = ?")
        .bind(parsed.data.status, now, parsed.data.status, now, parsed.data.status, now, existing.id, ORG_ID),
      c.env.DB.prepare(
        `insert into referral_status_events
          (id, referral_id, from_status, to_status, event_type, actor_login_account_id, actor_person_id,
           system_actor, reason_code, public_note, internal_note, metadata_json, created_at)
         values (?, ?, ?, ?, 'staff_status_transition', ?, ?, null, null, null, ?, ?, ?)`,
      )
        .bind(createOpaqueId("revt"), existing.id, existing.status, parsed.data.status, staff.loginAccountId, staff.activePersonId, parsed.data.note || null, JSON.stringify({ source: "referral_operations_dashboard" }), now),
      c.env.DB.prepare(
        `insert into audit_logs
          (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
         values (?, ?, ?, ?, ?, 'referral_status_updated', 'referral', ?, ?, ?)`,
      )
        .bind(createOpaqueId("audit"), ORG_ID, existing.branch_id, staff.loginAccountId, staff.activePersonId, existing.id, JSON.stringify({ from: existing.status, to: parsed.data.status }), now),
    ]);

    return jsonPlain(c, { success: true, referralId: existing.id, status: parsed.data.status, idempotent: false });
  });
}

async function referralDetail(c: PortalContext, staff: StaffContext, referralId: string) {
  const scope = await branchScope(c, staff);
  if (!scope.canAccessAnyBranch) return null;
  const where = scopedWhere(scope, ["referrals.id = ?", "referrals.organisation_id = ?"], [referralId, ORG_ID]);
  const row = await c.env.DB.prepare(
    `${listSelectSql(`,
        referral_programmes.name as referral_programme_name,
        referral_programmes.validity_days,
        referrer_profiles.external_referrer_id,
        referrals.prospect_person_id,
        matched_people.full_name as person_name,
        fee_agreements.id as fee_agreement_id,
        fee_agreements.payment_plan_type,
        referral_reward_snapshots.minimum_qualifying_payment_paise,
        referral_reward_snapshots.snapshot_json`)}
     ${where.sql}
     limit 1`,
  )
    .bind(...where.params)
    .first<ReferralDetailRow>();
  if (!row) return null;
  const events = await c.env.DB.prepare(
    `select
       referral_status_events.id,
       referral_status_events.from_status,
       referral_status_events.to_status,
       referral_status_events.event_type,
       referral_status_events.internal_note,
       referral_status_events.created_at,
       people.public_name as actor_public_name
     from referral_status_events
     left join people on people.id = referral_status_events.actor_person_id
     where referral_status_events.referral_id = ?
     order by referral_status_events.created_at desc`,
  )
    .bind(referralId)
    .all();
  const rewardSlabs = await c.env.DB.prepare(
    `select referral_reward_slabs.id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order
     from referral_reward_slabs
     join referral_reward_rule_sets on referral_reward_rule_sets.id = referral_reward_slabs.reward_rule_set_id
     where referral_reward_rule_sets.referral_programme_id = ?
       and referral_reward_rule_sets.status = 'active'
     order by referral_reward_slabs.sort_order`,
  )
    .bind("rprog_samyak_skill_circle")
    .all();
  return {
    success: true,
    referral: {
      ...(await toListItem(c, row)),
      programmeName: row.referral_programme_name,
      validityDays: Number(row.validity_days || 0),
      referrer: {
        externalReferrerId: row.external_referrer_id || "",
        publicName: row.referrer_public_name || row.referrer_name || "",
        type: row.referrer_type || "",
      },
      matchedPerson: row.prospect_person_id ? { personId: row.prospect_person_id, publicName: row.person_name || "Matched person" } : null,
      fee: row.fee_agreement_id
        ? {
            feeAgreementId: row.fee_agreement_id,
            finalAgreedFeePaise: Number(row.final_agreed_fee_paise || 0),
            minimumQualifyingPaymentPaise: Number(row.minimum_qualifying_payment_paise || calculateMinimum(row)),
            paymentPlanType: row.payment_plan_type || "",
            receivedAmountPaise: null,
            receivedAmountAvailable: false,
          }
        : null,
      rewardSlabs: (rewardSlabs.results || []).map((slab) => ({
        id: String(slab.id),
        minFinalFeePaise: Number(slab.min_final_fee_paise || 0),
        maxFinalFeePaise: slab.max_final_fee_paise === null ? null : Number(slab.max_final_fee_paise),
        cashRewardPaise: Number(slab.cash_reward_paise || 0),
        courseCreditPaise: Number(slab.course_credit_paise || 0),
        sortOrder: Number(slab.sort_order || 0),
      })),
      timeline: (events.results || []).map((event) => ({
        id: String(event.id),
        fromStatus: nullableString(event.from_status),
        toStatus: String(event.to_status || ""),
        eventType: String(event.event_type || ""),
        actorPublicName: nullableString(event.actor_public_name),
        internalNote: nullableString(event.internal_note),
        createdAt: String(event.created_at || ""),
      })),
    },
  };
}

async function scopedReferral(c: PortalContext, staff: StaffContext, referralId: string) {
  const scope = await branchScope(c, staff);
  if (!scope.canAccessAnyBranch) return null;
  const where = scopedWhere(scope, ["id = ?", "organisation_id = ?"], [referralId, ORG_ID], "referrals");
  return c.env.DB.prepare(`select id, branch_id, status from referrals ${where.sql} limit 1`)
    .bind(...where.params)
    .first<{ id: string; branch_id: string; status: ReferralStatus }>();
}

function listSelectSql(extraColumns = "") {
  return `select
       referrals.id as referral_id,
       referrals.referral_link_id,
       referrals.branch_id,
       branches.name as branch_name,
       referrals.submitted_at,
       referrals.valid_until,
       referrals.status,
       referrals.updated_at,
       referrals.prospect_name,
       referrals.prospect_mobile_hash,
       referrals.prospect_mobile_ciphertext,
       (
         select person_contacts.id
         from person_contacts
         left join person_contact_details on person_contact_details.contact_id = person_contacts.id
         join person_contact_secrets on person_contact_secrets.contact_id = person_contacts.id
         where person_contacts.person_id = referrals.prospect_person_id
           and person_contacts.contact_type = 'mobile'
           and coalesce(person_contact_details.status, 'active') = 'active'
         order by person_contacts.is_primary desc, person_contacts.created_at desc
         limit 1
       ) as prospect_contact_id,
       (
         select person_contact_secrets.value_ciphertext
         from person_contacts
         left join person_contact_details on person_contact_details.contact_id = person_contacts.id
         join person_contact_secrets on person_contact_secrets.contact_id = person_contacts.id
         where person_contacts.person_id = referrals.prospect_person_id
           and person_contacts.contact_type = 'mobile'
           and coalesce(person_contact_details.status, 'active') = 'active'
         order by person_contacts.is_primary desc, person_contacts.created_at desc
         limit 1
       ) as prospect_contact_ciphertext,
       referrer_people.full_name as referrer_name,
       referrer_people.public_name as referrer_public_name,
       referrer_roles.code as referrer_type,
       courses.name as course_name,
       enquiries.id as enquiry_id,
       enquiries.enquiry_number,
       enquiries.status as enquiry_status,
       enrolments.id as enrolment_id,
       enrolments.enrolment_number,
       enrolments.status as enrolment_status,
       enrolments.admission_date as enrolment_admission_date,
       fee_agreements.final_agreed_fee_paise,
       referral_programmes.minimum_fee_percentage,
       referral_reward_snapshots.id as reward_snapshot_id,
       referral_reward_snapshots.cash_reward_paise,
       referral_reward_snapshots.course_credit_paise,
       referral_reward_snapshots.slab_id
       ${extraColumns}
     ${listFromSql()}`;
}

function listFromSql() {
  return `from referrals
     join referral_programmes on referral_programmes.id = referrals.referral_programme_id
     join referrer_profiles on referrer_profiles.id = referrals.referrer_profile_id
     join people referrer_people on referrer_people.id = referrer_profiles.person_id
     left join person_roles on person_roles.person_id = referrer_profiles.person_id
     left join roles referrer_roles on referrer_roles.id = person_roles.role_id and referrer_roles.code in ('student', 'alumni')
     left join branches on branches.id = referrals.branch_id
     left join courses on courses.id = referrals.course_interest_id
     left join enquiries on enquiries.id = referrals.enquiry_id
     left join people matched_people on matched_people.id = referrals.prospect_person_id
     left join enrolments on enrolments.referral_id = referrals.id
     left join fee_agreements on fee_agreements.enrolment_id = enrolments.id and fee_agreements.status = 'active'
     left join referral_reward_snapshots on referral_reward_snapshots.referral_id = referrals.id`;
}

async function listWhere(c: PortalContext, scope: BranchScope, filters: ReturnType<typeof listFilters>) {
  const now = new Date().toISOString();
  const clauses = ["referrals.organisation_id = ?"];
  const params: Array<string | number> = [ORG_ID];
  if (filters.status) push(clauses, params, "referrals.status = ?", filters.status);
  if (filters.rewardStatus) pushRewardFilter(clauses, params, filters.rewardStatus, now);
  if (filters.referrerType) push(clauses, params, "referrer_roles.code = ?", filters.referrerType);
  if (filters.courseId) push(clauses, params, "referrals.course_interest_id = ?", filters.courseId);
  if (filters.fromDate) push(clauses, params, "referrals.submitted_at >= ?", `${filters.fromDate}T00:00:00.000Z`);
  if (filters.toDate) push(clauses, params, "referrals.submitted_at <= ?", `${filters.toDate}T23:59:59.999Z`);
  if (filters.admission === "admitted") clauses.push("enrolments.id is not null");
  if (filters.admission === "not_admitted") clauses.push("enrolments.id is null");
  if (filters.validity === "active") push(clauses, params, "referrals.valid_until >= ?", now);
  if (filters.validity === "expired") push(clauses, params, "referrals.valid_until < ?", now);
  if (filters.q) {
    const q = `%${filters.q}%`;
    clauses.push("(referrals.id like ? or referrals.prospect_name like ? or referrer_people.full_name like ? or enquiries.enquiry_number like ?)");
    params.push(q, q, q, q);
  }
  const scoped = scopedWhere(scope, clauses, params, "referrals");
  await c.env.DB.prepare("select 1").first();
  return scoped;
}

function push(clauses: string[], params: Array<string | number>, clause: string, value: string | number) {
  clauses.push(clause);
  params.push(value);
}

function pushRewardFilter(clauses: string[], params: Array<string | number>, rewardStatus: string, now: string) {
  if (rewardStatus === "payment_data_unavailable") clauses.push("enrolments.id is not null and enrolments.admission_date <= referrals.valid_until");
  if (rewardStatus === "pending") clauses.push("enrolments.id is null and referrals.valid_until >= ?");
  if (rewardStatus === "expired") {
    clauses.push("((enrolments.id is null and referrals.valid_until < ?) or (enrolments.id is not null and enrolments.admission_date > referrals.valid_until))");
    params.push(now);
  }
  if (rewardStatus === "pending") params.push(now);
}

type BranchScope = {
  canAccessAnyBranch: boolean;
  allBranches: boolean;
  branchIds: string[];
};

async function branchScope(c: PortalContext, staff: StaffContext): Promise<BranchScope> {
  if (staff.roles.some((role) => ["owner", "system_admin", "admin"].includes(role))) {
    return { canAccessAnyBranch: true, allBranches: true, branchIds: [] };
  }
  const rows = await c.env.DB.prepare(
    `select distinct branch_id
     from login_account_roles
     join roles on roles.id = login_account_roles.role_id
     where login_account_roles.login_account_id = ?
       and roles.code in (${ADMISSION_STAFF_ROLES.map(() => "?").join(",")})`,
  )
    .bind(staff.loginAccountId, ...ADMISSION_STAFF_ROLES)
    .all<{ branch_id: string | null }>();
  const branchIds = (rows.results || []).map((row) => row.branch_id).filter((value): value is string => Boolean(value));
  const hasGlobalStaffRole = (rows.results || []).some((row) => !row.branch_id);
  return { canAccessAnyBranch: hasGlobalStaffRole || branchIds.length > 0, allBranches: hasGlobalStaffRole, branchIds };
}

function scopedWhere(scope: BranchScope, clauses: string[], params: Array<string | number>, tableAlias = "referrals") {
  if (!scope.allBranches) {
    if (scope.branchIds.length === 0) clauses.push("1 = 0");
    else {
      clauses.push(`${tableAlias}.branch_id in (${scope.branchIds.map(() => "?").join(",")})`);
      params.push(...scope.branchIds);
    }
  }
  return { sql: `where ${clauses.join(" and ")}`, params };
}

function listFilters(c: PortalContext) {
  const url = new URL(c.req.url);
  return {
    q: clean(url.searchParams.get("q")),
    status: enumParam(url.searchParams.get("status"), REFERRAL_STATUSES),
    rewardStatus: enumParam(url.searchParams.get("rewardStatus"), ["pending", "payment_data_unavailable", "expired"] as const),
    referrerType: enumParam(url.searchParams.get("referrerType"), ["student", "alumni"] as const),
    courseId: clean(url.searchParams.get("courseId")),
    fromDate: dateParam(url.searchParams.get("fromDate")),
    toDate: dateParam(url.searchParams.get("toDate")),
    admission: enumParam(url.searchParams.get("admission"), ["admitted", "not_admitted"] as const),
    validity: enumParam(url.searchParams.get("validity"), ["active", "expired"] as const),
  };
}

function listPagination(c: PortalContext) {
  const url = new URL(c.req.url);
  return {
    limit: clampInteger(url.searchParams.get("limit"), 20, 1, 50),
    offset: clampInteger(url.searchParams.get("offset"), 0, 0, 5000),
  };
}

async function toListItem(c: PortalContext, row: ReferralListRow) {
  const qualification = qualificationState(row);
  return {
    referralId: row.referral_id,
    shortReference: row.referral_id.slice(-8).toUpperCase(),
    branchName: row.branch_name || "",
    submittedAt: row.submitted_at,
    validUntil: row.valid_until,
    validityState: validityState(row),
    lastActivityAt: row.updated_at,
    referrerName: row.referrer_public_name || row.referrer_name || "",
    referrerType: row.referrer_type || "",
    prospectPublicName: publicProspectName(row.prospect_name),
    prospectContact: await prospectContact(c, row),
    courseInterested: row.course_name || "",
    referralStatus: row.status,
    linkedEnquiry: row.enquiry_id ? { id: row.enquiry_id, enquiryNumber: row.enquiry_number || "", status: row.enquiry_status || "" } : null,
    linkedEnrolment: row.enrolment_id ? { id: row.enrolment_id, enrolmentNumber: row.enrolment_number || "", status: row.enrolment_status || "" } : null,
    admissionStatus: row.enrolment_id ? row.enrolment_status || "admitted" : "not_admitted",
    qualificationState: qualification,
    rewardStatus: rewardStatus(row, qualification),
    reward: null,
  };
}

async function prospectContact(c: PortalContext, row: ReferralListRow) {
  const mobile = await prospectCanonicalMobile(c, row);
  if (!mobile) return emptyProspectContact();
  const coursePhrase = row.course_name ? `${row.course_name} course` : "course";
  const draft = `Hi, this is Samyak Computer Classes, Sion. You had shown interest in our ${coursePhrase} through a referral. I'm following up to help you with course details, batch timings and admission information.`;
  return {
    mobile,
    mobileDisplay: formatIndianMobileDisplay(mobile),
    whatsappUrl: `https://wa.me/91${mobile}?text=${encodeURIComponent(draft)}`,
    callUrl: `tel:+91${mobile}`,
  };
}

async function prospectCanonicalMobile(c: PortalContext, row: ReferralListRow) {
  const contactMobile = await decryptProspectPersonContact(c, row);
  if (contactMobile) return contactMobile;
  if (!row.referral_link_id || !row.prospect_mobile_hash || !row.prospect_mobile_ciphertext) return null;
  const submittedMobile = await decryptText(c.env.SESSION_PEPPER, `referral-mobile:${row.referral_link_id}:${row.prospect_mobile_hash}`, row.prospect_mobile_ciphertext).catch(() => null);
  return submittedMobile ? normalizeIndianMobile(submittedMobile) : null;
}

async function decryptProspectPersonContact(c: PortalContext, row: ReferralListRow) {
  if (!row.prospect_contact_id || !row.prospect_contact_ciphertext) return null;
  const value = await decryptText(c.env.SESSION_PEPPER, `contact:${row.prospect_contact_id}`, row.prospect_contact_ciphertext).catch(() => null);
  return value ? normalizeIndianMobile(value) : null;
}

function emptyProspectContact() {
  return { mobile: null, mobileDisplay: null, whatsappUrl: null, callUrl: null };
}

function formatIndianMobileDisplay(mobile: string) {
  return `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`;
}

function qualificationState(row: ReferralListRow) {
  const validity = validityState(row);
  if (validity === "admission_after_expiry" || validity === "expired") return "expired";
  if (!row.enrolment_id) return "not_admitted";
  return "admitted_payment_data_unavailable";
}

function rewardStatus(row: ReferralListRow, qualification: string) {
  if (qualification === "admitted_payment_data_unavailable") return "Payment data unavailable";
  if (qualification === "expired") return "Expired";
  return "Pending";
}

function validityState(row: ReferralListRow) {
  if (row.enrolment_id) {
    const admissionTime = Date.parse(row.enrolment_admission_date || "");
    const validUntilTime = Date.parse(row.valid_until);
    if (!Number.isNaN(admissionTime) && !Number.isNaN(validUntilTime) && admissionTime <= validUntilTime) return "valid_admission";
    return "admission_after_expiry";
  }
  return Date.parse(row.valid_until) >= Date.now() ? "active" : "expired";
}

function summarize(rows: ReferralListRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary.totalReferrals += 1;
      if (row.enrolment_id) summary.admitted += 1;
      if (qualificationState(row) === "admitted_payment_data_unavailable") summary.paymentDataUnavailable += 1;
      if (qualificationState(row) === "expired") summary.expired += 1;
      return summary;
    },
    { totalReferrals: 0, admitted: 0, paymentDataUnavailable: 0, expired: 0 },
  );
}

function emptyListPayload(pagination: ReturnType<typeof listPagination>) {
  return {
    success: true,
    summary: { totalReferrals: 0, admitted: 0, paymentDataUnavailable: 0, expired: 0 },
    pagination: { ...pagination, total: 0, hasMore: false },
    filters: {},
    referrals: [],
  };
}

function calculateMinimum(row: ReferralDetailRow) {
  if (!row.final_agreed_fee_paise || row.minimum_fee_percentage === null) return 0;
  return calculateMinimumQualifyingPaymentPaise(Number(row.final_agreed_fee_paise), Number(row.minimum_fee_percentage));
}

function publicProspectName(value: string) {
  const [firstName, secondName] = String(value || "Referral prospect").trim().split(/\s+/);
  return [firstName, secondName ? `${secondName.slice(0, 1)}.` : ""].filter(Boolean).join(" ");
}

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clean(value: string | null) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 120) : "";
}

function dateParam(value: string | null) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function enumParam<T extends readonly string[]>(value: string | null, allowed: T): T[number] | "" {
  const text = clean(value);
  return allowed.includes(text) ? text : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function safeJson(bodyText: string) {
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

function forbidden(c: PortalContext) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Staff access is required." });
}
