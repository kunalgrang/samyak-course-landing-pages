import { relations, sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const organisations = sqliteTable(
  "organisations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull(),
    legalName: text("legal_name"),
    organisationType: text("organisation_type"),
    legalEntityType: text("legal_entity_type"),
    addressLine1: text("address_line1"),
    city: text("city"),
    stateRegion: text("state_region"),
    country: text("country"),
    postcode: text("postcode"),
    currency: text("currency"),
    timezone: text("timezone"),
    website: text("website"),
    logoUrl: text("logo_url"),
    taxIdentifiersJson: text("tax_identifiers_json"),
    termsAcceptedAt: text("terms_accepted_at"),
    termsVersion: text("terms_version"),
    termsAcceptedByGlobalIdentityId: text("terms_accepted_by_global_identity_id").references((): AnySQLiteColumn => globalIdentities.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organisations_slug_unique").on(table.slug),
    check("organisations_status_check", sql`${table.status} in ('active', 'inactive')`),
  ],
);

export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    status: text("status").notNull(),
    addressLine1: text("address_line1"),
    city: text("city"),
    stateRegion: text("state_region"),
    postcode: text("postcode"),
    country: text("country"),
    mobileHash: text("mobile_hash"),
    mobileLastFour: text("mobile_last_four"),
    email: text("email"),
    currency: text("currency"),
    operatingModel: text("operating_model"),
    centreStatus: text("centre_status").notNull().default("active"),
    taxIdentifiersJson: text("tax_identifiers_json"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("branches_organisation_code_unique").on(table.organisationId, table.code),
    uniqueIndex("branches_organisation_name_unique").on(table.organisationId, table.name),
    index("branches_organisation_id_idx").on(table.organisationId),
    check("branches_status_check", sql`${table.status} in ('active', 'inactive')`),
  ],
);

export const people = sqliteTable(
  "people",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    homeBranchId: text("home_branch_id").references(() => branches.id),
    fullName: text("full_name").notNull(),
    publicName: text("public_name"),
    dateOfBirth: text("date_of_birth"),
    status: text("status").notNull(),
    ...timestamps,
  },
  (table) => [
    index("people_organisation_id_idx").on(table.organisationId),
    index("people_home_branch_id_idx").on(table.homeBranchId),
    check("people_status_check", sql`${table.status} in ('active', 'inactive', 'archived')`),
  ],
);

export const personContacts = sqliteTable(
  "person_contacts",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    contactType: text("contact_type").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    displayValue: text("display_value"),
    lastFour: text("last_four"),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
    verifiedAt: text("verified_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("person_contacts_person_type_value_unique").on(
      table.personId,
      table.contactType,
      table.normalizedValue,
    ),
    index("person_contacts_person_id_idx").on(table.personId),
    index("person_contacts_type_value_idx").on(table.contactType, table.normalizedValue),
    check("person_contacts_contact_type_check", sql`${table.contactType} in ('mobile', 'email')`),
  ],
);

export const loginAccounts = sqliteTable(
  "login_accounts",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    globalIdentityId: text("global_identity_id").references((): AnySQLiteColumn => globalIdentities.id),
    organisationMembershipId: text("organisation_membership_id").references((): AnySQLiteColumn => organisationMemberships.id),
    mobileNormalized: text("mobile_normalized").notNull(),
    mobileHash: text("mobile_hash"),
    mobileLastFour: text("mobile_last_four").notNull(),
    loginEnabled: integer("login_enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status").notNull(),
    lastLoginAt: text("last_login_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("login_accounts_organisation_mobile_unique").on(table.organisationId, table.mobileNormalized),
    index("login_accounts_organisation_id_idx").on(table.organisationId),
    index("login_accounts_global_identity_id_idx").on(table.globalIdentityId),
    index("login_accounts_organisation_membership_id_idx").on(table.organisationMembershipId),
    check("login_accounts_status_check", sql`${table.status} in ('active', 'suspended', 'disabled')`),
  ],
);

export const globalIdentities = sqliteTable(
  "global_identities",
  {
    id: text("id").primaryKey(),
    mobileNormalized: text("mobile_normalized").notNull(),
    mobileHash: text("mobile_hash"),
    mobileLastFour: text("mobile_last_four").notNull(),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("global_identities_mobile_normalized_unique").on(table.mobileNormalized),
    index("global_identities_mobile_hash_idx").on(table.mobileHash),
    check("global_identities_status_check", sql`${table.status} in ('active', 'suspended', 'disabled')`),
  ],
);

export const organisationMemberships = sqliteTable(
  "organisation_memberships",
  {
    id: text("id").primaryKey(),
    globalIdentityId: text("global_identity_id")
      .notNull()
      .references(() => globalIdentities.id),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    loginAccountId: text("login_account_id")
      .notNull()
      .references(() => loginAccounts.id),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organisation_memberships_identity_org_unique").on(table.globalIdentityId, table.organisationId),
    uniqueIndex("organisation_memberships_login_account_unique").on(table.loginAccountId),
    index("organisation_memberships_org_status_idx").on(table.organisationId, table.status),
    check("organisation_memberships_status_check", sql`${table.status} in ('active', 'suspended', 'revoked')`),
  ],
);

export const loginAccountPeople = sqliteTable(
  "login_account_people",
  {
    loginAccountId: text("login_account_id")
      .notNull()
      .references(() => loginAccounts.id),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    accessType: text("access_type").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    isAvailable: integer("is_available", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.loginAccountId, table.personId] }),
    index("login_account_people_person_id_idx").on(table.personId),
    check(
      "login_account_people_access_type_check",
      sql`${table.accessType} in ('self', 'guardian', 'shared_family', 'staff')`,
    ),
  ],
);

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("roles_organisation_code_unique").on(table.organisationId, table.code),
    index("roles_organisation_id_idx").on(table.organisationId),
  ],
);

export const loginAccountRoles = sqliteTable(
  "login_account_roles",
  {
    loginAccountId: text("login_account_id")
      .notNull()
      .references(() => loginAccounts.id),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    branchId: text("branch_id").references(() => branches.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("login_account_roles_account_role_branch_unique").on(
      table.loginAccountId,
      table.roleId,
      table.branchId,
    ),
    index("login_account_roles_login_account_id_idx").on(table.loginAccountId),
    index("login_account_roles_role_id_idx").on(table.roleId),
    index("login_account_roles_branch_id_idx").on(table.branchId),
  ],
);

export const personRoles = sqliteTable(
  "person_roles",
  {
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    branchId: text("branch_id").references(() => branches.id),
    branchKey: text("branch_key").notNull().default(""),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("person_roles_person_role_branch_unique").on(table.personId, table.roleId, table.branchKey),
    index("person_roles_person_id_idx").on(table.personId),
    index("person_roles_role_id_idx").on(table.roleId),
    index("person_roles_branch_id_idx").on(table.branchId),
    index("person_roles_role_status_branch_idx").on(table.roleId, table.status, table.branchId),
    check("person_roles_status_check", sql`${table.status} in ('active', 'inactive')`),
  ],
);

export const userSessions = sqliteTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    loginAccountId: text("login_account_id")
      .notNull()
      .references(() => loginAccounts.id),
    organisationMembershipId: text("organisation_membership_id").references(() => organisationMemberships.id),
    activePersonId: text("active_person_id").references(() => people.id),
    activeSubjectType: text("active_subject_type").notNull().default("person"),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    revokedAt: text("revoked_at"),
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
  },
  (table) => [
    uniqueIndex("user_sessions_token_hash_unique").on(table.tokenHash),
    index("user_sessions_login_account_id_idx").on(table.loginAccountId),
    index("user_sessions_organisation_membership_id_idx").on(table.organisationMembershipId),
    index("user_sessions_active_subject_type_idx").on(table.activeSubjectType),
    index("user_sessions_expires_at_idx").on(table.expiresAt),
    index("user_sessions_revoked_at_idx").on(table.revokedAt),
  ],
);

export const otpChallenges = sqliteTable(
  "otp_challenges",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    loginAccountId: text("login_account_id").references(() => loginAccounts.id),
    mobileHash: text("mobile_hash").notNull(),
    mobileLastFour: text("mobile_last_four"),
    mobileCiphertext: text("mobile_ciphertext"),
    provider: text("provider").notNull(),
    providerRequestId: text("provider_request_id"),
    providerChallengeId: text("provider_challenge_id"),
    purpose: text("purpose").notNull(),
    status: text("status").notNull(),
    verificationAttempts: integer("verification_attempts").notNull().default(0),
    resendCount: integer("resend_count").notNull().default(0),
    lastSentAt: text("last_sent_at"),
    requestedAt: text("requested_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    verifiedAt: text("verified_at"),
    ipHash: text("ip_hash"),
  },
  (table) => [
    index("otp_challenges_mobile_hash_requested_at_idx").on(table.mobileHash, table.requestedAt),
    index("otp_challenges_ip_hash_requested_at_idx").on(table.ipHash, table.requestedAt),
    index("otp_challenges_login_account_id_idx").on(table.loginAccountId),
    index("otp_challenges_expires_at_idx").on(table.expiresAt),
    check("otp_challenges_provider_check", sql`${table.provider} in ('msg91', 'development', 'none')`),
    check("otp_challenges_purpose_check", sql`${table.purpose} in ('login')`),
    check(
      "otp_challenges_status_check",
      sql`${table.status} in ('requested', 'sent', 'verified', 'expired', 'failed', 'blocked')`,
    ),
  ],
);

export const referrerProfiles = sqliteTable(
  "referrer_profiles",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    personId: text("person_id").references(() => people.id),
    externalReferrerId: text("external_referrer_id").notNull(),
    referralToken: text("referral_token").notNull(),
    personalLink: text("personal_link").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastSyncedAt: text("last_synced_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("referrer_profiles_organisation_external_referrer_unique").on(
      table.organisationId,
      table.externalReferrerId,
    ),
    uniqueIndex("referrer_profiles_organisation_referral_token_unique").on(
      table.organisationId,
      table.referralToken,
    ),
    uniqueIndex("referrer_profiles_person_id_unique").on(table.personId).where(sql`${table.personId} is not null`),
    index("referrer_profiles_organisation_id_idx").on(table.organisationId),
  ],
);

export const authEvents = sqliteTable(
  "auth_events",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id").references(() => organisations.id),
    loginAccountId: text("login_account_id").references(() => loginAccounts.id),
    eventType: text("event_type").notNull(),
    resultCode: text("result_code").notNull(),
    mobileHash: text("mobile_hash"),
    mobileLastFour: text("mobile_last_four"),
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("auth_events_organisation_id_idx").on(table.organisationId),
    index("auth_events_login_account_id_idx").on(table.loginAccountId),
    index("auth_events_created_at_idx").on(table.createdAt),
  ],
);

export const signupVerifications = sqliteTable(
  "signup_verifications",
  {
    id: text("id").primaryKey(),
    challengeId: text("challenge_id")
      .notNull()
      .references(() => otpChallenges.id),
    globalIdentityId: text("global_identity_id")
      .notNull()
      .references(() => globalIdentities.id),
    mobileHash: text("mobile_hash").notNull(),
    mobileLastFour: text("mobile_last_four").notNull(),
    status: text("status").notNull().default("verified"),
    createdOrganisationId: text("created_organisation_id").references(() => organisations.id),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (table) => [
    uniqueIndex("signup_verifications_challenge_unique").on(table.challengeId),
    index("signup_verifications_global_identity_idx").on(table.globalIdentityId, table.status),
    check("signup_verifications_status_check", sql`${table.status} in ('verified', 'used', 'expired')`),
  ],
);

export const organisationAccountAuthorities = sqliteTable(
  "organisation_account_authorities",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    globalIdentityId: text("global_identity_id")
      .notNull()
      .references(() => globalIdentities.id),
    organisationMembershipId: text("organisation_membership_id")
      .notNull()
      .references(() => organisationMemberships.id),
    personId: text("person_id").references(() => people.id),
    authorityType: text("authority_type").notNull().default("primary"),
    contactName: text("contact_name").notNull(),
    mobileHash: text("mobile_hash").notNull(),
    mobileLastFour: text("mobile_last_four").notNull(),
    email: text("email").notNull(),
    authorisationRequired: integer("authorisation_required", { mode: "boolean" }).notNull().default(false),
    authorisationStatus: text("authorisation_status").notNull().default("not_required"),
    documentReference: text("document_reference"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organisation_account_authorities_primary_unique").on(table.organisationId).where(sql`${table.authorityType} = 'primary' and ${table.status} = 'active'`),
    index("organisation_account_authorities_org_status_idx").on(table.organisationId, table.status),
    check("organisation_account_authorities_type_check", sql`${table.authorityType} in ('primary', 'authorised')`),
    check("organisation_account_authorities_auth_status_check", sql`${table.authorisationStatus} in ('not_required', 'pending_document', 'pending_review', 'verified')`),
    check("organisation_account_authorities_status_check", sql`${table.status} in ('active', 'inactive')`),
  ],
);

export const organisationCommercialAccess = sqliteTable(
  "organisation_commercial_access",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    state: text("state").notNull(),
    trialStartedAt: text("trial_started_at").notNull(),
    trialEndsAt: text("trial_ends_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organisation_commercial_access_org_unique").on(table.organisationId),
    index("organisation_commercial_access_state_idx").on(table.state, table.trialEndsAt),
    check("organisation_commercial_access_state_check", sql`${table.state} in ('trial', 'active', 'past_due', 'grace', 'restricted_read_only', 'expired', 'suspended')`),
  ],
);

export const organisationOnboardingProgress = sqliteTable(
  "organisation_onboarding_progress",
  {
    organisationId: text("organisation_id")
      .primaryKey()
      .references(() => organisations.id),
    status: text("status").notNull().default("in_progress"),
    completedStepsJson: text("completed_steps_json").notNull().default("[]"),
    checklistJson: text("checklist_json").notNull(),
    ...timestamps,
  },
  (table) => [
    index("organisation_onboarding_progress_status_idx").on(table.status),
    check("organisation_onboarding_progress_status_check", sql`${table.status} in ('in_progress', 'complete')`),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id").references(() => organisations.id),
    branchId: text("branch_id").references(() => branches.id),
    actorLoginAccountId: text("actor_login_account_id").references(() => loginAccounts.id),
    actorPersonId: text("actor_person_id").references(() => people.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    oldValuesJson: text("old_values_json"),
    newValuesJson: text("new_values_json"),
    metadataJson: text("metadata_json"),
    ipHash: text("ip_hash"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("audit_logs_organisation_id_idx").on(table.organisationId),
    index("audit_logs_branch_id_idx").on(table.branchId),
    index("audit_logs_actor_login_account_id_idx").on(table.actorLoginAccountId),
    index("audit_logs_actor_person_id_idx").on(table.actorPersonId),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

export const classSessions = sqliteTable(
  "class_sessions",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    batchId: text("batch_id")
      .notNull(),
    trainerPersonId: text("trainer_person_id")
      .notNull()
      .references(() => people.id),
    sessionDate: text("session_date").notNull(),
    scheduledStartTime: text("scheduled_start_time"),
    scheduledEndTime: text("scheduled_end_time"),
    actualStartedAt: text("actual_started_at"),
    actualEndedAt: text("actual_ended_at"),
    teachingNote: text("teaching_note").notNull().default(""),
    status: text("status").notNull().default("open"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    createdByActorId: text("created_by_actor_id").references(() => loginAccounts.id),
  },
  (table) => [
    uniqueIndex("class_sessions_batch_date_start_unique").on(table.organisationId, table.batchId, table.sessionDate, table.scheduledStartTime),
    index("class_sessions_org_trainer_date_idx").on(table.organisationId, table.trainerPersonId, table.sessionDate),
    index("class_sessions_batch_date_idx").on(table.batchId, table.sessionDate),
    index("class_sessions_batch_status_idx").on(table.batchId, table.status),
    check("class_sessions_status_check", sql`${table.status} in ('open', 'completed', 'cancelled')`),
    check("class_sessions_version_check", sql`${table.version} > 0`),
  ],
);

export const attendanceRecords = sqliteTable(
  "attendance_records",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    classSessionId: text("class_session_id")
      .notNull()
      .references(() => classSessions.id),
    batchMembershipId: text("batch_membership_id").notNull(),
    enrolmentId: text("enrolment_id").notNull(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    status: text("status").notNull(),
    markedByActorId: text("marked_by_actor_id").references(() => loginAccounts.id),
    markedAt: text("marked_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("attendance_records_session_membership_unique").on(table.classSessionId, table.batchMembershipId),
    index("attendance_records_session_idx").on(table.classSessionId),
    index("attendance_records_enrolment_idx").on(table.enrolmentId),
    index("attendance_records_membership_idx").on(table.batchMembershipId),
    index("attendance_records_org_person_idx").on(table.organisationId, table.personId),
    check("attendance_records_status_check", sql`${table.status} in ('present', 'absent')`),
  ],
);

export const organisationRelations = relations(organisations, ({ many }) => ({
  branches: many(branches),
  people: many(people),
  loginAccounts: many(loginAccounts),
  roles: many(roles),
}));
