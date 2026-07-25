import { relations, sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    ...timestamps,
  },
  (table) => [
    uniqueIndex("branches_organisation_code_unique").on(table.organisationId, table.code),
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
    check("login_accounts_status_check", sql`${table.status} in ('active', 'suspended', 'disabled')`),
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
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("person_roles_person_role_branch_unique").on(table.personId, table.roleId, table.branchKey),
    index("person_roles_person_id_idx").on(table.personId),
    index("person_roles_role_id_idx").on(table.roleId),
    index("person_roles_branch_id_idx").on(table.branchId),
  ],
);

export const userSessions = sqliteTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    loginAccountId: text("login_account_id")
      .notNull()
      .references(() => loginAccounts.id),
    activePersonId: text("active_person_id").references(() => people.id),
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
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
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
    uniqueIndex("referrer_profiles_person_id_unique").on(table.personId),
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

export const organisationRelations = relations(organisations, ({ many }) => ({
  branches: many(branches),
  people: many(people),
  loginAccounts: many(loginAccounts),
  roles: many(roles),
}));
