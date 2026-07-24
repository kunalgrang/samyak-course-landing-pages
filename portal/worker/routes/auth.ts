import { z } from "zod";
import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { callPortalLookup } from "../lib/apps-script";
import {
  bootstrapAccount,
  buildSessionCookie,
  checkOtpRequestLimits,
  clearSessionCookie,
  createChallenge,
  createSession,
  decryptChallengeMobile,
  getChallenge,
  getSessionFromRequest,
  incrementChallengeAttempts,
  markChallengeVerified,
  mobileHash,
  recordAuditLog,
  recordAuthEvent,
  requestFingerprint,
  revokeSession,
  selectLinkedProfile,
  sessionView,
  updateChallengeResent,
} from "../lib/auth-store";
import { isResponse, jsonWithRequestId, readJsonBody, requireSameOrigin, getClientIp } from "../lib/http";
import { maskMobile, normalizeIndianMobile } from "../lib/mobile";
import { getOtpProvider } from "../lib/otp-provider";
import { validateTurnstile } from "../lib/turnstile";
import { jsonError } from "../lib/json-response";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const requestOtpSchema = z.object({
  mobile: z.string().min(1).max(40),
  turnstileToken: z.string().min(1).max(4096),
});

const challengeSchema = z.object({
  challengeId: z.string().min(8).max(120),
});

const verifyOtpSchema = challengeSchema.extend({
  otp: z.string().regex(/^\d{4,9}$/),
});

const selectProfileSchema = z.object({
  personId: z.string().min(1).max(120),
});

const genericOtpMessage = "If this mobile number is registered, an OTP has been sent.";

export function registerAuthRoutes(app: PortalHono) {
  app.post("/api/auth/request-otp", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, requestOtpSchema);
    if (isResponse(body)) return body;

    const mobile = normalizeIndianMobile(body.mobile);
    if (!mobile) {
      return jsonError(c, { status: 400, code: "INVALID_MOBILE", message: "Enter a valid Indian mobile number." });
    }

    const hostname = new URL(c.req.url).hostname;
    const provider = getOtpProvider(c.env, hostname);
    if (!provider) {
      return jsonWithRequestId(
        c,
        { success: false, code: "OTP_SERVICE_PENDING", message: "Mobile login is temporarily unavailable." },
        503,
      );
    }

    const turnstile = await validateTurnstile({
      env: c.env,
      token: body.turnstileToken,
      expectedAction: "request-otp",
      hostname,
      remoteIp: getClientIp(c),
    });
    if (!turnstile.ok) {
      return jsonWithRequestId(c, { success: false, code: "TURNSTILE_FAILED", message: "Verification failed. Please try again." }, 403);
    }

    const hash = await mobileHash(c, mobile);
    const fingerprint = await requestFingerprint(c);
    const allowed = await checkOtpRequestLimits(c, hash, fingerprint.ipHash);
    if (!allowed) {
      await recordAuthEvent(c, "otp_request", "RATE_LIMITED", { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
      return jsonWithRequestId(c, { success: false, code: "RATE_LIMITED", message: "Please wait before requesting another OTP." }, 429);
    }

    let lookup;
    try {
      lookup = await callPortalLookup(c.env, mobile);
    } catch {
      await recordAuthEvent(c, "otp_request", "APPS_SCRIPT_ERROR", { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
      return jsonWithRequestId(c, { success: false, code: "OTP_SERVICE_PENDING", message: "Mobile login is temporarily unavailable." }, 503);
    }

    let providerRequestId: string | undefined;
    if (lookup.eligible) {
      const sent = await provider.sendOtp(mobile);
      providerRequestId = sent.providerRequestId;
      if (!sent.ok) {
        await recordAuthEvent(c, "otp_request", sent.resultCode, { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
        return jsonWithRequestId(c, { success: false, code: "OTP_SEND_FAILED", message: "Mobile login is temporarily unavailable." }, 503);
      }
    }

    const challengeId = await createChallenge({
      c,
      mobile,
      hash,
      ipHash: fingerprint.ipHash,
      provider: lookup.eligible ? provider.name : "none",
      eligible: lookup.eligible,
      providerRequestId,
    });
    await recordAuthEvent(c, "otp_request", lookup.eligible ? "OTP_SENT" : "NOT_ELIGIBLE_SHAPED", {
      mobileHash: hash,
      mobileLastFour: mobile.slice(-4),
      ipHash: fingerprint.ipHash,
    });
    return jsonWithRequestId(c, { success: true, challengeId, maskedMobile: maskMobile(mobile), message: genericOtpMessage });
  });

  app.post("/api/auth/resend-otp", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, challengeSchema);
    if (isResponse(body)) return body;

    const challenge = await getChallenge(c, body.challengeId);
    if (!challenge || challenge.status !== "sent" || !challenge.mobile_ciphertext) {
      return jsonWithRequestId(c, { success: true, message: genericOtpMessage });
    }
    if (challenge.resend_count >= 2) {
      return jsonWithRequestId(c, { success: false, code: "RESEND_LIMITED", message: "Please use the latest OTP or change number." }, 429);
    }
    if (challenge.last_sent_at && Date.parse(challenge.last_sent_at) > Date.now() - 60_000) {
      return jsonWithRequestId(c, { success: false, code: "RESEND_COOLDOWN", message: "Please wait before resending OTP." }, 429);
    }
    const mobile = await decryptChallengeMobile(c, challenge);
    const provider = getOtpProvider(c.env, new URL(c.req.url).hostname);
    if (!mobile || !provider) return jsonWithRequestId(c, { success: false, code: "OTP_SERVICE_PENDING", message: "Mobile login is temporarily unavailable." }, 503);
    const result = await provider.resendOtp(mobile);
    if (!result.ok) return jsonWithRequestId(c, { success: false, code: "OTP_SEND_FAILED", message: "Mobile login is temporarily unavailable." }, 503);
    await updateChallengeResent(c, challenge.id, result.providerRequestId);
    return jsonWithRequestId(c, { success: true, message: genericOtpMessage });
  });

  app.post("/api/auth/verify-otp", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, verifyOtpSchema);
    if (isResponse(body)) return body;

    const challenge = await getChallenge(c, body.challengeId);
    if (!challenge || challenge.status !== "sent" || Date.parse(challenge.expires_at) <= Date.now()) {
      return jsonWithRequestId(c, { success: false, code: "OTP_EXPIRED", message: "The OTP has expired. Please request a new one." }, 400);
    }
    if (challenge.verification_attempts >= 5) {
      return jsonWithRequestId(c, { success: false, code: "TOO_MANY_ATTEMPTS", message: "Too many attempts. Please request a new OTP." }, 429);
    }
    await incrementChallengeAttempts(c, challenge.id);

    const mobile = await decryptChallengeMobile(c, challenge);
    const provider = getOtpProvider(c.env, new URL(c.req.url).hostname);
    if (!mobile || !provider) {
      return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    }
    const providerResult = await provider.verifyOtp(mobile, body.otp);
    if (!providerResult.ok) {
      await recordAuthEvent(c, "otp_verify", providerResult.resultCode, {
        mobileHash: challenge.mobile_hash,
        mobileLastFour: challenge.mobile_last_four,
      });
      return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    }

    const lookup = await callPortalLookup(c.env, mobile);
    if (!lookup.eligible) {
      return jsonWithRequestId(c, { success: false, code: "PROFILE_NOT_AVAILABLE", message: "Mobile login is temporarily unavailable." }, 403);
    }
    const accountId = await bootstrapAccount(c, mobile, lookup);
    const activePersonId = lookup.profiles.length === 1 ? `person_${lookup.profiles[0].externalReferrerId.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)}` : null;
    const token = await createSession(c, accountId, activePersonId);
    await markChallengeVerified(c, challenge.id);
    await recordAuthEvent(c, "otp_verify", "LOGIN_SUCCESS", { loginAccountId: accountId, mobileHash: challenge.mobile_hash, mobileLastFour: challenge.mobile_last_four });
    await recordAuditLog(c, accountId, activePersonId, "login");
    const session = await sessionView(c, accountId, activePersonId);
    const response = jsonWithRequestId(c, { success: true, session }, 200);
    response.headers.append("Set-Cookie", buildSessionCookie(c, token));
    return response;
  });

  app.get("/api/auth/session", async (c) => {
    const session = await getSessionFromRequest(c);
    if (!session) return jsonWithRequestId(c, { authenticated: false, activeProfile: null, profiles: [] });
    return jsonWithRequestId(c, await sessionView(c, session.record.login_account_id, session.record.active_person_id));
  });

  app.post("/api/auth/select-profile", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, selectProfileSchema);
    if (isResponse(body)) return body;
    const session = await getSessionFromRequest(c);
    if (!session) return jsonWithRequestId(c, { success: false, code: "UNAUTHENTICATED", message: "Please sign in again." }, 401);
    const selected = await selectLinkedProfile(c, session.record.id, session.record.login_account_id, body.personId);
    if (!selected) return jsonWithRequestId(c, { success: false, code: "PROFILE_NOT_LINKED", message: "This profile is not available." }, 403);
    return jsonWithRequestId(c, { success: true, session: await sessionView(c, session.record.login_account_id, body.personId) });
  });

  app.post("/api/auth/logout", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const session = await getSessionFromRequest(c);
    if (session) {
      await revokeSession(c, session.tokenHash);
      await recordAuthEvent(c, "logout", "LOGOUT", { loginAccountId: session.record.login_account_id });
    }
    const response = jsonWithRequestId(c, { success: true });
    response.headers.append("Set-Cookie", clearSessionCookie(c));
    return response;
  });
}
