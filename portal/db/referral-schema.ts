import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { branches, loginAccounts, organisations, people, referrerProfiles } from "./schema";
import { courses, enrolments, enquiries, feeAgreements } from "./student-master-schema";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const referralProgrammes = sqliteTable(
  "referral_programmes",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    validityDays: integer("validity_days").notNull(),
    minimumFeePercentage: integer("minimum_fee_percentage").notNull(),
    status: text("status").notNull().default("draft"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("referral_programmes_organisation_code_unique").on(table.organisationId, table.code),
    index("referral_programmes_organisation_status_idx").on(table.organisationId, table.status),
    check("referral_programmes_validity_days_check", sql`${table.validityDays} between 1 and 365`),
    check("referral_programmes_min_fee_pct_check", sql`${table.minimumFeePercentage} between 0 and 100`),
    check("referral_programmes_status_check", sql`${table.status} in ('draft', 'active', 'inactive', 'archived')`),
    check("referral_programmes_dates_check", sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} >= ${table.startsAt}`),
  ],
);

export const referralProgrammeReferrerTypes = sqliteTable(
  "referral_programme_referrer_types",
  {
    referralProgrammeId: text("referral_programme_id")
      .notNull()
      .references(() => referralProgrammes.id),
    referrerType: text("referrer_type").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.referralProgrammeId, table.referrerType] }),
    index("referral_programme_referrer_types_type_idx").on(table.referrerType),
    index("referral_programme_referrer_types_programme_idx").on(table.referralProgrammeId),
    check("referral_programme_referrer_types_type_check", sql`${table.referrerType} in ('student', 'alumni', 'education_partner')`),
  ],
);

export const educationPartners = sqliteTable(
  "education_partners",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id").notNull().references(() => organisations.id),
    homeBranchId: text("home_branch_id").notNull().references(() => branches.id),
    partnerType: text("partner_type").notNull(),
    businessName: text("business_name").notNull(),
    contactPersonName: text("contact_person_name").notNull(),
    mobileHash: text("mobile_hash"),
    mobileLastFour: text("mobile_last_four"),
    mobileCiphertext: text("mobile_ciphertext"),
    emailHash: text("email_hash"),
    emailCiphertext: text("email_ciphertext"),
    status: text("status").notNull().default("active"),
    currentCommissionBasisPoints: integer("current_commission_basis_points").notNull(),
    internalNotes: text("internal_notes"),
    createdByLoginAccountId: text("created_by_login_account_id").references(() => loginAccounts.id),
    ...timestamps,
  },
  (table) => [
    index("education_partners_org_status_name_idx").on(table.organisationId, table.status, table.businessName),
    index("education_partners_branch_status_idx").on(table.homeBranchId, table.status),
    index("education_partners_mobile_hash_idx").on(table.organisationId, table.mobileHash),
    index("education_partners_email_hash_idx").on(table.organisationId, table.emailHash),
    check("education_partners_type_check", sql`${table.partnerType} in ('college', 'coaching_class', 'tuition_centre', 'training_institute', 'career_counsellor', 'placement_consultant', 'freelancer', 'other')`),
    check("education_partners_status_check", sql`${table.status} in ('active', 'inactive')`),
    check("education_partners_commission_bps_check", sql`${table.currentCommissionBasisPoints} between 0 and 10000`),
    check("education_partners_active_commission_check", sql`${table.status} != 'active' or ${table.currentCommissionBasisPoints} > 0`),
  ],
);

export const educationPartnerReferrerProfiles = sqliteTable(
  "education_partner_referrer_profiles",
  {
    educationPartnerId: text("education_partner_id").notNull().references(() => educationPartners.id),
    referrerProfileId: text("referrer_profile_id").notNull().references(() => referrerProfiles.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.educationPartnerId, table.referrerProfileId] }),
    uniqueIndex("education_partner_referrer_profiles_profile_unique").on(table.referrerProfileId),
    uniqueIndex("education_partner_referrer_profiles_partner_unique").on(table.educationPartnerId),
  ],
);

export const referralProgrammeCourses = sqliteTable(
  "referral_programme_courses",
  {
    referralProgrammeId: text("referral_programme_id")
      .notNull()
      .references(() => referralProgrammes.id),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.referralProgrammeId, table.courseId] }),
    index("referral_programme_courses_course_id_idx").on(table.courseId),
    index("referral_programme_courses_programme_active_idx").on(table.referralProgrammeId, table.isActive),
  ],
);

export const referralLinks = sqliteTable(
  "referral_links",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    referralProgrammeId: text("referral_programme_id")
      .notNull()
      .references(() => referralProgrammes.id),
    referrerProfileId: text("referrer_profile_id")
      .notNull()
      .references(() => referrerProfiles.id),
    tokenHash: text("token_hash").notNull(),
    tokenLastFour: text("token_last_four"),
    linkVersion: integer("link_version").notNull().default(1),
    status: text("status").notNull().default("active"),
    activatedAt: text("activated_at"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("referral_links_organisation_token_hash_unique").on(table.organisationId, table.tokenHash),
    uniqueIndex("referral_links_one_active_referrer_programme_unique")
      .on(table.organisationId, table.referralProgrammeId, table.referrerProfileId)
      .where(sql`${table.status} = 'active'`),
    index("referral_links_referrer_status_idx").on(table.referrerProfileId, table.status),
    index("referral_links_programme_status_idx").on(table.referralProgrammeId, table.status),
    index("referral_links_expires_at_idx").on(table.expiresAt),
    check("referral_links_status_check", sql`${table.status} in ('active', 'revoked', 'expired')`),
    check("referral_links_version_check", sql`${table.linkVersion} >= 1`),
    check("referral_links_revoked_at_check", sql`${table.status} != 'revoked' or ${table.revokedAt} is not null`),
    check("referral_links_expiry_check", sql`${table.expiresAt} is null or ${table.activatedAt} is null or ${table.expiresAt} > ${table.activatedAt}`),
  ],
);

export const referralLinkSecrets = sqliteTable(
  "referral_link_secrets",
  {
    referralLinkId: text("referral_link_id")
      .primaryKey()
      .references(() => referralLinks.id, { onDelete: "cascade" }),
    tokenCiphertext: text("token_ciphertext").notNull(),
    encryptionVersion: text("encryption_version").notNull().default("v1"),
    ...timestamps,
  },
  (table) => [
    check("referral_link_secrets_ciphertext_check", sql`${table.tokenCiphertext} like 'v1:%'`),
  ],
);

export const referrals = sqliteTable(
  "referrals",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    referralProgrammeId: text("referral_programme_id")
      .notNull()
      .references(() => referralProgrammes.id),
    referralLinkId: text("referral_link_id").references(() => referralLinks.id),
    referrerProfileId: text("referrer_profile_id")
      .notNull()
      .references(() => referrerProfiles.id),
    prospectPersonId: text("prospect_person_id").references(() => people.id),
    enquiryId: text("enquiry_id").references(() => enquiries.id),
    courseInterestId: text("course_interest_id").references(() => courses.id),
    source: text("source").notNull(),
    status: text("status").notNull().default("submitted"),
    submittedAt: text("submitted_at").notNull(),
    validUntil: text("valid_until").notNull(),
    attributedAt: text("attributed_at"),
    expiredAt: text("expired_at"),
    closedAt: text("closed_at"),
    closureReason: text("closure_reason"),
    prospectName: text("prospect_name").notNull(),
    prospectMobileHash: text("prospect_mobile_hash").notNull(),
    prospectMobileLastFour: text("prospect_mobile_last_four"),
    prospectMobileCiphertext: text("prospect_mobile_ciphertext"),
    prospectEmailCiphertext: text("prospect_email_ciphertext"),
    consentRecordedAt: text("consent_recorded_at"),
    idempotencyKeyHash: text("idempotency_key_hash"),
    idempotencyPayloadHash: text("idempotency_payload_hash"),
    activeDuplicateKey: text("active_duplicate_key"),
    educationPartnerId: text("education_partner_id").references(() => educationPartners.id),
    partnerCommissionBasisPoints: integer("partner_commission_basis_points"),
    gstBasisPointsApplicable: integer("gst_basis_points_applicable"),
    ...timestamps,
  },
  (table) => [
    index("referrals_organisation_status_idx").on(table.organisationId, table.status),
    index("referrals_branch_status_idx").on(table.branchId, table.status),
    index("referrals_referrer_submitted_idx").on(table.referrerProfileId, table.submittedAt),
    index("referrals_enquiry_id_idx").on(table.enquiryId),
    uniqueIndex("referrals_enquiry_unique").on(table.enquiryId).where(sql`${table.enquiryId} is not null`),
    index("referrals_prospect_person_idx").on(table.prospectPersonId),
    index("referrals_course_interest_idx").on(table.courseInterestId),
    index("referrals_valid_until_idx").on(table.validUntil),
    index("referrals_mobile_status_valid_idx").on(table.prospectMobileHash, table.status, table.validUntil),
    uniqueIndex("referrals_organisation_idempotency_unique")
      .on(table.organisationId, table.idempotencyKeyHash)
      .where(sql`${table.idempotencyKeyHash} is not null`),
    index("referrals_organisation_mobile_status_valid_idx").on(table.organisationId, table.prospectMobileHash, table.status, table.validUntil),
    uniqueIndex("referrals_active_duplicate_unique")
      .on(table.organisationId, table.activeDuplicateKey)
      .where(sql`${table.activeDuplicateKey} is not null`),
    index("referrals_idempotency_payload_idx").on(table.organisationId, table.idempotencyKeyHash, table.idempotencyPayloadHash),
    check("referrals_source_check", sql`${table.source} in ('personal_link', 'staff_entry', 'import')`),
    check("referrals_status_check", sql`${table.status} in ('submitted', 'accepted', 'rejected', 'active', 'converted', 'expired', 'cancelled', 'closed')`),
    check(
      "referrals_closure_reason_check",
      sql`${table.closureReason} is null or ${table.closureReason} in ('existing_enquiry', 'current_student', 'former_student', 'active_duplicate', 'invalid_mobile', 'invalid_link', 'inactive_programme', 'ineligible_course', 'consent_missing', 'expired', 'admission_cancelled', 'manual_closure')`,
    ),
    check("referrals_validity_check", sql`${table.validUntil} > ${table.submittedAt}`),
  ],
);

export const referralStatusEvents = sqliteTable(
  "referral_status_events",
  {
    id: text("id").primaryKey(),
    referralId: text("referral_id")
      .notNull()
      .references(() => referrals.id),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    eventType: text("event_type").notNull(),
    actorLoginAccountId: text("actor_login_account_id").references(() => loginAccounts.id),
    actorPersonId: text("actor_person_id").references(() => people.id),
    systemActor: text("system_actor"),
    reasonCode: text("reason_code"),
    publicNote: text("public_note"),
    internalNote: text("internal_note"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("referral_status_events_referral_created_idx").on(table.referralId, table.createdAt),
    index("referral_status_events_actor_login_idx").on(table.actorLoginAccountId),
    index("referral_status_events_event_created_idx").on(table.eventType, table.createdAt),
    check(
      "referral_status_events_from_status_check",
      sql`${table.fromStatus} is null or ${table.fromStatus} in ('submitted', 'accepted', 'rejected', 'active', 'converted', 'expired', 'cancelled', 'closed')`,
    ),
    check("referral_status_events_to_status_check", sql`${table.toStatus} in ('submitted', 'accepted', 'rejected', 'active', 'converted', 'expired', 'cancelled', 'closed')`),
    check("referral_status_events_actor_check", sql`${table.actorLoginAccountId} is not null or ${table.systemActor} is not null`),
  ],
);

export const referralRewardRuleSets = sqliteTable(
  "referral_reward_rule_sets",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    referralProgrammeId: text("referral_programme_id")
      .notNull()
      .references(() => referralProgrammes.id),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    effectiveFrom: text("effective_from"),
    effectiveUntil: text("effective_until"),
    createdByLoginAccountId: text("created_by_login_account_id").references(() => loginAccounts.id),
    rewardModelType: text("reward_model_type").notNull().default("fee_slab"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("referral_reward_rule_sets_programme_version_unique").on(table.referralProgrammeId, table.version),
    uniqueIndex("referral_reward_rule_sets_one_active_unique")
      .on(table.referralProgrammeId)
      .where(sql`${table.status} = 'active'`),
    index("referral_reward_rule_sets_org_status_idx").on(table.organisationId, table.status),
    check("referral_reward_rule_sets_version_check", sql`${table.version} >= 1`),
    check("referral_reward_rule_sets_status_check", sql`${table.status} in ('draft', 'active', 'superseded', 'archived')`),
    check("referral_reward_rule_sets_dates_check", sql`${table.effectiveUntil} is null or ${table.effectiveFrom} is null or ${table.effectiveUntil} >= ${table.effectiveFrom}`),
  ],
);

export const referralRewardSlabs = sqliteTable(
  "referral_reward_slabs",
  {
    id: text("id").primaryKey(),
    rewardRuleSetId: text("reward_rule_set_id")
      .notNull()
      .references(() => referralRewardRuleSets.id),
    minFinalFeePaise: integer("min_final_fee_paise").notNull(),
    maxFinalFeePaise: integer("max_final_fee_paise"),
    cashRewardPaise: integer("cash_reward_paise").notNull(),
    courseCreditPaise: integer("course_credit_paise").notNull(),
    sortOrder: integer("sort_order").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("referral_reward_slabs_rule_sort_unique").on(table.rewardRuleSetId, table.sortOrder),
    index("referral_reward_slabs_rule_set_idx").on(table.rewardRuleSetId),
    check("referral_reward_slabs_money_check", sql`${table.minFinalFeePaise} >= 0 and (${table.maxFinalFeePaise} is null or ${table.maxFinalFeePaise} >= ${table.minFinalFeePaise}) and ${table.cashRewardPaise} >= 0 and ${table.courseCreditPaise} >= 0`),
  ],
);

export const referralRewardSnapshots = sqliteTable(
  "referral_reward_snapshots",
  {
    id: text("id").primaryKey(),
    referralId: text("referral_id")
      .notNull()
      .references(() => referrals.id),
    enrolmentId: text("enrolment_id")
      .notNull()
      .references(() => enrolments.id),
    feeAgreementId: text("fee_agreement_id")
      .notNull()
      .references(() => feeAgreements.id),
    rewardRuleSetId: text("reward_rule_set_id")
      .notNull()
      .references(() => referralRewardRuleSets.id),
    slabId: text("slab_id").references(() => referralRewardSlabs.id),
    finalAgreedFeePaise: integer("final_agreed_fee_paise").notNull(),
    minimumFeePercentage: integer("minimum_fee_percentage").notNull(),
    minimumQualifyingPaymentPaise: integer("minimum_qualifying_payment_paise").notNull(),
    cashRewardPaise: integer("cash_reward_paise").notNull(),
    courseCreditPaise: integer("course_credit_paise").notNull(),
    rewardModelType: text("reward_model_type").notNull().default("fee_slab"),
    educationPartnerId: text("education_partner_id").references(() => educationPartners.id),
    partnerCommissionBasisPoints: integer("partner_commission_basis_points"),
    gstBasisPointsApplicable: integer("gst_basis_points_applicable"),
    preGstFinalFeePaise: integer("pre_gst_final_fee_paise"),
    snapshotVersion: integer("snapshot_version").notNull().default(1),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("referral_reward_snapshots_referral_enrolment_unique").on(table.referralId, table.enrolmentId),
    index("referral_reward_snapshots_enrolment_idx").on(table.enrolmentId),
    index("referral_reward_snapshots_fee_agreement_idx").on(table.feeAgreementId),
    check("referral_reward_snapshots_money_check", sql`${table.finalAgreedFeePaise} >= 0 and ${table.minimumQualifyingPaymentPaise} >= 0 and ${table.cashRewardPaise} >= 0 and ${table.courseCreditPaise} >= 0`),
    check("referral_reward_snapshots_pct_check", sql`${table.minimumFeePercentage} between 0 and 100`),
    check("referral_reward_snapshots_version_check", sql`${table.snapshotVersion} >= 1`),
  ],
);
