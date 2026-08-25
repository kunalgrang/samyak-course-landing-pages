import { z } from "zod";
import type { Context, Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { ORG_ID } from "../lib/auth-store";
import { createOpaqueId, encryptText, hmacHex } from "../lib/crypto";
import { requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { normalizeIndianMobile } from "../lib/mobile";
import { requireReferralTokenPepper } from "../lib/referral-token";
import { issueReferralLink } from "../lib/referral-service";
import { requireStaffRoles, type StaffContext } from "../lib/staff-auth";
import { getCourseFeeGstBasisPoints } from "../lib/course-fee";

type PortalHono = Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>;
type PortalContext = Context<{ Bindings: WorkerBindings; Variables: WorkerVariables }>;

const PARTNER_PROGRAMME_ID = "rprog_samyak_education_partners";
const MAX_BODY_BYTES = 8192;

const partnerTypes = ["college", "coaching_class", "tuition_centre", "training_institute", "career_counsellor", "placement_consultant", "freelancer", "other"] as const;
const partnerSchema = z.object({
  partnerType: z.enum(partnerTypes),
  businessName: z.string().trim().min(1).max(160),
  contactPersonName: z.string().trim().min(1).max(120),
  mobile: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  homeBranchId: z.string().trim().min(1).max(120),
  commissionPercent: z.string().trim().min(1).max(20),
  status: z.enum(["active", "inactive"]).default("active"),
  internalNotes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export function registerStaffEducationPartnerRoutes(app: PortalHono) {
  app.get("/api/staff/education-partners", async (c) => {
    const staff = await requireStaffRoles(c, ["owner", "system_admin", "admin", "counsellor", "admission_admin"]);
    if (!staff) return forbidden(c);
    const url = new URL(c.req.url);
    const q = clean(url.searchParams.get("q"));
    const status = enumParam(url.searchParams.get("status"), ["active", "inactive"] as const);
    const limit = clampInteger(url.searchParams.get("limit"), 20, 1, 50);
    const offset = clampInteger(url.searchParams.get("offset"), 0, 0, 5000);
    const clauses = ["education_partners.organisation_id = ?"];
    const params: Array<string | number> = [ORG_ID];
    if (status) push(clauses, params, "education_partners.status = ?", status);
    if (q) {
      clauses.push("(education_partners.business_name like ? or education_partners.contact_person_name like ? or education_partners.mobile_last_four = ?)");
      params.push(`%${q}%`, `%${q}%`, q.slice(-4));
    }
    const where = `where ${clauses.join(" and ")}`;
    const rows = await c.env.DB.prepare(
      `${partnerSelectSql()}
       ${where}
       order by education_partners.updated_at desc, education_partners.business_name
       limit ? offset ?`,
    ).bind(...params, limit + 1, offset).all<PartnerRow>();
    const total = await c.env.DB.prepare(`select count(*) as count from education_partners ${where}`).bind(...params).first<{ count: number }>();
    const pageRows = (rows.results || []).slice(0, limit);
    return jsonPlain(c, {
      success: true,
      pagination: { limit, offset, total: Number(total?.count || 0), hasMore: (rows.results || []).length > limit },
      partners: pageRows.map(partnerPayload),
    });
  });

  app.get("/api/staff/education-partners/:partnerId", async (c) => {
    const staff = await requireStaffRoles(c, ["owner", "system_admin", "admin", "counsellor", "admission_admin"]);
    if (!staff) return forbidden(c);
    const partner = await findPartner(c, c.req.param("partnerId"));
    if (!partner) return jsonError(c, { status: 404, code: "partner_not_found", message: "Education partner was not found." });
    return jsonPlain(c, {
      success: true,
      partner: partnerPayload(partner),
      commercialTerms: {
        currentGstBasisPoints: getCourseFeeGstBasisPoints(),
      },
      metrics: await partnerMetrics(c, partner.id),
    });
  });

  app.post("/api/staff/education-partners", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const parsed = await parsePartnerBody(c);
    if (!parsed.ok) return parsed.response;
    const duplicateWarnings = await duplicateWarningsFor(c, parsed.data);
    const now = new Date().toISOString();
    const partnerId = createOpaqueId("epart");
    const referrerProfileId = createOpaqueId("refprof");
    const contact = await secureContact(c, partnerId, parsed.data.mobile || "", parsed.data.email || "");
    await c.env.DB.batch([
      c.env.DB.prepare(
        `insert into education_partners
          (id, organisation_id, home_branch_id, partner_type, business_name, contact_person_name,
           mobile_hash, mobile_last_four, mobile_ciphertext, email_hash, email_ciphertext, status,
           current_commission_basis_points, internal_notes, created_by_login_account_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(partnerId, ORG_ID, parsed.data.homeBranchId, parsed.data.partnerType, parsed.data.businessName, parsed.data.contactPersonName, contact.mobileHash, contact.mobileLastFour, contact.mobileCiphertext, contact.emailHash, contact.emailCiphertext, parsed.data.status, parsed.data.commissionBps, parsed.data.internalNotes || null, staff.loginAccountId, now, now),
      c.env.DB.prepare(
        `insert into referrer_profiles
          (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at)
         values (?, ?, null, ?, ?, '', ?, ?, ?)`,
      ).bind(referrerProfileId, ORG_ID, partnerId, `education_partner:${partnerId}`, parsed.data.status === "active" ? 1 : 0, now, now),
      c.env.DB.prepare("insert into education_partner_referrer_profiles (education_partner_id, referrer_profile_id, created_at) values (?, ?, ?)")
        .bind(partnerId, referrerProfileId, now),
      auditStatement(c, staff, parsed.data.homeBranchId, "education_partner_created", "education_partner", partnerId, {
        partnerId,
        partnerType: parsed.data.partnerType,
        commissionBasisPoints: parsed.data.commissionBps,
        status: parsed.data.status,
      }, now),
    ]);
    return jsonPlain(c, { success: true, partnerId, duplicateWarnings }, { status: 201 });
  });

  app.patch("/api/staff/education-partners/:partnerId", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const existing = await findPartner(c, c.req.param("partnerId"));
    if (!existing) return jsonError(c, { status: 404, code: "partner_not_found", message: "Education partner was not found." });
    const parsed = await parsePartnerBody(c);
    if (!parsed.ok) return parsed.response;
    const contact = await secureContact(c, existing.id, parsed.data.mobile || "", parsed.data.email || "");
    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `update education_partners
         set home_branch_id = ?, partner_type = ?, business_name = ?, contact_person_name = ?,
             mobile_hash = ?, mobile_last_four = ?, mobile_ciphertext = ?, email_hash = ?, email_ciphertext = ?,
             status = ?, current_commission_basis_points = ?, internal_notes = ?, updated_at = ?
         where id = ? and organisation_id = ?`,
      ).bind(parsed.data.homeBranchId, parsed.data.partnerType, parsed.data.businessName, parsed.data.contactPersonName, contact.mobileHash, contact.mobileLastFour, contact.mobileCiphertext, contact.emailHash, contact.emailCiphertext, parsed.data.status, parsed.data.commissionBps, parsed.data.internalNotes || null, now, existing.id, ORG_ID),
      c.env.DB.prepare("update referrer_profiles set active = ?, updated_at = ? where id = ? and organisation_id = ?")
        .bind(parsed.data.status === "active" ? 1 : 0, now, existing.referrer_profile_id, ORG_ID),
      ...(parsed.data.status === "inactive" ? [c.env.DB.prepare(
        `update referral_links set status = 'revoked', revoked_at = coalesce(revoked_at, ?), updated_at = ?
         where organisation_id = ? and referrer_profile_id = ? and status = 'active'`,
      ).bind(now, now, ORG_ID, existing.referrer_profile_id)] : []),
      auditStatement(c, staff, parsed.data.homeBranchId, parsed.data.status === "inactive" && existing.status !== "inactive" ? "education_partner_deactivated" : "education_partner_updated", "education_partner", existing.id, {
        partnerId: existing.id,
        commissionBasisPoints: parsed.data.commissionBps,
        status: parsed.data.status,
      }, now),
    ]);
    return jsonPlain(c, { success: true, partnerId: existing.id, duplicateWarnings: await duplicateWarningsFor(c, parsed.data, existing.id) });
  });

  app.post("/api/staff/education-partners/:partnerId/referral-link", async (c) => {
    const sameOriginError = requireSameOrigin(c);
    if (sameOriginError) return sameOriginError;
    const staff = await requireStaffRoles(c, ["owner"]);
    if (!staff) return forbiddenOwner(c);
    const partner = await findPartner(c, c.req.param("partnerId"));
    if (!partner) return jsonError(c, { status: 404, code: "partner_not_found", message: "Education partner was not found." });
    if (partner.status !== "active") return jsonError(c, { status: 409, code: "partner_inactive", message: "Activate the partner before issuing a referral link." });
    const issued = await issueReferralLink({
      DB: c.env.DB,
      SESSION_PEPPER: c.env.SESSION_PEPPER,
      referralTokenPepper: requireReferralTokenPepper(String(c.env.REFERRAL_TOKEN_PEPPER || "")),
    }, {
      organisationId: ORG_ID,
      referralProgrammeId: PARTNER_PROGRAMME_ID,
      referrerProfileId: partner.referrer_profile_id,
      loginAccountId: staff.loginAccountId,
      now: new Date().toISOString(),
    });
    const publicLink = issued.rawToken ? `/r/${issued.rawToken}` : null;
    return jsonPlain(c, { success: true, created: issued.issued, link: publicLink, shownOnce: Boolean(publicLink), lastFour: issued.link.tokenLastFour, activatedAt: issued.link.activatedAt });
  });
}

type PartnerRow = {
  id: string;
  home_branch_id: string;
  branch_name: string | null;
  partner_type: string;
  business_name: string;
  contact_person_name: string;
  mobile_last_four: string | null;
  status: string;
  current_commission_basis_points: number;
  internal_notes: string | null;
  referrer_profile_id: string;
  active_link_last_four: string | null;
  active_link_activated_at: string | null;
  referral_count: number;
  admission_count: number;
  created_at: string;
  updated_at: string;
};

function partnerSelectSql() {
  return `select education_partners.*,
       branches.name as branch_name,
       education_partner_referrer_profiles.referrer_profile_id,
       active_links.token_last_four as active_link_last_four,
       active_links.activated_at as active_link_activated_at,
       (select count(*) from referrals where referrals.education_partner_id = education_partners.id) as referral_count,
       (select count(*) from enrolments join referrals on referrals.id = enrolments.referral_id where referrals.education_partner_id = education_partners.id) as admission_count
     from education_partners
     join education_partner_referrer_profiles on education_partner_referrer_profiles.education_partner_id = education_partners.id
     left join branches on branches.id = education_partners.home_branch_id
     left join referral_links active_links on active_links.referrer_profile_id = education_partner_referrer_profiles.referrer_profile_id
       and active_links.status = 'active'
       and active_links.revoked_at is null`;
}

async function findPartner(c: PortalContext, partnerId: string) {
  return c.env.DB.prepare(`${partnerSelectSql()} where education_partners.organisation_id = ? and education_partners.id = ? limit 1`)
    .bind(ORG_ID, partnerId)
    .first<PartnerRow>();
}

async function partnerMetrics(c: PortalContext, partnerId: string) {
  const row = await c.env.DB.prepare(
    `select
       count(referrals.id) as total_referrals,
       sum(case when enrolments.id is not null then 1 else 0 end) as admissions,
       sum(case when referral_reward_snapshots.id is not null and referral_reward_payouts.id is null then 1 else 0 end) as approved,
       sum(case when referral_reward_payouts.id is not null then 1 else 0 end) as paid,
       coalesce(sum(referral_reward_snapshots.cash_reward_paise), 0) as total_approved_paise,
       coalesce(sum(referral_reward_payouts.amount_paise), 0) as total_paid_paise
     from referrals
     left join enrolments on enrolments.referral_id = referrals.id
     left join referral_reward_snapshots on referral_reward_snapshots.referral_id = referrals.id
     left join referral_reward_payouts on referral_reward_payouts.reward_snapshot_id = referral_reward_snapshots.id
     where referrals.organisation_id = ? and referrals.education_partner_id = ?`,
  ).bind(ORG_ID, partnerId).first<Record<string, number>>();
  return {
    totalReferrals: Number(row?.total_referrals || 0),
    admissions: Number(row?.admissions || 0),
    approved: Number(row?.approved || 0),
    paid: Number(row?.paid || 0),
    totalApprovedCommissionPaise: Number(row?.total_approved_paise || 0),
    totalPaidCommissionPaise: Number(row?.total_paid_paise || 0),
  };
}

function partnerPayload(row: PartnerRow) {
  return {
    id: row.id,
    homeBranchId: row.home_branch_id,
    branchName: row.branch_name || "",
    partnerType: row.partner_type,
    businessName: row.business_name,
    contactPersonName: row.contact_person_name,
    maskedMobile: row.mobile_last_four ? `••••••${row.mobile_last_four}` : "",
    status: row.status,
    currentCommissionBasisPoints: Number(row.current_commission_basis_points),
    internalNotes: row.internal_notes || "",
    referrerProfileId: row.referrer_profile_id,
    activeLink: row.active_link_last_four ? { lastFour: row.active_link_last_four, activatedAt: row.active_link_activated_at } : null,
    referralCount: Number(row.referral_count || 0),
    admissionCount: Number(row.admission_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function parsePartnerBody(c: PortalContext): Promise<{ ok: true; data: z.infer<typeof partnerSchema> & { commissionBps: number } } | { ok: false; response: Response }> {
  const contentType = c.req.header("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) return { ok: false, response: jsonError(c, { status: 415, code: "json_required", message: "Only JSON requests are accepted." }) };
  const bodyText = await c.req.raw.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) return { ok: false, response: jsonError(c, { status: 413, code: "request_too_large", message: "Please shorten partner details." }) };
  const parsed = partnerSchema.safeParse(safeJson(bodyText));
  if (!parsed.success) return { ok: false, response: jsonError(c, { status: 400, code: "invalid_partner", message: "Enter valid partner details.", fieldErrors: parsed.error.flatten().fieldErrors }) };
  if (parsed.data.mobile && !normalizeIndianMobile(parsed.data.mobile)) return { ok: false, response: jsonError(c, { status: 400, code: "invalid_mobile", message: "Enter a valid Indian mobile number.", fieldErrors: { mobile: ["Enter a valid Indian mobile number."] } }) };
  const commissionBps = parsePercentToBasisPoints(parsed.data.commissionPercent);
  if (commissionBps === null) return { ok: false, response: jsonError(c, { status: 400, code: "invalid_commission", message: "Enter commission as a percentage from 0 to 100.", fieldErrors: { commissionPercent: ["Enter commission as a percentage from 0 to 100."] } }) };
  if (parsed.data.status === "active" && commissionBps <= 0) return { ok: false, response: jsonError(c, { status: 400, code: "invalid_commission", message: "Active partners require a commission percentage.", fieldErrors: { commissionPercent: ["Active partners require a commission percentage."] } }) };
  return { ok: true, data: { ...parsed.data, commissionBps } };
}

function parsePercentToBasisPoints(value: string) {
  const text = value.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isInteger(bps) && bps >= 0 && bps <= 10000 ? bps : null;
}

async function secureContact(c: PortalContext, partnerId: string, mobileInput: string, emailInput: string) {
  const mobile = mobileInput ? normalizeIndianMobile(mobileInput) : null;
  if (mobileInput && !mobile) throw new Error("Invalid partner mobile");
  const email = emailInput.trim().toLowerCase();
  return {
    mobileHash: mobile ? await hmacHex(c.env.SESSION_PEPPER, "education-partner-mobile", mobile) : null,
    mobileLastFour: mobile ? mobile.slice(-4) : null,
    mobileCiphertext: mobile ? await encryptText(c.env.SESSION_PEPPER, `education-partner-mobile:${partnerId}`, mobile) : null,
    emailHash: email ? await hmacHex(c.env.SESSION_PEPPER, "education-partner-email", email) : null,
    emailCiphertext: email ? await encryptText(c.env.SESSION_PEPPER, `education-partner-email:${partnerId}`, email) : null,
  };
}

async function duplicateWarningsFor(c: PortalContext, input: z.infer<typeof partnerSchema> & { commissionBps: number }, excludingPartnerId?: string) {
  const contact = await secureContact(c, "duplicate-check", input.mobile || "", input.email || "");
  const clauses = ["organisation_id = ?", "id != ?"];
  const params: Array<string | null> = [ORG_ID, excludingPartnerId || ""];
  const checks: string[] = [];
  if (contact.mobileHash) {
    checks.push("mobile_hash = ?");
    params.push(contact.mobileHash);
  }
  if (contact.emailHash) {
    checks.push("email_hash = ?");
    params.push(contact.emailHash);
  }
  checks.push("lower(business_name) = lower(?)");
  params.push(input.businessName.trim());
  clauses.push(`(${checks.join(" or ")})`);
  const rows = await c.env.DB.prepare(`select id, business_name from education_partners where ${clauses.join(" and ")} limit 5`).bind(...params).all<{ id: string; business_name: string }>();
  return (rows.results || []).map((row) => ({ partnerId: row.id, businessName: row.business_name }));
}

function auditStatement(c: PortalContext, staff: StaffContext, branchId: string | null, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>, now: string) {
  return c.env.DB.prepare(
    `insert into audit_logs
      (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(createOpaqueId("audit"), ORG_ID, branchId, staff.loginAccountId, staff.activePersonId, action, entityType, entityId, JSON.stringify(metadata), now);
}

function push(clauses: string[], params: Array<string | number>, clause: string, value: string | number) {
  clauses.push(clause);
  params.push(value);
}

function clean(value: string | null) {
  return String(value || "").trim().slice(0, 120);
}

function enumParam<T extends readonly string[]>(value: string | null, allowed: T): T[number] | "" {
  const text = clean(value);
  return allowed.includes(text) ? text : "";
}

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
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

function forbiddenOwner(c: PortalContext) {
  return jsonError(c, { status: 403, code: "forbidden", message: "Only owner accounts can manage education partners." });
}
