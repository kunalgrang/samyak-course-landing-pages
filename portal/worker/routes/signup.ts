import { z } from "zod";
import type { Hono } from "hono";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import {
  buildSessionCookie,
  checkOtpRequestLimits,
  createPendingChallenge,
  createSession,
  decryptChallengeMobile,
  getChallenge,
  incrementChallengeAttemptsIfAllowed,
  markChallengeFailed,
  markChallengeVerified,
  markRequestedChallengeSent,
  mobileHash,
  recordAuthEvent,
  requestFingerprint,
  runDummyOtpComparison,
  updateChallengeResent,
  OTP_MAX_ATTEMPTS,
} from "../lib/auth-store";
import { isResponse, jsonWithRequestId, readJsonBody, requireSameOrigin, getClientIp } from "../lib/http";
import { maskMobile, normalizeIndianMobile } from "../lib/mobile";
import { getOtpProvider } from "../lib/otp-provider";
import { validateTurnstile } from "../lib/turnstile";
import { jsonError } from "../lib/json-response";
import {
  CENTRE_OPERATING_MODELS,
  CENTRE_STATUSES,
  LEGAL_ENTITY_TYPES,
  ORGANISATION_TYPES,
  createOrganisationFromSignup,
  createSignupVerification,
} from "../lib/organisation-signup";

type PortalHono = Hono<{
  Bindings: WorkerBindings;
  Variables: WorkerVariables;
}>;

const requestSignupOtpSchema = z.object({
  mobile: z.string().min(1).max(40),
  turnstileToken: z.string().min(1).max(4096),
});

const challengeSchema = z.object({
  challengeId: z.string().min(8).max(120),
});

const verifySignupOtpSchema = challengeSchema.extend({
  otp: z.string().regex(/^\d{4,9}$/),
});

const signupCreateSchema = z.object({
  signupVerificationId: z.string().min(8).max(120),
  idempotencyKey: z.string().min(8).max(160),
  organisation: z.object({
    brandName: z.string().min(1).max(160),
    legalName: z.string().min(1).max(200),
    organisationType: z.enum(ORGANISATION_TYPES),
    legalEntityType: z.enum(LEGAL_ENTITY_TYPES),
    address: z.string().min(1).max(300),
    city: z.string().min(1).max(120),
    stateRegion: z.string().min(1).max(120),
    country: z.string().min(1).max(80),
    postcode: z.string().max(20).optional(),
    website: z.string().max(200).optional(),
    logoUrl: z.string().max(500).optional(),
    pan: z.string().max(20).optional(),
    gstin: z.string().max(24).optional(),
    currency: z.string().max(12).optional(),
    timezone: z.string().max(80).optional(),
    termsAccepted: z.boolean(),
  }),
  authority: z.object({
    name: z.string().min(1).max(160),
    mobile: z.string().min(1).max(40),
    email: z.string().min(3).max(200),
    documentReference: z.string().max(240).optional(),
  }),
  onboarding: z.object({
    reportedCentreCount: z.number().int().min(1).max(500),
  }),
  centre: z.object({
    name: z.string().min(1).max(160),
    address: z.string().min(1).max(300),
    city: z.string().min(1).max(120),
    stateRegion: z.string().max(120).optional().default(""),
    postcode: z.string().min(1).max(20),
    country: z.string().min(1).max(80),
    mobile: z.string().min(1).max(40),
    email: z.string().max(200).optional(),
    operatingModel: z.enum(CENTRE_OPERATING_MODELS),
    status: z.enum(CENTRE_STATUSES),
    currency: z.string().max(12).optional(),
    timezone: z.string().max(80).optional(),
    pan: z.string().max(20).optional(),
    gstin: z.string().max(24).optional(),
  }),
});

const genericOtpMessage = "If this mobile number can sign up, an OTP has been sent.";

export function registerSignupRoutes(app: PortalHono) {
  app.post("/api/signup/request-otp", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, requestSignupOtpSchema);
    if (isResponse(body)) return body;

    const mobile = normalizeIndianMobile(body.mobile);
    if (!mobile) return jsonError(c, { status: 400, code: "INVALID_MOBILE", message: "Enter a valid Indian mobile number." });

    const hostname = new URL(c.req.url).hostname;
    const provider = getOtpProvider(c.env, hostname);
    if (!provider) {
      return jsonWithRequestId(c, { success: false, code: "OTP_SERVICE_PENDING", message: "Mobile signup is temporarily unavailable." }, 503);
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
      await recordAuthEvent(c, "signup_otp_request", "RATE_LIMITED", { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
      return jsonWithRequestId(c, { success: false, code: "RATE_LIMITED", message: "Please wait before requesting another OTP." }, 429);
    }

    const challengeId = await createPendingChallenge({ c, hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
    const sent = await provider.sendOtp(mobile);
    if (!sent.ok) {
      await markChallengeFailed(c, challengeId);
      await recordAuthEvent(c, "signup_otp_request", sent.resultCode, { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
      return jsonWithRequestId(c, { success: false, code: "OTP_SEND_FAILED", message: "Mobile signup is temporarily unavailable." }, 503);
    }
    await markRequestedChallengeSent({ c, challengeId, mobile, provider: provider.name, providerRequestId: sent.providerRequestId });
    await recordAuthEvent(c, "signup_otp_request", "OTP_SENT", { mobileHash: hash, mobileLastFour: mobile.slice(-4), ipHash: fingerprint.ipHash });
    return jsonWithRequestId(c, { success: true, challengeId, maskedMobile: maskMobile(mobile), message: genericOtpMessage });
  });

  app.post("/api/signup/resend-otp", async (c) => {
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
    if (!mobile || !provider) return jsonWithRequestId(c, { success: false, code: "OTP_SERVICE_PENDING", message: "Mobile signup is temporarily unavailable." }, 503);
    const result = await provider.resendOtp(mobile);
    if (!result.ok) {
      await markChallengeFailed(c, challenge.id);
      return jsonWithRequestId(c, { success: false, code: "OTP_SEND_FAILED", message: "Mobile signup is temporarily unavailable." }, 503);
    }
    const updated = await updateChallengeResent(c, challenge.id, result.providerRequestId);
    if (!updated) return jsonWithRequestId(c, { success: false, code: "RESEND_LIMITED", message: "Please use the latest OTP or change number." }, 429);
    return jsonWithRequestId(c, { success: true, message: genericOtpMessage });
  });

  app.post("/api/signup/verify-otp", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, verifySignupOtpSchema);
    if (isResponse(body)) return body;

    const challenge = await getChallenge(c, body.challengeId);
    if (!challenge || !["sent", "blocked"].includes(challenge.status) || Date.parse(challenge.expires_at) <= Date.now()) {
      return jsonWithRequestId(c, { success: false, code: "OTP_EXPIRED", message: "The OTP has expired. Please request a new one." }, 400);
    }
    if (challenge.verification_attempts >= OTP_MAX_ATTEMPTS) {
      return jsonWithRequestId(c, { success: false, code: "TOO_MANY_ATTEMPTS", message: "Too many attempts. Please request a new OTP." }, 429);
    }
    const attemptRecorded = await incrementChallengeAttemptsIfAllowed(c, challenge.id);
    if (!attemptRecorded) return jsonWithRequestId(c, { success: false, code: "OTP_EXPIRED", message: "The OTP has expired. Please request a new one." }, 400);
    if (challenge.status === "blocked") {
      await runDummyOtpComparison(c, body.otp);
      return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    }
    const mobile = await decryptChallengeMobile(c, challenge);
    const provider = getOtpProvider(c.env, new URL(c.req.url).hostname);
    if (!mobile || !provider) return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    const providerResult = await provider.verifyOtp(mobile, body.otp);
    if (!providerResult.ok) {
      await recordAuthEvent(c, "signup_otp_verify", providerResult.resultCode, { mobileHash: challenge.mobile_hash, mobileLastFour: challenge.mobile_last_four });
      return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    }
    const verified = await markChallengeVerified(c, challenge.id);
    if (!verified) return jsonWithRequestId(c, { success: false, code: "INVALID_OTP", message: "The OTP could not be verified." }, 400);
    const signup = await createSignupVerification(c, challenge.id, mobile);
    await recordAuthEvent(c, "signup_otp_verify", "SIGNUP_VERIFIED", { mobileHash: challenge.mobile_hash, mobileLastFour: challenge.mobile_last_four });
    return jsonWithRequestId(c, { success: true, ...signup });
  });

  app.post("/api/signup/create-organisation", async (c) => {
    const originError = requireSameOrigin(c);
    if (originError) return originError;
    const body = await readJsonBody(c, signupCreateSchema);
    if (isResponse(body)) return body;
    const authorityMobile = normalizeIndianMobile(body.authority.mobile);
    const centreMobile = normalizeIndianMobile(body.centre.mobile);
    if (!authorityMobile || !centreMobile) return jsonWithRequestId(c, { success: false, code: "INVALID_MOBILE", message: "Enter valid Indian mobile numbers." }, 400);

    const created = await createOrganisationFromSignup(c, {
      ...body,
      authority: { ...body.authority, mobile: authorityMobile },
      centre: { ...body.centre, mobile: centreMobile },
    });
    if (!created.ok) return jsonWithRequestId(c, { success: false, code: created.code, message: created.message }, created.status as 400 | 403);

    const token = await createSession(c, created.result.login_account_id, created.result.person_id);
    const response = jsonWithRequestId(c, {
      success: true,
      organisation: {
        id: created.result.organisation_id,
        name: created.result.organisation_name,
      },
      trial: {
        startedAt: created.result.trial_started_at,
        endsAt: created.result.trial_ends_at,
      },
    });
    response.headers.append("Set-Cookie", buildSessionCookie(c, token));
    return response;
  });
}
