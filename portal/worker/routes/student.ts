import type { Context } from "hono";
import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import {
  activeReferrerForPerson,
  clearSessionCookie,
  fetchDashboardForActiveProfile,
  fetchStudentHomeForActiveProfile,
  getSessionFromRequest,
  hasSessionCookie,
  ORG_ID,
  recordAuthEvent,
  sessionView,
} from "../lib/auth-store";
import { getClientIp, requireSameOrigin } from "../lib/http";
import { jsonError, jsonPlain } from "../lib/json-response";
import { issueReferralLink, ReferralServiceError, type ReferralServiceEnv } from "../lib/referral-service";
import { requireReferralTokenPepper } from "../lib/referral-token";
import { hmacHex } from "../lib/crypto";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;
type PortalContext = Context<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const REFERRAL_PROGRAMME_ID = "rprog_samyak_skill_circle";
const REFERRAL_PUBLIC_ORIGIN = "https://go.samyaksion.com";

export function registerStudentRoutes(app: PortalHono) {
  app.get("/api/student/home", async (c) => {
    const session = await getSessionFromRequest(c);
    if (!session) {
      const response = jsonError(c, { status: 401, code: "unauthenticated", message: "Please sign in again." });
      if (hasSessionCookie(c)) response.headers.append("Set-Cookie", clearSessionCookie(c));
      return response;
    }
    if ((session.record.active_subject_type || "person") !== "person") {
      return jsonError(c, { status: 409, code: "profile_required", message: "Select a profile first." });
    }
    const view = await sessionView(c, session.record.login_account_id, session.record.active_person_id);
    if (!view.activeProfile) {
      return jsonError(c, { status: 409, code: "profile_required", message: "Select a profile first." });
    }
    if (!view.activeProfile.effectiveRoles?.some((role) => role === "student" || role === "alumni")) {
      return jsonError(c, { status: 403, code: "student_profile_required", message: "This profile is not available." });
    }
    try {
      return jsonPlain(c, await fetchStudentHomeForActiveProfile(c, view.activeProfile.personId));
    } catch {
      return jsonError(c, { status: 503, code: "student_home_unavailable", message: "Student dashboard is temporarily unavailable." });
    }
  });

  app.get("/api/student/referrals", async (c) => {
    const session = await getSessionFromRequest(c);
    if (!session) {
      const response = jsonError(c, { status: 401, code: "unauthenticated", message: "Please sign in again." });
      if (hasSessionCookie(c)) response.headers.append("Set-Cookie", clearSessionCookie(c));
      return response;
    }
    if ((session.record.active_subject_type || "person") !== "person") {
      return jsonError(c, { status: 409, code: "profile_required", message: "Select a profile first." });
    }
    const view = await sessionView(c, session.record.login_account_id, session.record.active_person_id);
    if (!view.activeProfile) {
      return jsonError(c, { status: 409, code: "profile_required", message: "Select a profile first." });
    }
    try {
      return jsonPlain(c, await fetchDashboardForActiveProfile(c, view.activeProfile.personId, dashboardPagination(c)));
    } catch {
      return jsonError(c, { status: 503, code: "dashboard_unavailable", message: "Referral dashboard is temporarily unavailable." });
    }
  });

  app.post("/api/referrals/link", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const context = await authenticatedReferrerContext(c);
    if (context instanceof Response) return context;
    const limited = await enforceLinkActionLimit(c, context.session.record.login_account_id, "referral_link_issue", 5, 60 * 60);
    if (limited) return limited;
    try {
      const issued = await issueReferralLink(referralEnv(c), {
        organisationId: ORG_ID,
        referralProgrammeId: REFERRAL_PROGRAMME_ID,
        referrerProfileId: context.referrer.id,
        loginAccountId: context.session.record.login_account_id,
        personId: context.view.activeProfile?.personId || null,
      });
      await recordAuthEvent(c, "referral_link_issue", issued.issued ? "CREATED" : "ACTIVE_EXISTS", { loginAccountId: context.session.record.login_account_id, ipHash: await ipHash(c) });
      if (!issued.issued || !issued.rawToken) {
        return jsonPlain(c, {
          created: false,
          hasActiveLink: true,
          lastFour: issued.link.tokenLastFour,
          activatedAt: issued.link.activatedAt,
          expiresAt: issued.link.expiresAt,
          message: "Your account already has an active referral link. Open the referrals dashboard to copy it, or contact Samyak if you need a replacement.",
        });
      }
      return jsonPlain(c, {
        created: true,
        link: buildPublicReferralUrl(issued.rawToken),
        shownOnce: true,
        lastFour: issued.link.tokenLastFour,
      }, { status: 201 });
    } catch (error) {
      return linkServiceError(c, error);
    }
  });

  app.post("/api/referrals/link/rotate", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const context = await authenticatedReferrerContext(c);
    if (context instanceof Response) return context;
    await recordAuthEvent(c, "referral_link_rotate", "DENIED_SELF_SERVICE", { loginAccountId: context.session.record.login_account_id, ipHash: await ipHash(c) });
    return jsonError(c, {
      status: 403,
      code: "self_rotation_disabled",
      message: "Contact Samyak if your active referral link needs to be replaced.",
    });
  });
}

async function authenticatedReferrerContext(c: PortalContext) {
  const session = await getSessionFromRequest(c);
  if (!session) {
    const response = jsonError(c, { status: 401, code: "unauthenticated", message: "Please sign in again." });
    if (hasSessionCookie(c)) response.headers.append("Set-Cookie", clearSessionCookie(c));
    return response;
  }
  if ((session.record.active_subject_type || "person") !== "person") {
    return jsonError(c, { status: 409, code: "profile_required", message: "Select a profile first." });
  }
  const view = await sessionView(c, session.record.login_account_id, session.record.active_person_id);
  if (!view.activeProfile) return jsonError(c, { status: 409, code: "profile_required", message: "Select a profile first." });
  const referrer = await activeReferrerForPerson(c, view.activeProfile.personId);
  if (!referrer) return jsonError(c, { status: 403, code: "referrer_not_eligible", message: "This profile is not eligible for referral links." });
  return { session, view, referrer };
}

function referralEnv(c: PortalContext): ReferralServiceEnv {
  return {
    DB: c.env.DB,
    SESSION_PEPPER: c.env.SESSION_PEPPER,
    referralTokenPepper: requireReferralTokenPepper(referralTokenPepperSecret(c.env)),
  };
}

function referralTokenPepperSecret(env: WorkerBindings) {
  const binding = ["REFERRAL", "TOKEN", "PEPPER"].join("_") as keyof WorkerBindings;
  return String(env[binding] || "");
}

async function enforceLinkActionLimit(c: PortalContext, loginAccountId: string, eventType: string, maxCount: number, windowSeconds: number) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const count = await c.env.DB.prepare(
    `select count(*) as count
     from auth_events
     where login_account_id = ?
       and event_type = ?
       and result_code not in ('RATE_LIMITED')
       and created_at >= ?`,
  )
    .bind(loginAccountId, eventType, since)
    .first<{ count: number }>();
  if (Number(count?.count || 0) < maxCount) return null;
  await recordAuthEvent(c, eventType, "RATE_LIMITED", { loginAccountId, ipHash: await ipHash(c) });
  return c.json(
    {
      success: false,
      error: {
        code: "rate_limited",
        message: "Please wait before trying again.",
        requestId: c.get("requestId"),
      },
    },
    429,
    { "Retry-After": String(windowSeconds) },
  );
}

async function ipHash(c: PortalContext) {
  return hmacHex(c.env.SESSION_PEPPER, "ip", getClientIp(c));
}

function buildPublicReferralUrl(rawToken: string) {
  return `${REFERRAL_PUBLIC_ORIGIN}/r/${encodeURIComponent(rawToken)}`;
}

function dashboardPagination(c: PortalContext) {
  const url = new URL(c.req.url);
  return {
    limit: clampInteger(url.searchParams.get("limit"), 25, 1, 50),
    offset: clampInteger(url.searchParams.get("offset"), 0, 0, 5000),
  };
}

function clampInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function linkServiceError(c: PortalContext, error: unknown) {
  if (error instanceof ReferralServiceError) {
    const status = error.code === "invalid_referrer" ? 403 : error.code === "inactive_programme" ? 409 : 500;
    return jsonError(c, { status, code: error.code, message: "Referral link is temporarily unavailable." });
  }
  return jsonError(c, { status: 500, code: "link_unavailable", message: "Referral link is temporarily unavailable." });
}
