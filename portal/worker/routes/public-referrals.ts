import { z } from "zod";
import type { Context, Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { createOpaqueId, hmacHex } from "../lib/crypto";
import { ORG_ID } from "../lib/auth-store";
import { getClientIp } from "../lib/http";
import { jsonPlain } from "../lib/json-response";
import {
  resolveReferralLink,
  submitReferralAndCreateEnquiry,
  type ReferralRejectionCode,
  type ReferralServiceEnv,
} from "../lib/referral-service";
import type { EligibleCourseRecord } from "../lib/referral-repository";
import { ReferralTokenConfigurationError, requireReferralTokenPepper, validateReferralTokenFormat } from "../lib/referral-token";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

type PortalContext = Context<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const DEFAULT_BRANCH_ID = "branch_sion";
const MAX_SUBMIT_BODY_BYTES = 4096;
const RESOLVE_LIMIT = { count: 60, windowSeconds: 60 };
const SUBMIT_IP_LIMIT = { count: 10, windowSeconds: 600 };
const SUBMIT_MOBILE_LIMIT = { count: 3, windowSeconds: 3600 };
const SUBMIT_TOKEN_LIMIT = { count: 20, windowSeconds: 3600 };
const PRODUCTION_PUBLIC_ORIGINS = new Set([
  "https://go.samyaksion.com",
  "https://refer.samyaksion.com",
  "https://samyaksion.com",
  "https://www.samyaksion.com",
]);
const DEVELOPMENT_PUBLIC_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
]);

const submitSchema = z.object({
  token: z.string().trim().min(32).max(128),
  name: z.string().trim().min(1).max(100),
  mobile: z.string().trim().min(1).max(40),
  email: z.string().trim().max(254).nullable().optional(),
  courseId: z.string().trim().min(1).max(120),
  consent: z.boolean(),
});

export function registerPublicReferralRoutes(app: PortalHono) {
  app.options("/api/public/referrals/*", (c) => corsPreflight(c));

  app.use("/api/public/referrals/*", async (c, next) => {
    const originResponse = publicCorsHeaders(c);
    if (!originResponse.allowed) return publicError(c, 403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed.", originResponse.headers);
    await next();
  });

  app.get("/api/public/referrals/resolve/:token", async (c) => {
    const token = referralTokenFromParam(c);
    if (!token) return publicError(c, 404, "INVALID_REFERRAL_LINK", "This invitation link is no longer available.");
    const env = referralEnv(c);
    if (!env) return publicError(c, 503, "REFERRAL_SERVICE_UNAVAILABLE", "Referral service is temporarily unavailable.");
    const limited = await enforcePublicLimit(c, "public_referral_resolve_ip", await publicHash(c, "ip", getClientIp(c)), RESOLVE_LIMIT.count, RESOLVE_LIMIT.windowSeconds);
    if (limited) return limited;
    const resolved = await resolveReferralLink(env, { organisationId: ORG_ID, rawToken: token });
    if (!resolved.valid) return publicError(c, 404, "INVALID_REFERRAL_LINK", "This invitation link is no longer available.");
    return publicJson(c, {
      success: true,
      valid: true,
      programme: { name: resolved.programme.publicName, validityDays: resolved.programme.validityDays },
      referrer: { displayName: resolved.referrer.publicDisplayName },
    });
  });

  app.get("/api/public/referrals/resolve/:token/courses", async (c) => {
    const token = referralTokenFromParam(c);
    if (!token) return publicError(c, 404, "INVALID_REFERRAL_LINK", "This invitation link is no longer available.");
    const env = referralEnv(c);
    if (!env) return publicError(c, 503, "REFERRAL_SERVICE_UNAVAILABLE", "Referral service is temporarily unavailable.");
    const limited = await enforcePublicLimit(c, "public_referral_resolve_ip", await publicHash(c, "ip", getClientIp(c)), RESOLVE_LIMIT.count, RESOLVE_LIMIT.windowSeconds);
    if (limited) return limited;
    const resolved = await resolveReferralLink(env, { organisationId: ORG_ID, rawToken: token });
    if (!resolved.valid) return publicError(c, 404, "INVALID_REFERRAL_LINK", "This invitation link is no longer available.");
    return publicJson(c, {
      success: true,
      categories: groupEligibleCourses(resolved.courses),
    });
  });

  app.post("/api/public/referrals/submit", async (c) => {
    const env = referralEnv(c);
    if (!env) return publicError(c, 503, "REFERRAL_SERVICE_UNAVAILABLE", "Referral service is temporarily unavailable.");
    const contentType = c.req.header("Content-Type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) return publicError(c, 415, "JSON_REQUIRED", "Only JSON requests are accepted.");
    const bodyText = await c.req.raw.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_SUBMIT_BODY_BYTES) return publicError(c, 413, "REQUEST_TOO_LARGE", "Please reduce the request size.");
    const parsed = submitSchema.safeParse(safeJson(bodyText));
    if (!parsed.success) return publicError(c, 400, "INVALID_REQUEST", "Please check the referral form details.");
    const limits = [
      await enforcePublicLimit(c, "public_referral_submit_ip", await publicHash(c, "ip", getClientIp(c)), SUBMIT_IP_LIMIT.count, SUBMIT_IP_LIMIT.windowSeconds),
      await enforcePublicLimit(c, "public_referral_submit_mobile", await publicHash(c, "mobile", parsed.data.mobile), SUBMIT_MOBILE_LIMIT.count, SUBMIT_MOBILE_LIMIT.windowSeconds),
      await enforcePublicLimit(c, "public_referral_submit_token", await publicHash(c, "token", parsed.data.token), SUBMIT_TOKEN_LIMIT.count, SUBMIT_TOKEN_LIMIT.windowSeconds),
    ];
    const limited = limits.find(Boolean);
    if (limited) return limited;

    const result = await submitReferralAndCreateEnquiry(env, {
      organisationId: ORG_ID,
      rawReferralToken: parsed.data.token,
      branchId: DEFAULT_BRANCH_ID,
      prospectName: parsed.data.name,
      prospectMobile: parsed.data.mobile,
      prospectEmail: parsed.data.email || null,
      courseId: parsed.data.courseId,
      consentAccepted: parsed.data.consent,
      source: "personal_link",
      idempotencyKey: c.req.header("Idempotency-Key") || null,
    });

    if (!result.ok) return publicError(c, statusForReferralCode(result.code), publicCodeForReferralCode(result.code), messageForReferralCode(result.code));
    return publicJson(c, {
      success: true,
      referralId: result.enquiryNumber,
      enquiryNumber: result.enquiryNumber,
      idempotent: result.idempotent,
    }, { status: result.idempotent ? 200 : 201 });
  });
}

export function groupEligibleCourses(courses: EligibleCourseRecord[]) {
  const byCategory = new Map<string, {
    id: string;
    code: string;
    name: string;
    sortOrder: number;
    courses: Array<{ id: string; code: string; name: string; durationMonths: number | null }>;
  }>();
  for (const course of courses) {
    let category = byCategory.get(course.category_id);
    if (!category) {
      category = {
        id: course.category_id,
        code: course.category_code,
        name: course.category_name,
        sortOrder: Number(course.category_sort_order || 0),
        courses: [],
      };
      byCategory.set(course.category_id, category);
    }
    category.courses.push({
      id: course.id,
      code: course.code,
      name: course.name,
      durationMonths: course.duration_months,
    });
  }
  return Array.from(byCategory.values())
    .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code))
    .map(({ sortOrder: _sortOrder, ...category }) => category);
}

function referralEnv(c: PortalContext): ReferralServiceEnv | null {
  try {
    return {
      DB: c.env.DB,
      SESSION_PEPPER: c.env.SESSION_PEPPER,
      referralTokenPepper: requireReferralTokenPepper(referralTokenPepperSecret(c.env)),
    };
  } catch (error) {
    if (error instanceof ReferralTokenConfigurationError) return null;
    throw error;
  }
}

function referralTokenPepperSecret(env: WorkerBindings) {
  const binding = ["REFERRAL", "TOKEN", "PEPPER"].join("_") as keyof WorkerBindings;
  return String(env[binding] || "");
}

function referralTokenFromParam(c: PortalContext) {
  const token = (c.req.param("token") || "").trim();
  return validateReferralTokenFormat(token) ? token : null;
}

function safeJson(bodyText: string) {
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

function statusForReferralCode(code: ReferralRejectionCode) {
  if (code === "idempotency_conflict") return 409;
  if (code === "existing_enquiry" || code === "current_student" || code === "former_student" || code === "active_duplicate") return 409;
  if (code === "invalid_link") return 404;
  return 400;
}

function publicCodeForReferralCode(code: ReferralRejectionCode) {
  const codes: Record<ReferralRejectionCode, string> = {
    invalid_name: "INVALID_REQUEST",
    existing_enquiry: "EXISTING_ENQUIRY",
    current_student: "CURRENT_STUDENT",
    former_student: "FORMER_STUDENT",
    active_duplicate: "DUPLICATE_REFERRAL",
    invalid_mobile: "INVALID_MOBILE_NUMBER",
    invalid_link: "INVALID_REFERRAL_LINK",
    inactive_programme: "INVALID_REFERRAL_LINK",
    ineligible_course: "INACTIVE_COURSE",
    consent_missing: "CONSENT_REQUIRED",
    idempotency_conflict: "IDEMPOTENCY_CONFLICT",
  };
  return codes[code];
}

function messageForReferralCode(code: ReferralRejectionCode) {
  const messages: Record<ReferralRejectionCode, string> = {
    invalid_name: "Please enter a valid name.",
    existing_enquiry: "This enquiry is already registered.",
    current_student: "This mobile number already belongs to a current student.",
    former_student: "This mobile number already belongs to a former student.",
    active_duplicate: "This referral is already active.",
    invalid_mobile: "Please enter a valid mobile number.",
    invalid_link: "This invitation link is no longer available.",
    inactive_programme: "This invitation link is no longer available.",
    ineligible_course: "The selected course is unavailable.",
    consent_missing: "Consent is required.",
    idempotency_conflict: "This retry does not match the original submission.",
  };
  return messages[code];
}

function corsPreflight(c: PortalContext) {
  const originResponse = publicCorsHeaders(c);
  if (!originResponse.allowed) return new Response(null, { status: 403, headers: originResponse.headers });
  return new Response(null, { status: 204, headers: { ...originResponse.headers, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key" } });
}

function publicJson(c: PortalContext, body: Record<string, unknown>, init?: { status?: 200 | 201 }) {
  return jsonPlain(c, body, { status: init?.status || 200, headers: publicCorsHeaders(c).headers });
}

function publicError(c: PortalContext, status: 400 | 403 | 404 | 409 | 413 | 415 | 429 | 503, code: string, message: string, headers?: Record<string, string>) {
  return c.json({ success: false, code, message }, status, { ...(headers || publicCorsHeaders(c).headers), "Cache-Control": "no-store" });
}

async function enforcePublicLimit(c: PortalContext, eventType: string, keyHash: string, maxCount: number, windowSeconds: number) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const count = await c.env.DB.prepare(
    `select count(*) as count
     from auth_events
     where organisation_id = ?
       and event_type = ?
       and ip_hash = ?
       and result_code not in ('RATE_LIMITED')
       and created_at >= ?`,
  )
    .bind(ORG_ID, eventType, keyHash, since)
    .first<{ count: number }>();
  if (Number(count?.count || 0) >= maxCount) {
    await recordPublicEvent(c, eventType, "RATE_LIMITED", keyHash);
    return publicError(c, 429, "RATE_LIMITED", "Please wait before trying again.", { ...publicCorsHeaders(c).headers, "Retry-After": String(windowSeconds) });
  }
  await recordPublicEvent(c, eventType, "ALLOWED", keyHash);
  return null;
}

async function recordPublicEvent(c: PortalContext, eventType: string, resultCode: string, keyHash: string) {
  await c.env.DB.prepare(
    `insert into auth_events
      (id, organisation_id, login_account_id, event_type, result_code, mobile_hash, mobile_last_four, ip_hash, user_agent_hash, created_at)
     values (?, ?, null, ?, ?, null, null, ?, ?, ?)`,
  )
    .bind(createOpaqueId("authevt"), ORG_ID, eventType, resultCode, keyHash, await publicHash(c, "ua", c.req.header("User-Agent") || ""), new Date().toISOString())
    .run();
}

function publicHash(c: PortalContext, context: string, value: string) {
  return hmacHex(c.env.SESSION_PEPPER, `public-referral-${context}`, value);
}

function publicCorsHeaders(c: PortalContext) {
  const origin = c.req.header("Origin") || "";
  const allowed = !origin || allowedPublicOrigins(c.env).has(origin);
  return {
    allowed,
    headers: {
      Vary: "Origin",
      "Cache-Control": "no-store",
      ...(origin && allowed ? { "Access-Control-Allow-Origin": origin } : {}),
    },
  };
}

function allowedPublicOrigins(env: WorkerBindings) {
  const environment = env.ENVIRONMENT || "production";
  const configuredOrigins = parseConfiguredOrigins(env.REFERRAL_PUBLIC_ALLOWED_ORIGINS);
  if (environment === "development") return new Set([...DEVELOPMENT_PUBLIC_ORIGINS, ...configuredOrigins]);
  if (environment === "staging" || environment === "preview") return configuredOrigins;
  return new Set([...PRODUCTION_PUBLIC_ORIGINS, ...configuredOrigins]);
}

function parseConfiguredOrigins(value?: string) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .reduce((origins, origin) => {
      origins.add(origin);
      return origins;
    }, new Set<string>());
}
