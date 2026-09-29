import { z } from "zod";
import type { AppContext } from "./http";
import { createOpaqueId } from "./crypto";
import { LEGAL_ENTITY_TYPES, ORGANISATION_TYPES } from "./organisation-signup";
import { staffOrganisationId, type StaffContext } from "./staff-auth";

const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const organisationSettingsSchema = z.object({
  name: requiredText(160),
  legalName: requiredText(200),
  organisationType: z.enum(ORGANISATION_TYPES),
  legalEntityType: z.enum(LEGAL_ENTITY_TYPES),
  addressLine1: requiredText(240),
  city: requiredText(120),
  stateRegion: requiredText(120),
  country: requiredText(120),
  postcode: optionalText(40),
  website: optionalText(2048),
  currency: z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{3}$/)),
  timezone: z.string().trim().min(1).max(120).refine(isValidTimeZone, "Enter a valid timezone."),
  pan: optionalText(20),
  gstin: optionalText(32),
}).strict().superRefine((value, ctx) => {
  const isIndia = isIndiaCountry(value.country);
  const pan = value.pan?.trim().toUpperCase() || "";
  const gstin = value.gstin?.trim().toUpperCase() || "";
  if (isIndia && pan && !panPattern.test(pan)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pan"], message: "Enter a valid PAN." });
  }
  if (isIndia && gstin && !gstinPattern.test(gstin)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gstin"], message: "Enter a valid GSTIN." });
  }
});

export type OrganisationSettingsInput = z.infer<typeof organisationSettingsSchema>;

export type OrganisationSettings = {
  id: string;
  name: string;
  legalName: string;
  organisationType: string;
  legalEntityType: string;
  addressLine1: string;
  city: string;
  stateRegion: string;
  country: string;
  postcode: string;
  website: string;
  currency: string;
  timezone: string;
  pan: string;
  gstin: string;
  updatedAt: string;
};

type OrganisationRow = {
  id: string;
  name: string | null;
  legal_name: string | null;
  organisation_type: string | null;
  legal_entity_type: string | null;
  address_line1: string | null;
  city: string | null;
  state_region: string | null;
  country: string | null;
  postcode: string | null;
  website: string | null;
  currency: string | null;
  timezone: string | null;
  tax_identifiers_json: string | null;
  updated_at: string | null;
};

export async function getOrganisationSettings(c: AppContext, organisationId: string) {
  const row = await loadOrganisationRow(c, organisationId);
  return row ? organisationSettingsFromRow(row) : null;
}

export async function updateOrganisationSettings(c: AppContext, staff: StaffContext, input: OrganisationSettingsInput) {
  const organisationId = staffOrganisationId(staff);
  const row = await loadOrganisationRow(c, organisationId);
  if (!row) return { ok: false as const, status: 404 as const, code: "organisation_not_found", message: "Organisation was not found." };

  const current = organisationSettingsFromRow(row);
  const next = normaliseSettings(organisationId, input, current.updatedAt);
  const changedFields = changedSettingFields(current, next);
  if (changedFields.length === 0) {
    return { ok: true as const, settings: current, changedFields };
  }

  const now = new Date().toISOString();
  const nextTaxIdentifiersJson = taxIdentifiersJson(next.pan, next.gstin);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `update organisations
       set name = ?, legal_name = ?, organisation_type = ?, legal_entity_type = ?,
           address_line1 = ?, city = ?, state_region = ?, country = ?, postcode = ?,
           website = ?, currency = ?, timezone = ?, tax_identifiers_json = ?, updated_at = ?
       where id = ?`,
    ).bind(
      next.name,
      next.legalName,
      next.organisationType,
      next.legalEntityType,
      next.addressLine1,
      next.city,
      next.stateRegion,
      next.country,
      next.postcode || null,
      next.website || null,
      next.currency,
      next.timezone,
      nextTaxIdentifiersJson,
      now,
      organisationId,
    ),
    c.env.DB.prepare(
      `insert into audit_logs
        (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
       values (?, ?, null, ?, ?, 'organisation_settings_updated', 'organisation', ?, ?, ?)`,
    ).bind(
      createOpaqueId("audit"),
      organisationId,
      staff.loginAccountId,
      staff.activePersonId,
      organisationId,
      JSON.stringify({ changedFields }),
      now,
    ),
  ]);

  return { ok: true as const, settings: { ...next, updatedAt: now }, changedFields };
}

function loadOrganisationRow(c: AppContext, organisationId: string) {
  return c.env.DB.prepare(
    `select id, name, legal_name, organisation_type, legal_entity_type, address_line1,
            city, state_region, country, postcode, website, currency, timezone,
            tax_identifiers_json, updated_at
     from organisations
     where id = ? and status = 'active'`,
  ).bind(organisationId).first<OrganisationRow>();
}

function organisationSettingsFromRow(row: OrganisationRow): OrganisationSettings {
  const tax = parseTaxIdentifiers(row.tax_identifiers_json);
  return {
    id: row.id,
    name: row.name || "",
    legalName: row.legal_name || "",
    organisationType: row.organisation_type || "other",
    legalEntityType: row.legal_entity_type || "other",
    addressLine1: row.address_line1 || "",
    city: row.city || "",
    stateRegion: row.state_region || "",
    country: row.country || "",
    postcode: row.postcode || "",
    website: row.website || "",
    currency: row.currency || "INR",
    timezone: row.timezone || "Asia/Kolkata",
    pan: tax.pan,
    gstin: tax.gstin,
    updatedAt: row.updated_at || "",
  };
}

function normaliseSettings(id: string, input: OrganisationSettingsInput, updatedAt: string): OrganisationSettings {
  return {
    id,
    name: input.name.trim(),
    legalName: input.legalName.trim(),
    organisationType: input.organisationType,
    legalEntityType: input.legalEntityType,
    addressLine1: input.addressLine1.trim(),
    city: input.city.trim(),
    stateRegion: input.stateRegion.trim(),
    country: input.country.trim(),
    postcode: input.postcode?.trim() || "",
    website: input.website?.trim() || "",
    currency: input.currency.trim().toUpperCase(),
    timezone: input.timezone.trim(),
    pan: input.pan?.trim().toUpperCase() || "",
    gstin: input.gstin?.trim().toUpperCase() || "",
    updatedAt,
  };
}

function changedSettingFields(current: OrganisationSettings, next: OrganisationSettings) {
  const keys: Array<keyof OrganisationSettings> = [
    "name",
    "legalName",
    "organisationType",
    "legalEntityType",
    "addressLine1",
    "city",
    "stateRegion",
    "country",
    "postcode",
    "website",
    "currency",
    "timezone",
    "pan",
    "gstin",
  ];
  return keys.filter((key) => current[key] !== next[key]);
}

function parseTaxIdentifiers(value: string | null) {
  if (!value) return { pan: "", gstin: "" };
  try {
    const parsed = JSON.parse(value) as { pan?: unknown; gstin?: unknown };
    return {
      pan: typeof parsed.pan === "string" ? parsed.pan : "",
      gstin: typeof parsed.gstin === "string" ? parsed.gstin : "",
    };
  } catch {
    return { pan: "", gstin: "" };
  }
}

function taxIdentifiersJson(pan: string, gstin: string) {
  const payload = {
    ...(pan ? { pan } : {}),
    ...(gstin ? { gstin } : {}),
  };
  return Object.keys(payload).length ? JSON.stringify(payload) : null;
}

function isIndiaCountry(country: string) {
  const normalized = country.trim().toUpperCase();
  return normalized === "IN" || normalized === "INDIA";
}

function isValidTimeZone(value: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
