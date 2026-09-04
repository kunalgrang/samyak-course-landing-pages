import { z } from "zod";
import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import {
  bootstrapPartnerAccount,
  buildSessionCookie,
  checkOtpRequestLimits,
  clearSessionCookie,
  createPendingChallenge,
  createSession,
  decryptChallengeMobile,
  getChallenge,
  getSessionFromRequest,
  getSessionValidationResult,
  hasSessionCookie,
  incrementChallengeAttemptsIfAllowed,
  lookupEducationPartnersByMobile,
  markChallengeFailed,
  markChallengeVerified,
  markRequestedChallengeBlocked,
  markRequestedChallengeSent,
  mobileHash,
  partnerSessionView,
  recordAuditLog,
  recordAuthEvent,
  requestFingerprint,
  requireAuthenticatedPartner,
  revokeSession,
  runDummyOtpComparison,
  selectLinkedPartner,
  updateChallengeResent,
  OTP_MAX_ATTEMPTS,
} from "../lib/auth-store";
import { buildPartnerPortalView } from "../lib/partner-portal";
import { isResponse, jsonWithRequestId, readJsonBody, requireSameOrigin, getClientIp } from "../lib/http";
import { jsonError } from "../lib/json-response";
import { maskMobile, normalizeIndianMobile } from "../lib/mobile";
import { getOtpProvider } from "../lib/otp-provider";
import { validateTurnstile } from "../lib/turnstile";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const requestOtpSchema = z.object({
  mobile: z.string().min(1).max(40),
  turnstileToken: z.string().min(1).max(4096),
});
const challengeSchema = z.object({ challengeId: z.string().min(8).max(120) });
const verifyOtpSchema = challengeSchema.extend({ otp: z.string().regex(/^\d{4,9}$/) });
const selectPartnerSchema = z.object({ educationPartnerId: z.string().min(1).max(120) });
const genericOtpMessage = "If this mobile number is registered, an OTP has been sent.";

export function registerPartnerRoutes(app: PortalHono) {
  app.post("/api/partner/auth/request-otp", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, requestOtpSchema);
    if (isResponse(body)) return body;
    const mobile = normalizeIndianMobile(body.mobile);
    if (!mobile) return jsonError(c, { status: 400, code: "INVALID_MOBILE", message: "Enter a valid Indian mobile number." });

    const hostname = new URL(c.req.url).hostname;
    const provider = getOtpProvider(c.env, hostname);
    if (!provider) return jsonWithRequestId(c, { success: false, code: "OTP_SERVICE_PENDING", message: "Mobile login is temporarily unavailable." }, 503);

    const turnstile = await validateTurnstile({
      env: c.env,
      token: body.turnstileToken,
      expectedAction: "request-otp",
      hostname,
      remoteIp: getClientIp(c),
    });
    if (!turnstile.ok) return jsonWithRequestId(c, { success: false, code: "TURNSTILE_FAILED", message: "Verification failed. Please try again." }, 403);

    const hash = await mobileHash(c, mobile);
    const fingerprint = await requestFingerprint(c);
    const allowed = await checkOtpRequestLimits(c, hash, fingerprint.ipHash);
    if (!allowed) {
      await recordAuthEvent(c, "partner_otp_request", "RATE_LIMITED", { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
      return jsonWithRequestId(c, { success: false, code: "RATE_LIMITED", message: "Please wait before requesting another OTP." }, 429);
    }

    const challengeId = await createPendingChallenge({ c, hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
    const lookup = await lookupEducationPartnersByMobile(c, mobile);
    if (!lookup.eligible) {
      await markRequestedChallengeBlocked(c, challengeId);
      await recordAuthEvent(c, "partner_otp_request", "NOT_ELIGIBLE_SHAPED", { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
      return jsonWithRequestId(c, { success: true, challengeId, maskedMobile: maskMobile(mobile), message: genericOtpMessage });
    }

    const sent = await provider.sendOtp(mobile);
    if (!sent.ok) {
      await markChallengeFailed(c, challengeId);
      await recordAuthEvent(c, "partner_otp_request", sent.resultCode, { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
      return jsonWithRequestId(c, { success: false, code: "OTP_SEND_FAILED", message: "Mobile login is temporarily unavailable." }, 503);
    }
    await markRequestedChallengeSent({ c, challengeId, mobile, provider: provider.name, providerRequestId: sent.providerRequestId });
    await recordAuthEvent(c, "partner_otp_request", "OTP_SENT", { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
    return jsonWithRequestId(c, { success: true, challengeId, maskedMobile: maskMobile(mobile), message: genericOtpMessage });
  });

  app.post("/api/partner/auth/resend-otp", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, challengeSchema);
    if (isResponse(body)) return body;
    const challenge = await getChallenge(c, body.challengeId);
    if (!challenge || challenge.status !== "sent" || !challenge.mobile_ciphertext) return jsonWithRequestId(c, { success: true, message: genericOtpMessage });
    if (challenge.resend_count >= 2) return jsonWithRequestId(c, { success: false, code: "RESEND_LIMITED", message: "Please use the latest OTP or change number." }, 429);
    if (challenge.last_sent_at && Date.parse(challenge.last_sent_at) > Date.now() - 60_000) {
      return jsonWithRequestId(c, { success: false, code: "RESEND_COOLDOWN", message: "Please wait before resending OTP." }, 429);
    }
    const mobile = await decryptChallengeMobile(c, challenge);
    const provider = getOtpProvider(c.env, new URL(c.req.url).hostname);
    if (!mobile || !provider) return jsonWithRequestId(c, { success: false, code: "OTP_SERVICE_PENDING", message: "Mobile login is temporarily unavailable." }, 503);
    const result = await provider.resendOtp(mobile);
    if (!result.ok) {
      await markChallengeFailed(c, challenge.id);
      return jsonWithRequestId(c, { success: false, code: "OTP_SEND_FAILED", message: "Mobile login is temporarily unavailable." }, 503);
    }
    const updated = await updateChallengeResent(c, challenge.id, result.providerRequestId);
    if (!updated) return jsonWithRequestId(c, { success: false, code: "RESEND_LIMITED", message: "Please use the latest OTP or change number." }, 429);
    return jsonWithRequestId(c, { success: true, message: genericOtpMessage });
  });

  app.post("/api/partner/auth/verify-otp", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, verifyOtpSchema);
    if (isResponse(body)) return body;
    const challenge = await getChallenge(c, body.challengeId);
    if (!challenge || !["sent", "blocked"].includes(challenge.status) || Date.parse(challenge.expires_at) <= Date.now()) {
      return jsonWithRequestId(c, { success: false, code: "OTP_EXPIRED", message: "The OTP has expired. Please request a new one." }, 400);
    }
    if (challenge.verification_attempts >= OTP_MAX_ATTEMPTS) return jsonWithRequestId(c, { success: false, code: "TOO_MANY_ATTEMPTS", message: "Too many attempts. Please request a new OTP." }, 429);
    const attemptRecorded = await incrementChallengeAttemptsIfAllowed(c, challenge.id);
    if (!attemptRecorded) return jsonWithRequestId(c, { success: false, code: "OTP_EXPIRED", message: "The OTP has expired. Please request a new one." }, 400);
    if (challenge.status === "blocked") {
      await runDummyOtpComparison(c, body.otp);
      await recordAuthEvent(c, "partner_otp_verify", "INVALID_OTP", { mobileHash: challenge.mobile_hash, mobileLastFour: challenge.mobile_last_four });
      return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    }

    const mobile = await decryptChallengeMobile(c, challenge);
    const provider = getOtpProvider(c.env, new URL(c.req.url).hostname);
    if (!mobile || !provider) return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    const providerResult = await provider.verifyOtp(mobile, body.otp);
    if (!providerResult.ok) {
      await recordAuthEvent(c, "partner_otp_verify", providerResult.resultCode, { mobileHash: challenge.mobile_hash, mobileLastFour: challenge.mobile_last_four });
      return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    }
    const lookup = await lookupEducationPartnersByMobile(c, mobile);
    if (!lookup.eligible) return jsonWithRequestId(c, { success: false, code: "PROFILE_NOT_AVAILABLE", message: "Mobile login is temporarily unavailable." }, 403);
    const verified = await markChallengeVerified(c, challenge.id);
    if (!verified) return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    const accountId = await bootstrapPartnerAccount(c, mobile, lookup);
    const activePartnerId = lookup.partners.length === 1 ? lookup.partners[0].educationPartnerId : null;
    const token = await createSession(c, accountId, null, activePartnerId, "partner");
    await recordAuthEvent(c, "partner_otp_verify", "LOGIN_SUCCESS", { loginAccountId: accountId, mobileHash: challenge.mobile_hash, mobileLastFour: challenge.mobile_last_four });
    await recordAuditLog(c, accountId, null, "partner_login");
    const response = jsonWithRequestId(c, { success: true, session: await partnerSessionView(c, accountId, activePartnerId) });
    response.headers.append("Set-Cookie", buildSessionCookie(c, token));
    return response;
  });

  app.get("/api/partner/session", async (c) => {
    const validation = await getSessionValidationResult(c);
    const session = validation.session;
    if (!session) {
      const expired = validation.resultCode === "SESSION_ABSOLUTE_EXPIRED" || validation.resultCode === "SESSION_INACTIVE_EXPIRED";
      const response = jsonWithRequestId(c, {
        authenticated: false,
        activePartner: null,
        partners: [],
        code: validation.resultCode,
        ...(expired ? { message: "Your session has expired. Please sign in again." } : {}),
      });
      if (validation.shouldClearCookie && hasSessionCookie(c)) response.headers.append("Set-Cookie", clearSessionCookie(c));
      return response;
    }
    if (session.record.active_person_id || session.record.active_subject_type === "person" || session.record.active_subject_type === "trainer") {
      return jsonWithRequestId(c, {
        authenticated: false,
        activePartner: null,
        partners: [],
        code: "PERSON_SESSION_ACTIVE",
        message: "Please sign in to Partner Portal.",
      });
    }
    return jsonWithRequestId(c, await partnerSessionView(c, session.record.login_account_id, session.record.active_education_partner_id || null));
  });

  app.post("/api/partner/auth/select-profile", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, selectPartnerSchema);
    if (isResponse(body)) return body;
    const session = await getSessionFromRequest(c);
    if (!session) return jsonWithRequestId(c, { success: false, code: "UNAUTHENTICATED", message: "Please sign in again." }, 401);
    if (session.record.active_person_id || session.record.active_subject_type === "person" || session.record.active_subject_type === "trainer") return jsonWithRequestId(c, { success: false, code: "PERSON_SESSION_ACTIVE", message: "Please sign in to Partner Portal." }, 401);
    const selected = await selectLinkedPartner(c, session.record.id, session.record.login_account_id, body.educationPartnerId);
    if (!selected) return jsonWithRequestId(c, { success: false, code: "PROFILE_NOT_LINKED", message: "This partner profile is not available." }, 403);
    return jsonWithRequestId(c, { success: true, session: await partnerSessionView(c, session.record.login_account_id, body.educationPartnerId) });
  });

  app.post("/api/partner/auth/logout", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const session = await getSessionFromRequest(c);
    if (session) {
      await revokeSession(c, session.tokenHash);
      await recordAuthEvent(c, "partner_logout", "LOGOUT", { loginAccountId: session.record.login_account_id });
    }
    const response = jsonWithRequestId(c, { success: true });
    response.headers.append("Set-Cookie", clearSessionCookie(c));
    return response;
  });

  app.get("/api/partner/me", async (c) => {
    const authenticated = await requireAuthenticatedPartner(c);
    if (!authenticated) return jsonError(c, { status: 401, code: "unauthenticated", message: "Partner sign-in is required." });
    const view = await buildPartnerPortalView(c, authenticated.activePartner.educationPartnerId, paginationFromUrl(c.req.url));
    if (!view || view.partner.status !== "active") return jsonError(c, { status: 403, code: "partner_unavailable", message: "This partner profile is not available." });
    return jsonWithRequestId(c, view);
  });

  app.get("/api/partner/referrals", async (c) => {
    const authenticated = await requireAuthenticatedPartner(c);
    if (!authenticated) return jsonError(c, { status: 401, code: "unauthenticated", message: "Partner sign-in is required." });
    const view = await buildPartnerPortalView(c, authenticated.activePartner.educationPartnerId, paginationFromUrl(c.req.url));
    if (!view || view.partner.status !== "active") return jsonError(c, { status: 403, code: "partner_unavailable", message: "This partner profile is not available." });
    return jsonWithRequestId(c, { success: true, summary: view.summary, pagination: view.pagination, referrals: view.referrals });
  });

  app.get("/api/partner/referral-link", async (c) => {
    const authenticated = await requireAuthenticatedPartner(c);
    if (!authenticated) return jsonError(c, { status: 401, code: "unauthenticated", message: "Partner sign-in is required." });
    const view = await buildPartnerPortalView(c, authenticated.activePartner.educationPartnerId, { limit: 1, offset: 0 });
    if (!view || view.partner.status !== "active") return jsonError(c, { status: 403, code: "partner_unavailable", message: "This partner profile is not available." });
    return jsonWithRequestId(c, { success: true, referralLink: view.referralLink });
  });
}

function paginationFromUrl(urlValue: string) {
  const url = new URL(urlValue);
  return {
    limit: integerParam(url.searchParams.get("limit")),
    offset: integerParam(url.searchParams.get("offset")),
  };
}

function integerParam(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
