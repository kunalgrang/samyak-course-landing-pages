import { createOpaqueId } from "./crypto";

export type ReferralDb = Pick<D1Database, "prepare" | "batch">;

export type ActorIdentity = {
  loginAccountId?: string | null;
  personId?: string | null;
};

export type ProgrammeRecord = {
  id: string;
  organisation_id: string;
  code: string;
  name: string;
  validity_days: number;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
};

export type ReferrerProfileRecord = {
  id: string;
  organisation_id: string;
  person_id: string | null;
  public_name: string | null;
  full_name: string | null;
  person_status: string | null;
  active: number;
  eligible: number;
  referrer_type: "student" | "alumni" | "education_partner" | null;
  education_partner_id: string | null;
  partner_status: string | null;
  current_commission_basis_points: number | null;
};

export type ReferralLinkRecord = {
  id: string;
  organisation_id: string;
  referral_programme_id: string;
  referrer_profile_id: string;
  token_hash: string;
  token_last_four: string | null;
  link_version: number;
  status: string;
  activated_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  programme_code: string;
  programme_name: string;
  validity_days: number;
  programme_status: string;
  programme_starts_at: string | null;
  programme_ends_at: string | null;
  referrer_person_id: string | null;
  referrer_public_name: string | null;
  referrer_full_name: string | null;
  referrer_person_status: string | null;
  referrer_active: number;
  referrer_eligible: number;
  referrer_type: "student" | "alumni" | "education_partner" | null;
  education_partner_id: string | null;
  partner_status: string | null;
  partner_commission_basis_points: number | null;
};

export type ReferralLinkSecretRecord = {
  referral_link_id: string;
  token_ciphertext: string;
  encryption_version: string;
  created_at: string;
  updated_at: string;
};

export type EligibleCourseRecord = {
  id: string;
  code: string;
  name: string;
  duration_label: string | null;
  duration_months: number | null;
  category_id: string;
  category_code: string;
  category_name: string;
  category_sort_order: number;
};

export type IdempotentReferralRecord = {
  id: string;
  enquiry_id: string | null;
  enquiry_number: string | null;
  idempotency_payload_hash: string | null;
  status: string;
};

export type CreatedReferralResult = {
  referralId: string;
  enquiryId: string;
  enquiryNumber: string;
};

export type CreateReferralRowsInput = ActorIdentity & {
  organisationId: string;
  branchId: string;
  branchCode: string;
  programme: ProgrammeRecord;
  link: ReferralLinkRecord;
  courseId: string;
  prospectName: string;
  prospectMobileHash: string;
  prospectMobileLastFour: string;
  prospectMobileCiphertext: string;
  prospectEmailCiphertext?: string | null;
  submittedAt: string;
  validUntil: string;
  idempotencyKeyHash?: string | null;
  idempotencyPayloadHash?: string | null;
  educationPartnerId?: string | null;
  partnerCommissionBasisPoints?: number | null;
  gstBasisPointsApplicable?: number | null;
};

const eligibleReferralCourseFromWhere = `
       from referral_programmes
       join courses on courses.organisation_id = referral_programmes.organisation_id
       left join referral_programme_courses on referral_programme_courses.referral_programme_id = referral_programmes.id
         and referral_programme_courses.course_id = courses.id
       join course_categories on course_categories.id = courses.category_id
         and course_categories.organisation_id = courses.organisation_id
       where referral_programmes.id = ?
         and referral_programmes.organisation_id = ?
         and referral_programmes.status = 'active'
         and (referral_programmes.starts_at is null or referral_programmes.starts_at <= ?)
         and (referral_programmes.ends_at is null or referral_programmes.ends_at >= ?)
         and courses.status = 'active'
         and courses.admission_configuration_complete = 1
         and (
           referral_programme_courses.is_active = 1
           or referral_programmes.code = 'samyak_education_partners'
         )
         and course_categories.is_active = 1`;

export class ReferralRepository {
  constructor(private readonly db: ReferralDb) {}

  findActiveOrganisation(organisationId: string) {
    return this.db.prepare("select id, status from organisations where id = ? and status = 'active'")
      .bind(organisationId)
      .first<{ id: string; status: string }>();
  }

  findCurrentProgramme(organisationId: string, referralProgrammeId: string, nowIso: string) {
    return this.db.prepare(
      `select id, organisation_id, code, name, validity_days, status, starts_at, ends_at
       from referral_programmes
       where id = ?
         and organisation_id = ?
         and status = 'active'
         and (starts_at is null or starts_at <= ?)
         and (ends_at is null or ends_at >= ?)`,
    )
      .bind(referralProgrammeId, organisationId, nowIso, nowIso)
      .first<ProgrammeRecord>();
  }

  findReferrerProfileForProgramme(organisationId: string, referralProgrammeId: string, referrerProfileId: string) {
    return this.db.prepare(
      `select
         referrer_profiles.id,
         referrer_profiles.organisation_id,
         referrer_profiles.person_id,
         people.public_name,
         people.full_name,
         people.status as person_status,
         referrer_profiles.active,
         case when education_partners.id is not null then 'education_partner' else roles.code end as referrer_type,
         education_partners.id as education_partner_id,
         education_partners.status as partner_status,
         education_partners.current_commission_basis_points,
         case
           when education_partners.id is not null then exists(
             select 1
             from referral_programme_referrer_types
             where referral_programme_referrer_types.referral_programme_id = ?
               and referral_programme_referrer_types.referrer_type = 'education_partner'
           )
           else exists(
           select 1
           from referral_programme_referrer_types
           join person_roles on person_roles.person_id = people.id
           join roles on roles.id = person_roles.role_id
             and roles.organisation_id = referrer_profiles.organisation_id
             and roles.code = referral_programme_referrer_types.referrer_type
           where referral_programme_referrer_types.referral_programme_id = ?
           )
         end as eligible
       from referrer_profiles
       left join education_partner_referrer_profiles on education_partner_referrer_profiles.referrer_profile_id = referrer_profiles.id
       left join education_partners on education_partners.id = education_partner_referrer_profiles.education_partner_id
         and education_partners.organisation_id = referrer_profiles.organisation_id
       left join people on people.id = referrer_profiles.person_id
         and people.organisation_id = referrer_profiles.organisation_id
       left join person_roles on person_roles.person_id = people.id
       left join roles on roles.id = person_roles.role_id
         and roles.organisation_id = referrer_profiles.organisation_id
         and roles.code in ('student', 'alumni')
       where referrer_profiles.id = ?
         and referrer_profiles.organisation_id = ?`,
    )
      .bind(referralProgrammeId, referralProgrammeId, referrerProfileId, organisationId)
      .first<ReferrerProfileRecord>();
  }

  async actorCanUseReferrerProfile(actor: ActorIdentity | undefined, profile: ReferrerProfileRecord) {
    if (!actor?.loginAccountId && !actor?.personId) return true;
    if (profile.education_partner_id) return Boolean(actor.loginAccountId);
    if (!profile.person_id) return false;
    if (actor.personId && actor.personId !== profile.person_id) return false;
    if (!actor.loginAccountId) return true;
    const linked = await this.db.prepare(
      `select 1 as ok
       from login_account_people
       join login_accounts on login_accounts.id = login_account_people.login_account_id
       where login_account_people.login_account_id = ?
         and login_account_people.person_id = ?
         and login_account_people.access_type = 'self'
         and login_account_people.is_available = 1
         and login_accounts.organisation_id = ?
         and login_accounts.status = 'active'`,
    )
      .bind(actor.loginAccountId, profile.person_id, profile.organisation_id)
      .first<{ ok: number }>();
    return Boolean(linked);
  }

  findActiveReferralLink(organisationId: string, referralProgrammeId: string, referrerProfileId: string, nowIso: string) {
    return this.db.prepare(
      `select *
       from referral_links
       where organisation_id = ?
         and referral_programme_id = ?
         and referrer_profile_id = ?
         and status = 'active'
         and revoked_at is null
         and (expires_at is null or expires_at > ?)
       limit 1`,
    )
      .bind(organisationId, referralProgrammeId, referrerProfileId, nowIso)
      .first<ReferralLinkRecord>();
  }

  async insertReferralLink(input: {
    linkId?: string;
    organisationId: string;
    referralProgrammeId: string;
    referrerProfileId: string;
    tokenHash: string;
    tokenLastFour: string;
    linkVersion: number;
    activatedAt: string;
    expiresAt?: string | null;
    tokenCiphertext?: string | null;
    actor?: ActorIdentity;
  }) {
    const linkId = input.linkId || createOpaqueId("rlink");
    const statements = [
      this.db.prepare(
        `insert into referral_links
          (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four, link_version,
           status, activated_at, expires_at, revoked_at, last_used_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, null, null, ?, ?)`,
      ).bind(
        linkId,
        input.organisationId,
        input.referralProgrammeId,
        input.referrerProfileId,
        input.tokenHash,
        input.tokenLastFour,
        input.linkVersion,
        input.activatedAt,
        input.expiresAt || null,
        input.activatedAt,
        input.activatedAt,
      ),
      ...(input.tokenCiphertext ? [this.db.prepare(
        `insert into referral_link_secrets
          (referral_link_id, token_ciphertext, encryption_version, created_at, updated_at)
         values (?, ?, 'v1', ?, ?)`,
      ).bind(linkId, input.tokenCiphertext, input.activatedAt, input.activatedAt)] : []),
      this.db.prepare(
        `insert into audit_logs
          (id, organisation_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
         values (?, ?, ?, ?, 'referral_link_issued', 'referral_link', ?, ?, ?)`,
      ).bind(
        createOpaqueId("audit"),
        input.organisationId,
        input.actor?.loginAccountId || null,
        input.actor?.personId || null,
        linkId,
        JSON.stringify({ linkVersion: input.linkVersion, tokenLastFour: input.tokenLastFour }),
        input.activatedAt,
      ),
    ];
    await this.db.batch(statements);
    return linkId;
  }

  async rotateReferralLink(input: {
    linkId?: string;
    organisationId: string;
    referralProgrammeId: string;
    referrerProfileId: string;
    tokenHash: string;
    tokenLastFour: string;
    rotatedAt: string;
    expiresAt?: string | null;
    tokenCiphertext?: string | null;
    actor?: ActorIdentity;
  }) {
    const active = await this.findActiveReferralLink(input.organisationId, input.referralProgrammeId, input.referrerProfileId, input.rotatedAt);
    const linkId = input.linkId || createOpaqueId("rlink");
    const nextVersion = Math.max(1, Number(active?.link_version || 0) + 1);
    const statements = [
      this.db.prepare(
        `update referral_links
         set status = 'revoked',
             revoked_at = ?,
             updated_at = ?
         where organisation_id = ?
           and referral_programme_id = ?
           and referrer_profile_id = ?
           and status = 'active'
           and revoked_at is null`,
      ).bind(input.rotatedAt, input.rotatedAt, input.organisationId, input.referralProgrammeId, input.referrerProfileId),
      this.db.prepare(
        `insert into referral_links
          (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four, link_version,
           status, activated_at, expires_at, revoked_at, last_used_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, null, null, ?, ?)`,
      ).bind(
        linkId,
        input.organisationId,
        input.referralProgrammeId,
        input.referrerProfileId,
        input.tokenHash,
        input.tokenLastFour,
        nextVersion,
        input.rotatedAt,
        input.expiresAt || null,
        input.rotatedAt,
        input.rotatedAt,
      ),
      ...(input.tokenCiphertext ? [this.db.prepare(
        `insert into referral_link_secrets
          (referral_link_id, token_ciphertext, encryption_version, created_at, updated_at)
         values (?, ?, 'v1', ?, ?)`,
      ).bind(linkId, input.tokenCiphertext, input.rotatedAt, input.rotatedAt)] : []),
      this.db.prepare(
        `insert into audit_logs
          (id, organisation_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
         values (?, ?, ?, ?, 'referral_link_rotated', 'referral_link', ?, ?, ?)`,
      ).bind(
        createOpaqueId("audit"),
        input.organisationId,
        input.actor?.loginAccountId || null,
        input.actor?.personId || null,
        linkId,
        JSON.stringify({ previousLinkId: active?.id || null, linkVersion: nextVersion, tokenLastFour: input.tokenLastFour }),
        input.rotatedAt,
      ),
    ];
    await this.db.batch(statements);
    return { linkId, linkVersion: nextVersion, previousLinkId: active?.id || null };
  }

  findReferralLinkSecret(referralLinkId: string) {
    return this.db.prepare(
      `select referral_link_id, token_ciphertext, encryption_version, created_at, updated_at
       from referral_link_secrets
       where referral_link_id = ?
       limit 1`,
    )
      .bind(referralLinkId)
      .first<ReferralLinkSecretRecord>();
  }

  findLinkByTokenHash(organisationId: string, tokenHash: string) {
    return this.db.prepare(
      `select
         referral_links.*,
         referral_programmes.code as programme_code,
         referral_programmes.name as programme_name,
         referral_programmes.validity_days,
         referral_programmes.status as programme_status,
         referral_programmes.starts_at as programme_starts_at,
         referral_programmes.ends_at as programme_ends_at,
         referrer_profiles.person_id as referrer_person_id,
         coalesce(people.public_name, education_partners.business_name) as referrer_public_name,
         coalesce(people.full_name, education_partners.business_name) as referrer_full_name,
         people.status as referrer_person_status,
         referrer_profiles.active as referrer_active,
         case when education_partners.id is not null then 'education_partner' else roles.code end as referrer_type,
         education_partners.id as education_partner_id,
         education_partners.status as partner_status,
         education_partners.current_commission_basis_points as partner_commission_basis_points,
         case
           when education_partners.id is not null then exists(
             select 1
             from referral_programme_referrer_types
             where referral_programme_referrer_types.referral_programme_id = referral_links.referral_programme_id
               and referral_programme_referrer_types.referrer_type = 'education_partner'
           )
           else exists(
           select 1
           from referral_programme_referrer_types
           join person_roles on person_roles.person_id = people.id
           join roles on roles.id = person_roles.role_id
             and roles.organisation_id = referral_links.organisation_id
             and roles.code = referral_programme_referrer_types.referrer_type
           where referral_programme_referrer_types.referral_programme_id = referral_links.referral_programme_id
           )
         end as referrer_eligible
       from referral_links
       join referral_programmes on referral_programmes.id = referral_links.referral_programme_id
         and referral_programmes.organisation_id = referral_links.organisation_id
       join referrer_profiles on referrer_profiles.id = referral_links.referrer_profile_id
         and referrer_profiles.organisation_id = referral_links.organisation_id
       left join education_partner_referrer_profiles on education_partner_referrer_profiles.referrer_profile_id = referrer_profiles.id
       left join education_partners on education_partners.id = education_partner_referrer_profiles.education_partner_id
         and education_partners.organisation_id = referral_links.organisation_id
       left join people on people.id = referrer_profiles.person_id
         and people.organisation_id = referral_links.organisation_id
       left join person_roles on person_roles.person_id = people.id
       left join roles on roles.id = person_roles.role_id
         and roles.organisation_id = referral_links.organisation_id
         and roles.code in ('student', 'alumni')
       where referral_links.organisation_id = ?
         and referral_links.token_hash = ?
       limit 1`,
    )
      .bind(organisationId, tokenHash)
      .first<ReferralLinkRecord>();
  }

  listEligibleReferralCourses(organisationId: string, referralProgrammeId: string, nowIso: string) {
    return this.db.prepare(
      `select
         courses.id,
         courses.code,
         courses.name,
         courses.duration_label,
         courses.duration_months,
         course_categories.id as category_id,
         course_categories.code as category_code,
         course_categories.name as category_name,
         course_categories.sort_order as category_sort_order
       ${eligibleReferralCourseFromWhere}
       order by course_categories.sort_order, courses.code`,
    )
      .bind(referralProgrammeId, organisationId, nowIso, nowIso)
      .all<EligibleCourseRecord>();
  }

  findActiveBranch(organisationId: string, branchId: string) {
    return this.db.prepare(
      "select id, code from branches where id = ? and organisation_id = ? and status = 'active'",
    )
      .bind(branchId, organisationId)
      .first<{ id: string; code: string }>();
  }

  findEligibleCourse(organisationId: string, referralProgrammeId: string, courseId: string, nowIso: string) {
    return this.db.prepare(
      `select courses.id
       ${eligibleReferralCourseFromWhere}
         and courses.id = ?
       limit 1`,
    )
      .bind(referralProgrammeId, organisationId, nowIso, nowIso, courseId)
      .first<{ id: string }>();
  }

  findExistingReferralByIdempotency(organisationId: string, idempotencyKeyHash: string) {
    return this.db.prepare(
      `select referrals.id, referrals.enquiry_id, enquiries.enquiry_number, referrals.idempotency_payload_hash, referrals.status
       from referrals
       left join enquiries on enquiries.id = referrals.enquiry_id
       where referrals.organisation_id = ?
         and referrals.idempotency_key_hash = ?
       limit 1`,
    )
      .bind(organisationId, idempotencyKeyHash)
      .first<IdempotentReferralRecord>();
  }

  async classifyExistingRecord(organisationId: string, mobileHash: string, nowIso: string) {
    const person = await this.db.prepare(
      `select students.current_status
       from person_contacts
       join people on people.id = person_contacts.person_id
       left join students on students.person_id = people.id
         and students.organisation_id = people.organisation_id
       where person_contacts.contact_type = 'mobile'
         and person_contacts.normalized_value = ?
         and people.organisation_id = ?
         and people.status != 'archived'
       order by students.student_since desc
       limit 1`,
    )
      .bind(mobileHash, organisationId)
      .first<{ current_status: string | null }>();
    if (person?.current_status && ["active", "on_hold", "suspended"].includes(person.current_status)) return "current_student" as const;
    if (person?.current_status && ["completed", "alumni", "dropped_out", "cancelled", "archived"].includes(person.current_status)) return "former_student" as const;

    const enquiry = await this.db.prepare(
      `select enquiries.id
       from enquiries
       left join referrals on referrals.enquiry_id = enquiries.id
       where enquiries.organisation_id = ?
         and enquiries.mobile_used = ?
         and enquiries.status not in ('invalid', 'duplicate')
         and not (
           referrals.id is not null
           and referrals.source = 'personal_link'
           and referrals.valid_until < ?
         )
       limit 1`,
    )
      .bind(organisationId, mobileHash, nowIso)
      .first<{ id: string }>();
    return enquiry ? ("existing_enquiry" as const) : null;
  }

  findActiveDuplicate(organisationId: string, mobileHash: string, nowIso: string) {
    return this.db.prepare(
      `select id
       from referrals
       where organisation_id = ?
         and prospect_mobile_hash = ?
         and status in ('accepted', 'active', 'converted')
         and valid_until >= ?
       limit 1`,
    )
      .bind(organisationId, mobileHash, nowIso)
      .first<{ id: string }>();
  }

  async createReferralAndEnquiry(input: CreateReferralRowsInput): Promise<CreatedReferralResult> {
    const referralId = createOpaqueId("referral");
    const enquiryId = createOpaqueId("enq");
    const eventId = createOpaqueId("revt");
    const auditId = createOpaqueId("audit");
    const enquiryNumber = buildEnquiryNumber(input.branchCode, input.submittedAt);
    const activeDuplicateKey = activeDuplicateKeyForMobile(input.prospectMobileHash);

    await this.db.batch([
      this.db.prepare(
        `update referrals
         set active_duplicate_key = null,
             status = case when status in ('accepted', 'active') then 'expired' else status end,
             expired_at = coalesce(expired_at, ?),
             updated_at = ?
         where organisation_id = ?
           and prospect_mobile_hash = ?
           and active_duplicate_key is not null
           and valid_until < ?`,
      ).bind(input.submittedAt, input.submittedAt, input.organisationId, input.prospectMobileHash, input.submittedAt),
      this.db.prepare(
        `insert into enquiries
          (id, organisation_id, branch_id, person_id, enquiry_number, mobile_used, course_interest_id,
           source, source_detail, counsellor_login_account_id, status, pipeline_stage, created_at, updated_at)
         values (?, ?, ?, null, ?, ?, ?, 'referral', ?, null, 'new', 'new', ?, ?)`,
      ).bind(
        enquiryId,
        input.organisationId,
        input.branchId,
        enquiryNumber,
        input.prospectMobileHash,
        input.courseId,
        `${input.programme.code}:${referralId}`,
        input.submittedAt,
        input.submittedAt,
      ),
      this.db.prepare(
        `insert into referrals
          (id, organisation_id, branch_id, referral_programme_id, referral_link_id, referrer_profile_id,
           prospect_person_id, enquiry_id, course_interest_id, source, status, submitted_at, valid_until,
           attributed_at, prospect_name, prospect_mobile_hash, prospect_mobile_last_four, prospect_mobile_ciphertext,
           prospect_email_ciphertext, consent_recorded_at, idempotency_key_hash, idempotency_payload_hash,
           active_duplicate_key, education_partner_id, partner_commission_basis_points, gst_basis_points_applicable,
           created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, null, ?, ?, 'personal_link', 'accepted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        referralId,
        input.organisationId,
        input.branchId,
        input.programme.id,
        input.link.id,
        input.link.referrer_profile_id,
        enquiryId,
        input.courseId,
        input.submittedAt,
        input.validUntil,
        input.submittedAt,
        input.prospectName,
        input.prospectMobileHash,
        input.prospectMobileLastFour,
        input.prospectMobileCiphertext,
        input.prospectEmailCiphertext || null,
        input.submittedAt,
        input.idempotencyKeyHash || null,
        input.idempotencyPayloadHash || null,
        activeDuplicateKey,
        input.educationPartnerId || null,
        input.partnerCommissionBasisPoints ?? null,
        input.gstBasisPointsApplicable ?? null,
        input.submittedAt,
        input.submittedAt,
      ),
      this.db.prepare(
        `insert into referral_status_events
          (id, referral_id, from_status, to_status, event_type, actor_login_account_id, actor_person_id,
           system_actor, reason_code, public_note, internal_note, metadata_json, created_at)
         values (?, ?, null, 'accepted', 'referral_accepted', ?, ?, 'referral_service', null, null, null, ?, ?)`,
      ).bind(eventId, referralId, input.loginAccountId || null, input.personId || null, JSON.stringify({ source: "personal_link" }), input.submittedAt),
      this.db.prepare(
        `insert into audit_logs
          (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
         values (?, ?, ?, ?, ?, 'referral_enquiry_created', 'referral', ?, ?, ?)`,
      ).bind(
        auditId,
        input.organisationId,
        input.branchId,
        input.loginAccountId || null,
        input.personId || null,
        referralId,
        JSON.stringify({ enquiryId, programmeCode: input.programme.code, courseId: input.courseId }),
        input.submittedAt,
      ),
    ]);

    return { referralId, enquiryId, enquiryNumber };
  }
}

export function activeDuplicateKeyForMobile(mobileHash: string) {
  return `mobile:${mobileHash}`;
}

function buildEnquiryNumber(branchCode: string, nowIso: string) {
  const year = nowIso.slice(0, 4);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `ENQ-${branchCode.toUpperCase()}-${year}-${suffix}`;
}
