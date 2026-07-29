import { z } from "zod";

const healthResponseSchema = z.object({
  success: z.literal(true),
  service: z.literal("samyak-student-portal"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health", {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  const data: unknown = await response.json();
  return healthResponseSchema.parse(data);
}

const profileSchema = z.object({
  personId: z.string(),
  publicName: z.string(),
  accessType: z.string(),
  roles: z.array(z.string()).default([]),
});

export const sessionSchema = z.object({
  authenticated: z.boolean(),
  activeProfile: profileSchema.nullable(),
  profiles: z.array(profileSchema),
  mobileLastFour: z.string().optional(),
  requestId: z.string().optional(),
});

export type SessionResponse = z.infer<typeof sessionSchema>;

const publicConfigSchema = z.object({
  turnstileSiteKey: z.string(),
  otpEnabled: z.boolean(),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;

const requestOtpResponseSchema = z.object({
  success: z.boolean(),
  challengeId: z.string().optional(),
  maskedMobile: z.string().optional(),
  code: z.string().optional(),
  message: z.string(),
  requestId: z.string(),
});

export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

const verifyOtpResponseSchema = z.object({
  success: z.boolean(),
  code: z.string().optional(),
  message: z.string().optional(),
  session: sessionSchema.optional(),
  requestId: z.string(),
});

export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;

const dashboardSchema = z.object({
  success: z.literal(true),
  profile: z.object({
    externalReferrerId: z.string(),
    fullName: z.string(),
    publicName: z.string(),
    referrerType: z.string(),
    courseStudied: z.string(),
    memberSince: z.string(),
    personalLink: z.string(),
    active: z.boolean(),
  }),
  summary: z.object({
    totalReferrals: z.number(),
    successfulAdmissions: z.number(),
    cashRewardsEarned: z.number(),
    courseCreditEarned: z.number(),
  }),
  referrals: z.array(
    z.object({
      referralId: z.string(),
      prospectPublicName: z.string(),
      courseInterested: z.string(),
      submissionDate: z.string(),
      publicStatus: z.string(),
      rewardStatus: z.string(),
      rewardChoice: z.string(),
      cashReward: z.number(),
      courseCredit: z.number(),
      approvedRewardAmount: z.number(),
      rewardPaymentDate: z.string(),
    }),
  ),
});

export type ReferralDashboard = z.infer<typeof dashboardSchema>;

export async function getPublicConfig() {
  return getJson("/api/public-config", publicConfigSchema);
}

export async function getSession() {
  return getJson("/api/auth/session", sessionSchema);
}

export async function requestOtp(mobile: string, turnstileToken: string) {
  return postJson("/api/auth/request-otp", { mobile, turnstileToken }, requestOtpResponseSchema);
}

export async function resendOtp(challengeId: string) {
  return postJson("/api/auth/resend-otp", { challengeId }, requestOtpResponseSchema);
}

export async function verifyOtp(challengeId: string, otp: string) {
  return postJson("/api/auth/verify-otp", { challengeId, otp }, verifyOtpResponseSchema);
}

export async function selectProfile(personId: string) {
  return postJson("/api/auth/select-profile", { personId }, verifyOtpResponseSchema);
}

export async function logout() {
  return postJson("/api/auth/logout", {}, z.object({ success: z.boolean(), requestId: z.string() }));
}

export async function getReferralDashboard() {
  return getJson("/api/student/referrals", dashboardSchema);
}

async function getJson<T extends z.ZodType>(url: string, schema: T): Promise<z.infer<T>> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const data: unknown = await response.json();
  return schema.parse(data);
}

async function postJson<T extends z.ZodType>(url: string, body: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  return schema.parse(data);
}
