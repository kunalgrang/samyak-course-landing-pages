import type { AppContext } from "./http";
import { createOpaqueId, daysFromNow, hmacHex } from "./crypto";
import { mobileHash } from "./auth-store";

export const SIGNUP_TRIAL_DAYS = 15;
export const SIGNUP_TERMS_VERSION = "2026-09-24";

export const ORGANISATION_TYPES = [
  "computer_training_institute",
  "coaching_centre",
  "vocational_institute",
  "language_institute",
  "corporate_training_provider",
  "tuition_centre",
  "other",
] as const;

export const LEGAL_ENTITY_TYPES = [
  "proprietorship",
  "partnership",
  "llp",
  "private_limited",
  "public_limited",
  "trust_society",
  "individual",
  "other",
] as const;

export const CENTRE_OPERATING_MODELS = ["company_owned", "franchise_operated"] as const;
export const CENTRE_STATUSES = ["active", "suspended", "closed"] as const;

export type OrganisationSignupInput = {
  signupVerificationId: string;
  idempotencyKey: string;
  organisation: {
    brandName: string;
    legalName: string;
    organisationType: typeof ORGANISATION_TYPES[number];
    legalEntityType: typeof LEGAL_ENTITY_TYPES[number];
    address: string;
    city: string;
    stateRegion: string;
    country: string;
    postcode?: string;
    website?: string;
    logoUrl?: string;
    pan?: string;
    gstin?: string;
    currency?: string;
    timezone?: string;
    termsAccepted: boolean;
  };
  authority: {
    name: string;
    mobile: string;
    email: string;
    documentReference?: string;
  };
  centre: {
    name: string;
    address: string;
    city: string;
    stateRegion: string;
    postcode: string;
    country: string;
    mobile: string;
    email?: string;
    operatingModel: typeof CENTRE_OPERATING_MODELS[number];
    status: typeof CENTRE_STATUSES[number];
    currency?: string;
    timezone?: string;
    pan?: string;
    gstin?: string;
  };
};

type SignupVerificationRow = {
  id: string;
  global_identity_id: string;
  mobile_hash: string;
  mobile_last_four: string;
  status: string;
  created_organisation_id: string | null;
  expires_at: string;
};

export function countryDefaults(country: string) {
  const normalized = country.trim().toUpperCase();
  if (normalized === "IN" || normalized === "INDIA") return { country: "India", currency: "INR", timezone: "Asia/Kolkata" };
  return { country: country.trim(), currency: "USD", timezone: "UTC" };
}

export function requiresAuthorisationDocument(legalEntityType: string) {
  return ["partnership", "llp", "private_limited", "public_limited"].includes(legalEntityType);
}

export async function createSignupVerification(c: AppContext, challengeId: string, mobile: string) {
  const hash = await mobileHash(c, mobile);
  const now = new Date().toISOString();
  const globalIdentityId = createOpaqueId("gident");
  await c.env.DB.prepare(
    `insert into global_identities (id, mobile_normalized, mobile_hash, mobile_last_four, status, created_at, updated_at)
     values (?, ?, ?, ?, 'active', ?, ?)
     on conflict(mobile_normalized) do update set
       mobile_hash = coalesce(global_identities.mobile_hash, excluded.mobile_hash),
       mobile_last_four = excluded.mobile_last_four,
       updated_at = excluded.updated_at`,
  )
    .bind(globalIdentityId, hash, hash, mobile.slice(-4), now, now)
    .run();

  const identity = await c.env.DB.prepare("select id from global_identities where mobile_normalized = ?")
    .bind(hash)
    .first<{ id: string }>();
  if (!identity) throw new Error("Global identity creation failed");

  const id = createOpaqueId("signup");
  await c.env.DB.prepare(
    `insert into signup_verifications (id, challenge_id, global_identity_id, mobile_hash, mobile_last_four, status, created_at, expires_at)
     values (?, ?, ?, ?, ?, 'verified', ?, ?)`,
  )
    .bind(id, challengeId, identity.id, hash, mobile.slice(-4), now, daysFromNow(1))
    .run();
  return { signupVerificationId: id };
}

export async function createOrganisationFromSignup(c: AppContext, input: OrganisationSignupInput) {
  const verification = await c.env.DB.prepare("select * from signup_verifications where id = ?")
    .bind(input.signupVerificationId)
    .first<SignupVerificationRow>();
  if (!verification || Date.parse(verification.expires_at) <= Date.now()) {
    return { ok: false as const, status: 403, code: "SIGNUP_VERIFICATION_REQUIRED", message: "Please verify your mobile number again." };
  }
  if (verification.created_organisation_id) {
    return loadSignupResult(c, verification.created_organisation_id);
  }
  if (verification.status !== "verified") {
    return { ok: false as const, status: 403, code: "SIGNUP_VERIFICATION_REQUIRED", message: "Please verify your mobile number again." };
  }

  const validation = await validateSignupInput(c, input, verification);
  if (!validation.ok) return validation;

  const now = new Date().toISOString();
  const orgDefaults = countryDefaults(input.organisation.country);
  const centreDefaults = countryDefaults(input.centre.country);
  const organisationId = createOpaqueId("org");
  const branchId = createOpaqueId("branch");
  const branchCode = await nextCentreCode(c, organisationId);
  const personId = createOpaqueId("person");
  const accountId = createOpaqueId("acct");
  const membershipId = createOpaqueId("omem");
  const ownerRoleId = createOpaqueId("role");
  const authorityId = createOpaqueId("auth");
  const trialId = createOpaqueId("access");
  const trialEndsAt = daysFromNow(SIGNUP_TRIAL_DAYS, new Date(now));
  const authorityMobileHash = await mobileHash(c, input.authority.mobile);
  const centreMobileHash = await mobileHash(c, input.centre.mobile);
  const taxIdentifiers = taxJson(input.organisation.pan, input.organisation.gstin);
  const centreTaxIdentifiers = taxJson(input.centre.pan, input.centre.gstin);
  const authorisationRequired = requiresAuthorisationDocument(input.organisation.legalEntityType);
  const checklist = JSON.stringify([
    { code: "organisation_profile", label: "Organisation profile", done: true },
    { code: "centre_profile", label: "Centre profile", done: true },
    { code: "owner_account", label: "Owner account", done: true },
    { code: "courses", label: "Courses", done: false },
    { code: "fees", label: "Fees", done: false },
    { code: "staff_invitations", label: "Staff invitations", done: false },
    { code: "branding", label: "Branding", done: false },
    { code: "data_import", label: "Data import", done: false },
  ]);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into organisations (
        id, name, slug, status, legal_name, organisation_type, legal_entity_type,
        address_line1, city, state_region, country, postcode, currency, timezone,
        website, logo_url, tax_identifiers_json, terms_accepted_at, terms_version,
        terms_accepted_by_global_identity_id, created_at, updated_at
      ) values (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      organisationId,
      input.organisation.brandName.trim(),
      uniqueSlug(organisationId),
      input.organisation.legalName.trim(),
      input.organisation.organisationType,
      input.organisation.legalEntityType,
      input.organisation.address.trim(),
      input.organisation.city.trim(),
      input.organisation.stateRegion.trim(),
      orgDefaults.country,
      cleanOptional(input.organisation.postcode),
      cleanOptional(input.organisation.currency) || orgDefaults.currency,
      cleanOptional(input.organisation.timezone) || orgDefaults.timezone,
      cleanOptional(input.organisation.website),
      cleanOptional(input.organisation.logoUrl),
      taxIdentifiers,
      now,
      SIGNUP_TERMS_VERSION,
      verification.global_identity_id,
      now,
      now,
    ),
    c.env.DB.prepare(
      `insert into branches (
        id, organisation_id, name, code, timezone, status, address_line1, city,
        state_region, postcode, country, mobile_hash, mobile_last_four, email,
        currency, operating_model, centre_status, tax_identifiers_json, created_at, updated_at
      ) values (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      branchId,
      organisationId,
      input.centre.name.trim(),
      branchCode,
      cleanOptional(input.centre.timezone) || centreDefaults.timezone,
      input.centre.address.trim(),
      input.centre.city.trim(),
      input.centre.stateRegion.trim(),
      input.centre.postcode.trim(),
      centreDefaults.country,
      centreMobileHash,
      input.centre.mobile.slice(-4),
      cleanOptional(input.centre.email),
      cleanOptional(input.centre.currency) || centreDefaults.currency,
      input.centre.operatingModel,
      input.centre.status,
      centreTaxIdentifiers,
      now,
      now,
    ),
    c.env.DB.prepare("insert into roles (id, organisation_id, code, name, created_at) values (?, ?, 'owner', 'Owner', ?)").bind(ownerRoleId, organisationId, now),
    c.env.DB.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, ?, ?, ?, ?, 'active', ?, ?)")
      .bind(personId, organisationId, branchId, input.authority.name.trim(), input.authority.name.trim(), now, now),
    c.env.DB.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, verified_at, created_at, updated_at) values (?, ?, 'mobile', ?, ?, ?, 1, 1, ?, ?, ?)")
      .bind(createOpaqueId("contact"), personId, authorityMobileHash, `******${input.authority.mobile.slice(-4)}`, input.authority.mobile.slice(-4), now, now, now),
    c.env.DB.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, verified_at, created_at, updated_at) values (?, ?, 'email', ?, ?, null, 1, 0, null, ?, ?)")
      .bind(createOpaqueId("contact"), personId, input.authority.email.trim().toLowerCase(), input.authority.email.trim(), now, now),
    c.env.DB.prepare(
      `insert into login_accounts (
        id, organisation_id, global_identity_id, organisation_membership_id, mobile_normalized, mobile_hash,
        mobile_last_four, login_enabled, status, last_login_at, created_at, updated_at
      ) values (?, ?, ?, null, ?, ?, ?, 1, 'active', ?, ?, ?)`,
    ).bind(accountId, organisationId, verification.global_identity_id, verification.mobile_hash, verification.mobile_hash, verification.mobile_last_four, now, now, now),
    c.env.DB.prepare("insert into organisation_memberships (id, global_identity_id, organisation_id, login_account_id, status, created_at, updated_at) values (?, ?, ?, ?, 'active', ?, ?)")
      .bind(membershipId, verification.global_identity_id, organisationId, accountId, now, now),
    c.env.DB.prepare("update login_accounts set organisation_membership_id = ?, updated_at = ? where id = ?")
      .bind(membershipId, now, accountId),
    c.env.DB.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values (?, ?, 'staff', 1, 1, ?)")
      .bind(accountId, personId, now),
    c.env.DB.prepare("insert into login_account_roles (login_account_id, role_id, branch_id, created_at) values (?, ?, null, ?)")
      .bind(accountId, ownerRoleId, now),
    c.env.DB.prepare("insert into person_roles (person_id, role_id, branch_id, branch_key, status, created_at) values (?, ?, null, '', 'active', ?)")
      .bind(personId, ownerRoleId, now),
    c.env.DB.prepare(
      `insert into organisation_account_authorities (
        id, organisation_id, global_identity_id, organisation_membership_id, person_id, authority_type,
        contact_name, mobile_hash, mobile_last_four, email, authorisation_required, authorisation_status,
        document_reference, status, created_at, updated_at
      ) values (?, ?, ?, ?, ?, 'primary', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(
      authorityId,
      organisationId,
      verification.global_identity_id,
      membershipId,
      personId,
      input.authority.name.trim(),
      authorityMobileHash,
      input.authority.mobile.slice(-4),
      input.authority.email.trim().toLowerCase(),
      authorisationRequired ? 1 : 0,
      authorisationRequired ? "pending_document" : "not_required",
      cleanOptional(input.authority.documentReference),
      now,
      now,
    ),
    c.env.DB.prepare("insert into organisation_commercial_access (id, organisation_id, state, trial_started_at, trial_ends_at, created_at, updated_at) values (?, ?, 'trial', ?, ?, ?, ?)")
      .bind(trialId, organisationId, now, trialEndsAt, now, now),
    c.env.DB.prepare("insert into organisation_onboarding_progress (organisation_id, status, completed_steps_json, checklist_json, created_at, updated_at) values (?, 'in_progress', ?, ?, ?, ?)")
      .bind(organisationId, JSON.stringify(["organisation_profile", "centre_profile", "owner_account"]), checklist, now, now),
    c.env.DB.prepare("update signup_verifications set status = 'used', created_organisation_id = ?, used_at = ? where id = ? and status = 'verified'")
      .bind(organisationId, now, verification.id),
    ...auditStatements(c, organisationId, branchId, accountId, personId, input.idempotencyKey, now, input.organisation.legalEntityType, trialEndsAt),
  ]);

  return loadSignupResult(c, organisationId);
}

async function validateSignupInput(c: AppContext, input: OrganisationSignupInput, verification: SignupVerificationRow) {
  if (!input.organisation.termsAccepted) return invalid("TERMS_REQUIRED", "Accept the platform terms and data policy to continue.");
  if (!nonEmpty(input.organisation.brandName) || !nonEmpty(input.organisation.legalName)) return invalid("ORGANISATION_REQUIRED", "Enter organisation name and legal name.");
  if (!ORGANISATION_TYPES.includes(input.organisation.organisationType)) return invalid("INVALID_ORGANISATION_TYPE", "Choose a supported organisation type.");
  if (!LEGAL_ENTITY_TYPES.includes(input.organisation.legalEntityType)) return invalid("INVALID_LEGAL_ENTITY_TYPE", "Choose a supported legal entity type.");
  for (const value of [input.organisation.address, input.organisation.city, input.organisation.stateRegion, input.organisation.country]) {
    if (!nonEmpty(value)) return invalid("ORGANISATION_ADDRESS_REQUIRED", "Enter the organisation address.");
  }
  if (!nonEmpty(input.authority.name) || !emailOk(input.authority.email)) return invalid("AUTHORITY_REQUIRED", "Enter valid authorised account contact details.");
  const authorityMobileHash = await mobileHash(c, input.authority.mobile);
  if (authorityMobileHash !== verification.mobile_hash) return invalid("AUTHORITY_MOBILE_MISMATCH", "The authorised contact mobile must match the verified mobile.");
  if (!nonEmpty(input.centre.name)) return invalid("CENTRE_REQUIRED", "Enter the initial Centre name.");
  if (!CENTRE_OPERATING_MODELS.includes(input.centre.operatingModel)) return invalid("INVALID_CENTRE_OPERATING_MODEL", "Choose a supported Centre operating model.");
  if (!CENTRE_STATUSES.includes(input.centre.status)) return invalid("INVALID_CENTRE_STATUS", "Choose a supported Centre status.");
  for (const value of [input.centre.address, input.centre.city, input.centre.stateRegion, input.centre.postcode, input.centre.country]) {
    if (!nonEmpty(value)) return invalid("CENTRE_ADDRESS_REQUIRED", "Enter the initial Centre address.");
  }
  if (!nonEmpty(input.centre.mobile)) return invalid("CENTRE_MOBILE_REQUIRED", "Enter the initial Centre mobile number.");
  if (input.centre.email && !emailOk(input.centre.email)) return invalid("CENTRE_EMAIL_INVALID", "Enter a valid Centre email.");
  if (input.organisation.country.toUpperCase() === "INDIA" || input.organisation.country.toUpperCase() === "IN") {
    if (input.organisation.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(input.organisation.pan.trim().toUpperCase())) return invalid("INVALID_PAN", "Enter a valid PAN format.");
    if (input.organisation.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(input.organisation.gstin.trim().toUpperCase())) return invalid("INVALID_GSTIN", "Enter a valid GSTIN format.");
  }
  return { ok: true as const };
}

async function loadSignupResult(c: AppContext, organisationId: string) {
  const row = await c.env.DB.prepare(
    `select organisations.id as organisation_id, organisations.name as organisation_name,
            organisation_memberships.id as membership_id, organisation_memberships.login_account_id,
            people.id as person_id,
            organisation_commercial_access.trial_started_at, organisation_commercial_access.trial_ends_at
     from organisations
     join organisation_memberships on organisation_memberships.organisation_id = organisations.id
     join login_accounts on login_accounts.id = organisation_memberships.login_account_id
     join login_account_people on login_account_people.login_account_id = login_accounts.id and login_account_people.is_default = 1
     join people on people.id = login_account_people.person_id
     join organisation_commercial_access on organisation_commercial_access.organisation_id = organisations.id
     where organisations.id = ?
     limit 1`,
  )
    .bind(organisationId)
    .first<{ organisation_id: string; organisation_name: string; membership_id: string; login_account_id: string; person_id: string; trial_started_at: string; trial_ends_at: string }>();
  if (!row) throw new Error("Signup result not found");
  return { ok: true as const, result: row };
}

async function nextCentreCode(_c: AppContext, _organisationId: string) {
  return "CTR-001";
}

function auditStatements(c: AppContext, organisationId: string, branchId: string, accountId: string, personId: string, idempotencyKey: string, now: string, legalEntityType: string, trialEndsAt: string) {
  const events = [
    ["organisation_created", "organisation", organisationId, { legalEntityType }],
    ["initial_centre_created", "branch", branchId, { centreCode: "CTR-001" }],
    ["account_authority_established", "organisation", organisationId, {}],
    ["trial_started", "organisation_commercial_access", organisationId, { trialEndsAt }],
    ["legal_entity_type_captured", "organisation", organisationId, { legalEntityType }],
    ["initial_tenant_context_established", "organisation_membership", organisationId, { loginAccountId: accountId, personId }],
    ["organisation_signup_idempotency", "organisation", organisationId, idempotencyKey],
  ] as const;
  return events.map(([action, entityType, entityId, metadata]) =>
    c.env.DB.prepare(
      `insert into audit_logs (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(createOpaqueId("audit"), organisationId, branchId, accountId, personId, action, entityType, entityId, typeof metadata === "string" ? metadata : JSON.stringify(metadata), now),
  );
}

function taxJson(pan?: string, gstin?: string) {
  const value: Record<string, string> = {};
  if (pan?.trim()) value.pan = pan.trim().toUpperCase();
  if (gstin?.trim()) value.gstin = gstin.trim().toUpperCase();
  return Object.keys(value).length ? JSON.stringify(value) : null;
}

function uniqueSlug(organisationId: string) {
  return organisationId;
}

function cleanOptional(value?: string) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function nonEmpty(value?: string) {
  return Boolean(String(value || "").trim());
}

function emailOk(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function invalid(code: string, message: string) {
  return { ok: false as const, status: 400, code, message };
}
