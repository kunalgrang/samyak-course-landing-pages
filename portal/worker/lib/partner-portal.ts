import type { AppContext } from "./http";
import { ORG_ID } from "./auth-store";
import { getCourseFeeGstBasisPoints } from "./course-fee";
import { getReferralQualifications, type ReferralQualification, type ReferralRewardStatus } from "./referral-rewards";
import { requireReferralTokenPepper } from "./referral-token";
import { getRecoverableReferralLink, type ReferralServiceEnv } from "./referral-service";

const REFERRAL_PUBLIC_ORIGIN = "https://go.samyaksion.com";
const MAX_PAGE_SIZE = 50;

export type PartnerPortalView = {
  success: true;
  partner: {
    businessName: string;
    contactPersonName: string;
    partnerType: string;
    branchName: string;
    status: string;
    currentCommissionBasisPoints: number;
    gstBasisPoints: number;
    memberSince: string;
  };
  referralLink: {
    hasActiveLink: boolean;
    lastFour: string | null;
    activatedAt: string | null;
    publicUrl: string | null;
    recoverable: boolean;
    message: string;
  };
  summary: {
    totalReferrals: number;
    admissions: number;
    awaitingAdmission: number;
    awaitingPayment: number;
    qualified: number;
    approved: number;
    paid: number;
    totalApprovedCommissionPaise: number;
    totalPaidCommissionPaise: number;
  };
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  referrals: PartnerPortalReferral[];
};

export type PartnerPortalReferral = {
  reference: string;
  prospectPublicName: string;
  courseInterested: string;
  submittedAt: string;
  publicStatus: string;
  admissionStatus: string;
  commissionStatus: string;
  approvedCommissionPaise: number;
  paidCommissionPaise: number;
  paidAt: string | null;
  paymentMode: string | null;
};

type PartnerPortalRow = {
  id: string;
  business_name: string;
  contact_person_name: string;
  partner_type: string;
  status: string;
  current_commission_basis_points: number;
  created_at: string;
  branch_name: string | null;
  referrer_profile_id: string;
  active_link_id: string | null;
  active_link_token_hash: string | null;
  active_link_last_four: string | null;
  active_link_activated_at: string | null;
};

type ReferralRow = {
  referral_id: string;
  prospect_name: string | null;
  course_name: string | null;
  submitted_at: string;
  status: string;
  enrolment_id: string | null;
};

type SummaryRow = {
  total_referrals: number;
  admissions: number | null;
  awaiting_admission: number | null;
  in_progress: number | null;
  qualified: number | null;
  approved: number | null;
  paid: number | null;
  total_approved_paise: number | null;
  total_paid_paise: number | null;
};

export async function buildPartnerPortalView(c: AppContext, educationPartnerId: string, pagination: { limit?: number; offset?: number } = {}): Promise<PartnerPortalView | null> {
  const partner = await findPartnerForPortal(c, educationPartnerId);
  if (!partner) return null;
  const limit = clampInteger(pagination.limit, 20, 1, MAX_PAGE_SIZE);
  const offset = clampInteger(pagination.offset, 0, 0, 5000);
  const referralsResult = await c.env.DB.prepare(
    `select
       referrals.id as referral_id,
       referrals.prospect_name,
       courses.name as course_name,
       referrals.submitted_at,
       referrals.status,
       enrolments.id as enrolment_id
     from referrals
     left join courses on courses.id = referrals.course_interest_id
     left join enrolments on enrolments.referral_id = referrals.id
       and enrolments.referrer_profile_id = referrals.referrer_profile_id
     where referrals.organisation_id = ?
       and referrals.education_partner_id = ?
     order by referrals.submitted_at desc, referrals.id desc
     limit ? offset ?`,
  )
    .bind(ORG_ID, educationPartnerId, limit + 1, offset)
    .all<ReferralRow>();
  const pageRows = (referralsResult.results || []).slice(0, limit);
  const summary = await c.env.DB.prepare(
    `select
       count(referrals.id) as total_referrals,
       sum(case when enrolments.id is not null then 1 else 0 end) as admissions,
       sum(case when enrolments.id is null and referrals.status not in ('rejected', 'cancelled', 'closed', 'expired') then 1 else 0 end) as awaiting_admission,
       sum(case
         when enrolments.id is not null
           and referral_reward_snapshots.id is null
           and referrals.status not in ('rejected', 'cancelled', 'closed', 'expired')
           and enrolments.status = 'confirmed'
           and enrolments.admission_date <= referrals.valid_until
           and fee_agreements.id is not null
           and fee_agreements.status = 'active'
           and coalesce((
             select sum(receipts.amount_paise)
             from receipts
             where receipts.organisation_id = referrals.organisation_id
               and receipts.enrolment_id = enrolments.id
               and receipts.fee_agreement_id = fee_agreements.id
               and receipts.branch_id = referrals.branch_id
               and receipts.status = 'recorded'
           ), 0) < ((fee_agreements.final_agreed_fee_paise * referral_programmes.minimum_fee_percentage + 99) / 100)
         then 1 else 0 end) as in_progress,
       sum(case
         when enrolments.id is not null
           and referral_reward_snapshots.id is null
           and enrolments.status = 'confirmed'
           and enrolments.admission_date <= referrals.valid_until
           and fee_agreements.id is not null
           and fee_agreements.status = 'active'
           and coalesce((
             select sum(receipts.amount_paise)
             from receipts
             where receipts.organisation_id = referrals.organisation_id
               and receipts.enrolment_id = enrolments.id
               and receipts.fee_agreement_id = fee_agreements.id
               and receipts.branch_id = referrals.branch_id
               and receipts.status = 'recorded'
           ), 0) >= ((fee_agreements.final_agreed_fee_paise * referral_programmes.minimum_fee_percentage + 99) / 100)
         then 1 else 0 end) as qualified,
       sum(case when referral_reward_snapshots.id is not null and referral_reward_payouts.id is null then 1 else 0 end) as approved,
       sum(case when referral_reward_payouts.id is not null then 1 else 0 end) as paid,
       coalesce(sum(referral_reward_snapshots.cash_reward_paise), 0) as total_approved_paise,
       coalesce(sum(referral_reward_payouts.amount_paise), 0) as total_paid_paise
     from referrals
     join referral_programmes on referral_programmes.id = referrals.referral_programme_id
       and referral_programmes.organisation_id = referrals.organisation_id
     left join enrolments on enrolments.referral_id = referrals.id
       and enrolments.referrer_profile_id = referrals.referrer_profile_id
     left join fee_agreements on fee_agreements.enrolment_id = enrolments.id
       and fee_agreements.status = 'active'
     left join referral_reward_snapshots on referral_reward_snapshots.referral_id = referrals.id
       and referral_reward_snapshots.enrolment_id = enrolments.id
     left join referral_reward_payouts on referral_reward_payouts.reward_snapshot_id = referral_reward_snapshots.id
     where referrals.organisation_id = ?
       and referrals.education_partner_id = ?`,
  )
    .bind(ORG_ID, educationPartnerId)
    .first<SummaryRow>();
  const pageQualifications = await getReferralQualifications(c, pageRows.map((row) => row.referral_id));
  const link = await recoverPartnerReferralLink(c, partner);
  return {
    success: true,
    partner: {
      businessName: partner.business_name,
      contactPersonName: partner.contact_person_name,
      partnerType: partner.partner_type,
      branchName: partner.branch_name || "",
      status: partner.status,
      currentCommissionBasisPoints: Number(partner.current_commission_basis_points),
      gstBasisPoints: getCourseFeeGstBasisPoints(),
      memberSince: partner.created_at.slice(0, 10),
    },
    referralLink: {
      hasActiveLink: Boolean(partner.active_link_id),
      lastFour: partner.active_link_last_four,
      activatedAt: partner.active_link_activated_at,
      publicUrl: link?.recoverable ? link.publicUrl : null,
      recoverable: Boolean(link?.recoverable),
      message: partner.active_link_id
        ? link?.recoverable
          ? "Your active referral link is ready to share."
          : "Your active referral link could not be recovered. Please contact Samyak."
        : "No active referral link is available. Please contact Samyak.",
    },
    summary: summarize(summary),
    pagination: {
      limit,
      offset,
      total: Number(summary?.total_referrals || 0),
      hasMore: (referralsResult.results || []).length > limit,
    },
    referrals: pageRows.map((row) => referralPayload(row, pageQualifications.get(row.referral_id))),
  };
}

async function findPartnerForPortal(c: AppContext, educationPartnerId: string) {
  return c.env.DB.prepare(
    `select education_partners.*,
       branches.name as branch_name,
       education_partner_referrer_profiles.referrer_profile_id,
       active_links.id as active_link_id,
       active_links.token_hash as active_link_token_hash,
       active_links.token_last_four as active_link_last_four,
       active_links.activated_at as active_link_activated_at
     from education_partners
     join education_partner_referrer_profiles on education_partner_referrer_profiles.education_partner_id = education_partners.id
     left join branches on branches.id = education_partners.home_branch_id
     left join referral_links active_links on active_links.referrer_profile_id = education_partner_referrer_profiles.referrer_profile_id
       and active_links.status = 'active'
       and active_links.revoked_at is null
     where education_partners.organisation_id = ?
       and education_partners.id = ?
     limit 1`,
  )
    .bind(ORG_ID, educationPartnerId)
    .first<PartnerPortalRow>();
}

async function recoverPartnerReferralLink(c: AppContext, partner: PartnerPortalRow) {
  if (!partner.active_link_id || !partner.active_link_token_hash) return null;
  return getRecoverableReferralLink(referralEnv(c), {
    link: { id: partner.active_link_id, organisation_id: ORG_ID, token_hash: partner.active_link_token_hash },
    publicOrigin: REFERRAL_PUBLIC_ORIGIN,
  });
}

function summarize(row: SummaryRow | null | undefined) {
  return {
    totalReferrals: Number(row?.total_referrals || 0),
    admissions: Number(row?.admissions || 0),
    awaitingAdmission: Number(row?.awaiting_admission || 0),
    awaitingPayment: Number(row?.in_progress || 0),
    qualified: Number(row?.qualified || 0),
    approved: Number(row?.approved || 0),
    paid: Number(row?.paid || 0),
    totalApprovedCommissionPaise: Number(row?.total_approved_paise || 0),
    totalPaidCommissionPaise: Number(row?.total_paid_paise || 0),
  };
}

function referralPayload(row: ReferralRow, qualification?: ReferralQualification): PartnerPortalReferral {
  return {
    reference: publicReference(row.submitted_at, row.referral_id),
    prospectPublicName: publicProspectName(row.prospect_name),
    courseInterested: row.course_name || "Course pending",
    submittedAt: row.submitted_at,
    publicStatus: publicReferralStatus(row.status),
    admissionStatus: row.enrolment_id ? "Admitted" : "Awaiting admission",
    commissionStatus: qualification ? commissionStatus(qualification.status) : "Under review",
    approvedCommissionPaise: qualification?.rewardSnapshot?.cashRewardPaise || 0,
    paidCommissionPaise: qualification?.payout?.amountPaise || 0,
    paidAt: qualification?.payout?.paymentDate || null,
    paymentMode: qualification?.payout?.paymentMode || null,
  };
}

function referralEnv(c: AppContext): ReferralServiceEnv {
  return {
    DB: c.env.DB,
    SESSION_PEPPER: c.env.SESSION_PEPPER,
    referralTokenPepper: requireReferralTokenPepper(String(c.env.REFERRAL_TOKEN_PEPPER || "")),
  };
}

function commissionStatus(status: ReferralRewardStatus) {
  const labels: Record<ReferralRewardStatus, string> = {
    awaiting_admission: "Awaiting admission",
    admission_outside_validity: "Not eligible",
    awaiting_payment: "Awaiting payment",
    qualified: "Qualified",
    approved: "Approved",
    paid: "Paid",
    not_eligible: "Not eligible",
    payment_data_unavailable: "Payment data unavailable",
  };
  return labels[status];
}

function publicReferralStatus(status: string) {
  const labels: Record<string, string> = {
    submitted: "Submitted",
    accepted: "Accepted",
    active: "In counselling",
    converted: "Converted",
    rejected: "Not eligible",
    expired: "Expired",
    cancelled: "Cancelled",
    closed: "Closed",
  };
  return labels[status] || "Submitted";
}

function publicProspectName(value: string | null) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (!normalized) return "Student";
  const parts = normalized.split(" ");
  if (parts.length === 1) return parts[0].slice(0, 40);
  return `${parts[0].slice(0, 30)} ${parts[parts.length - 1].slice(0, 1).toUpperCase()}.`;
}

function publicReference(submittedAt: string, referralId: string) {
  const date = submittedAt.slice(0, 10).replace(/-/g, "");
  const suffix = referralId.replace(/[^A-Za-z0-9]/g, "").slice(-5).toUpperCase();
  return `REF-${date}-${suffix || "PORTAL"}`;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}
