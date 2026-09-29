import { z } from "zod";
import type { AppContext } from "./http";
import { mobileHash } from "./auth-store";
import { createOpaqueId } from "./crypto";
import { maskMobile, normalizeIndianMobile } from "./mobile";
import { countryDefaults, CENTRE_OPERATING_MODELS } from "./organisation-signup";
import { staffOrganisationId, type StaffContext } from "./staff-auth";
import { centreCommercialStatusLabel, isCentreCommerciallyOperational } from "./centre-commercial-access";

const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PENDING_SUBSCRIPTION = "pending_subscription";

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const emailSchema = z.string().trim().toLowerCase().email().max(254).optional().or(z.literal(""));
const currencySchema = z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z]{3}$/));
const timezoneSchema = z.string().trim().min(1).max(120).refine(isValidTimeZone, "Enter a valid timezone.");

export const centreCreateSchema = z.object({
  name: requiredText(160),
  mobile: requiredText(24),
  email: emailSchema,
  addressLine1: requiredText(240),
  city: requiredText(120),
  stateRegion: optionalText(120),
  postcode: requiredText(40),
  country: requiredText(120),
  operatingModel: z.enum(CENTRE_OPERATING_MODELS),
  currency: currencySchema.optional(),
  timezone: timezoneSchema.optional(),
  pan: optionalText(20),
  gstin: optionalText(32),
}).strict().superRefine(validateTaxIdentifiers);

export const centreUpdateSchema = z.object({
  name: requiredText(160),
  newMobile: optionalText(24),
  email: emailSchema,
  addressLine1: requiredText(240),
  city: requiredText(120),
  stateRegion: optionalText(120),
  postcode: requiredText(40),
  country: requiredText(120),
  operatingModel: z.enum(CENTRE_OPERATING_MODELS),
  currency: currencySchema,
  timezone: timezoneSchema,
  pan: optionalText(20),
  gstin: optionalText(32),
}).strict().superRefine(validateTaxIdentifiers);

export type CentreCreateInput = z.infer<typeof centreCreateSchema>;
export type CentreUpdateInput = z.infer<typeof centreUpdateSchema>;

export type CentrePayload = {
  id: string;
  name: string;
  code: string;
  addressLine1: string;
  city: string;
  stateRegion: string;
  postcode: string;
  country: string;
  maskedMobile: string;
  email: string;
  operatingModel: string;
  currency: string;
  timezone: string;
  pan: string;
  gstin: string;
  status: "active" | "inactive";
  centreStatus: string;
  commercialState: string;
  commercialStatusLabel: string;
  canOperate: boolean;
  subscriptionStatusLabel: string;
  createdAt: string;
  updatedAt: string;
};

type CentreRow = {
  id: string;
  name: string;
  code: string;
  status: "active" | "inactive";
  address_line1: string | null;
  city: string | null;
  state_region: string | null;
  postcode: string | null;
  country: string | null;
  mobile_last_four: string | null;
  email: string | null;
  currency: string | null;
  timezone: string | null;
  operating_model: string | null;
  centre_status: string | null;
  commercial_state: string | null;
  tax_identifiers_json: string | null;
  created_at: string;
  updated_at: string;
};

type CentreResult =
  | { ok: true; centre: CentrePayload; changedFields?: string[] }
  | { ok: false; status: 400 | 404 | 409; code: string; message: string; fieldErrors?: Record<string, string[]> };

export async function listCentres(c: AppContext, staff: StaffContext) {
  const organisationId = staffOrganisationId(staff);
  const rows = await c.env.DB.prepare(`${centreSelectSql()} where branches.organisation_id = ? order by branches.created_at, branches.name`)
    .bind(organisationId)
    .all<CentreRow>();
  return (rows.results || []).map(centrePayload);
}

export async function getCentre(c: AppContext, staff: StaffContext, centreId: string) {
  const row = await loadCentreRow(c, staffOrganisationId(staff), centreId);
  return row ? centrePayload(row) : null;
}

export async function createCentre(c: AppContext, staff: StaffContext, input: CentreCreateInput): Promise<CentreResult> {
  const organisationId = staffOrganisationId(staff);
  const duplicate = await findCentreByName(c, organisationId, input.name.trim());
  if (duplicate) return duplicateName();

  const normalizedMobile = normalizeIndianMobile(input.mobile);
  if (!normalizedMobile) return { ok: false, status: 400, code: "invalid_mobile", message: "Enter a valid Indian mobile number.", fieldErrors: { mobile: ["Enter a valid Indian mobile number."] } };

  const defaults = countryDefaults(input.country);
  const mobileHashValue = await mobileHash(c, normalizedMobile);
  const now = new Date().toISOString();
  const centreId = createOpaqueId("branch");
  const commercialAccessId = createOpaqueId("cca");
  const taxJson = mergeTaxIdentifiers(null, input.pan, input.gstin);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const centreCode = await nextCentreCode(c, organisationId);
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `insert into branches
            (id, organisation_id, name, code, timezone, status, address_line1, city, state_region,
             postcode, country, mobile_hash, mobile_last_four, email, currency, operating_model,
             centre_status, tax_identifiers_json, created_at, updated_at)
           values (?, ?, ?, ?, ?, 'inactive', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          centreId,
          organisationId,
          input.name.trim(),
          centreCode,
          input.timezone?.trim() || defaults.timezone,
          input.addressLine1.trim(),
          input.city.trim(),
          cleanOptional(input.stateRegion),
          input.postcode.trim(),
          input.country.trim(),
          mobileHashValue,
          normalizedMobile.slice(-4),
          cleanOptional(input.email)?.toLowerCase() || null,
          input.currency?.trim().toUpperCase() || defaults.currency,
          input.operatingModel,
          PENDING_SUBSCRIPTION,
          taxJson,
          now,
          now,
        ),
        c.env.DB.prepare(
          `insert into centre_commercial_access
            (id, organisation_id, branch_id, state, source, payment_evidence_source,
             payment_evidence_reference, activated_at, created_at, updated_at)
           values (?, ?, ?, 'pending_payment', 'centre_created', null, null, null, ?, ?)`,
        ).bind(commercialAccessId, organisationId, centreId, now, now),
        auditStatement(c, staff, organisationId, centreId, "centre_created", {
          centreCode,
          operatingModel: input.operatingModel,
          initialStatus: PENDING_SUBSCRIPTION,
          commercialState: "pending_payment",
        }, now),
      ]);
      const row = await loadCentreRow(c, organisationId, centreId);
      if (!row) throw new Error("Centre creation could not be verified.");
      return { ok: true, centre: centrePayload(row) };
    } catch (error) {
      if (isUniqueNameConflict(error)) return duplicateName();
      if (isUniqueCodeConflict(error)) continue;
      throw error;
    }
  }

  return { ok: false, status: 409, code: "centre_code_conflict", message: "Could not allocate a Centre code. Please try again." };
}

export async function updateCentre(c: AppContext, staff: StaffContext, centreId: string, input: CentreUpdateInput): Promise<CentreResult> {
  const organisationId = staffOrganisationId(staff);
  const row = await loadCentreRow(c, organisationId, centreId);
  if (!row) return { ok: false, status: 404, code: "centre_not_found", message: "Centre was not found." };

  const duplicate = await findCentreByName(c, organisationId, input.name.trim(), centreId);
  if (duplicate) return duplicateName();

  const current = centrePayload(row);
  const currentTax = parseTaxIdentifiers(row.tax_identifiers_json);
  const newMobile = input.newMobile?.trim() || "";
  let mobileHashValue: string | null | undefined;
  let mobileLastFour: string | null | undefined;
  if (newMobile) {
    const normalizedMobile = normalizeIndianMobile(newMobile);
    if (!normalizedMobile) return { ok: false, status: 400, code: "invalid_mobile", message: "Enter a valid Indian mobile number.", fieldErrors: { newMobile: ["Enter a valid Indian mobile number."] } };
    mobileHashValue = await mobileHash(c, normalizedMobile);
    mobileLastFour = normalizedMobile.slice(-4);
  }

  const next = {
    ...current,
    name: input.name.trim(),
    addressLine1: input.addressLine1.trim(),
    city: input.city.trim(),
    stateRegion: input.stateRegion?.trim() || "",
    postcode: input.postcode.trim(),
    country: input.country.trim(),
    email: input.email?.trim().toLowerCase() || "",
    operatingModel: input.operatingModel,
    currency: input.currency.trim().toUpperCase(),
    timezone: input.timezone.trim(),
    pan: input.pan?.trim().toUpperCase() || "",
    gstin: input.gstin?.trim().toUpperCase() || "",
    maskedMobile: mobileLastFour ? maskMobile(mobileLastFour) : current.maskedMobile,
  };
  const changedFields = changedCentreFields(current, next, Boolean(mobileLastFour));
  if (changedFields.length === 0) return { ok: true, centre: current, changedFields };

  const now = new Date().toISOString();
  const taxJson = mergeTaxIdentifiers(currentTax, next.pan, next.gstin);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `update branches
         set name = ?, address_line1 = ?, city = ?, state_region = ?, postcode = ?, country = ?,
             email = ?, operating_model = ?, currency = ?, timezone = ?, tax_identifiers_json = ?,
             mobile_hash = coalesce(?, mobile_hash), mobile_last_four = coalesce(?, mobile_last_four),
             updated_at = ?
         where id = ? and organisation_id = ?`,
      ).bind(
        next.name,
        next.addressLine1,
        next.city,
        next.stateRegion || null,
        next.postcode,
        next.country,
        next.email || null,
        next.operatingModel,
        next.currency,
        next.timezone,
        taxJson,
        mobileHashValue ?? null,
        mobileLastFour ?? null,
        now,
        centreId,
        organisationId,
      ),
      auditStatement(c, staff, organisationId, centreId, "centre_updated", { changedFields }, now),
    ]);
  } catch (error) {
    if (isUniqueNameConflict(error)) return duplicateName();
    throw error;
  }

  const updated = await loadCentreRow(c, organisationId, centreId);
  if (!updated) return { ok: false, status: 404, code: "centre_not_found", message: "Centre was not found." };
  return { ok: true, centre: centrePayload(updated), changedFields };
}

function centreSelectSql() {
  return `select branches.id, branches.name, branches.code, branches.status,
                 branches.address_line1, branches.city, branches.state_region, branches.postcode, branches.country,
                 branches.mobile_last_four, branches.email, branches.currency, branches.timezone,
                 branches.operating_model, branches.centre_status,
                 centre_commercial_access.state as commercial_state,
                 branches.tax_identifiers_json, branches.created_at, branches.updated_at
          from branches
          left join centre_commercial_access
            on centre_commercial_access.branch_id = branches.id
           and centre_commercial_access.organisation_id = branches.organisation_id`;
}

function loadCentreRow(c: AppContext, organisationId: string, centreId: string) {
  return c.env.DB.prepare(`${centreSelectSql()} where branches.id = ? and branches.organisation_id = ?`)
    .bind(centreId, organisationId)
    .first<CentreRow>();
}

async function findCentreByName(c: AppContext, organisationId: string, name: string, excludeCentreId?: string) {
  const row = await c.env.DB.prepare(
    `select id from branches where organisation_id = ? and lower(name) = lower(?) ${excludeCentreId ? "and id != ?" : ""} limit 1`,
  ).bind(...(excludeCentreId ? [organisationId, name, excludeCentreId] : [organisationId, name])).first<{ id: string }>();
  return row || null;
}

async function nextCentreCode(c: AppContext, organisationId: string) {
  const row = await c.env.DB.prepare(
    `select max(cast(substr(code, 5) as integer)) as max_sequence
     from branches
     where organisation_id = ? and code like 'CTR-%'`,
  ).bind(organisationId).first<{ max_sequence: number | null }>();
  const next = Number(row?.max_sequence || 0) + 1;
  return `CTR-${String(next).padStart(3, "0")}`;
}

function centrePayload(row: CentreRow): CentrePayload {
  const tax = parseTaxIdentifiers(row.tax_identifiers_json);
  const status = row.status === "active" ? "active" : "inactive";
  const centreStatus = row.centre_status || (status === "active" ? "active" : "inactive");
  const commercialState = row.commercial_state || "unknown";
  const commercialStatusLabel = centreCommercialStatusLabel(commercialState);
  const canOperate = status === "active" && centreStatus === "active" && isCentreCommerciallyOperational(commercialState);
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    addressLine1: row.address_line1 || "",
    city: row.city || "",
    stateRegion: row.state_region || "",
    postcode: row.postcode || "",
    country: row.country || "",
    maskedMobile: row.mobile_last_four ? maskMobile(row.mobile_last_four) : "",
    email: row.email || "",
    operatingModel: row.operating_model || "company_owned",
    currency: row.currency || "INR",
    timezone: row.timezone || "Asia/Kolkata",
    pan: tax.pan,
    gstin: tax.gstin,
    status,
    centreStatus,
    commercialState,
    commercialStatusLabel,
    canOperate,
    subscriptionStatusLabel: commercialStatusLabel !== "Unknown" ? commercialStatusLabel : labelForCentreStatus(centreStatus),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function changedCentreFields(current: CentrePayload, next: CentrePayload, mobileChanged: boolean) {
  const keys: Array<keyof CentrePayload> = ["name", "addressLine1", "city", "stateRegion", "postcode", "country", "email", "operatingModel", "currency", "timezone", "pan", "gstin"];
  const changed = keys.filter((key) => current[key] !== next[key]).map(String);
  if (mobileChanged) changed.push("mobile");
  return changed;
}

function validateTaxIdentifiers(value: { country: string; pan?: string; gstin?: string }, ctx: z.RefinementCtx) {
  if (!isIndiaCountry(value.country)) return;
  const pan = value.pan?.trim().toUpperCase() || "";
  const gstin = value.gstin?.trim().toUpperCase() || "";
  if (pan && !panPattern.test(pan)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pan"], message: "Enter a valid PAN." });
  if (gstin && !gstinPattern.test(gstin)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gstin"], message: "Enter a valid GSTIN." });
}

function parseTaxIdentifiers(value: string | null) {
  if (!value) return { pan: "", gstin: "", raw: {} as Record<string, unknown> };
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    return {
      pan: typeof raw.pan === "string" ? raw.pan : "",
      gstin: typeof raw.gstin === "string" ? raw.gstin : "",
      raw,
    };
  } catch {
    return { pan: "", gstin: "", raw: {} as Record<string, unknown> };
  }
}

function mergeTaxIdentifiers(existing: ReturnType<typeof parseTaxIdentifiers> | null, pan?: string, gstin?: string) {
  const value: Record<string, unknown> = { ...(existing?.raw || {}) };
  const normalizedPan = pan?.trim().toUpperCase() || "";
  const normalizedGstin = gstin?.trim().toUpperCase() || "";
  if (normalizedPan) value.pan = normalizedPan;
  else delete value.pan;
  if (normalizedGstin) value.gstin = normalizedGstin;
  else delete value.gstin;
  return Object.keys(value).length ? JSON.stringify(value) : null;
}

function auditStatement(c: AppContext, staff: StaffContext, organisationId: string, centreId: string, action: string, metadata: Record<string, unknown>, now: string) {
  return c.env.DB.prepare(
    `insert into audit_logs
      (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, 'branch', ?, ?, ?)`,
  ).bind(createOpaqueId("audit"), organisationId, centreId, staff.loginAccountId, staff.activePersonId, action, centreId, JSON.stringify(metadata), now);
}

function duplicateName() {
  return { ok: false as const, status: 409 as const, code: "duplicate_centre_name", message: "A Centre with this name already exists.", fieldErrors: { name: ["A Centre with this name already exists."] } };
}

function cleanOptional(value?: string) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
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

function labelForCentreStatus(value: string) {
  return value.split("_").filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ") || "Unknown";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isUniqueNameConflict(error: unknown) {
  const text = errorText(error).toLowerCase();
  return text.includes("branches_organisation_name_unique") || (text.includes("unique") && text.includes("name"));
}

function isUniqueCodeConflict(error: unknown) {
  const text = errorText(error).toLowerCase();
  return text.includes("branches_organisation_code_unique") || (text.includes("unique") && text.includes("code"));
}
