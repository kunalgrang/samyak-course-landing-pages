import { z } from "zod";
import type { WorkerBindings } from "../bindings";

export const portalProfileSchema = z.object({
  externalReferrerId: z.string(),
  fullName: z.string(),
  publicName: z.string(),
  referrerType: z.string(),
  referralToken: z.string(),
  personalLink: z.string(),
});

export const portalLookupSchema = z.object({
  success: z.literal(true),
  eligible: z.boolean(),
  profiles: z.array(portalProfileSchema),
});

export type PortalLookup = z.infer<typeof portalLookupSchema>;

const referralItemSchema = z.object({
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
});

export const portalDashboardSchema = z.object({
  success: z.literal(true),
  profile: z.object({
    externalReferrerId: z.string(),
    publicName: z.string(),
    personalLink: z.string(),
  }),
  summary: z.object({
    totalReferrals: z.number(),
    successfulAdmissions: z.number(),
    cashRewardsEarned: z.number(),
    courseCreditEarned: z.number(),
  }),
  referrals: z.array(referralItemSchema),
});

export type PortalDashboard = z.infer<typeof portalDashboardSchema>;

export async function callPortalLookup(env: WorkerBindings, mobile: string, fetcher = fetch) {
  return callAppsScript(env, "portal_lookup_mobile", { mobile }, portalLookupSchema, fetcher);
}

export async function callPortalDashboard(env: WorkerBindings, externalReferrerId: string, fetcher = fetch) {
  return callAppsScript(env, "portal_referral_dashboard", { externalReferrerId }, portalDashboardSchema, fetcher);
}

async function callAppsScript<T extends z.ZodType>(
  env: WorkerBindings,
  action: string,
  payload: Record<string, unknown>,
  schema: T,
  fetcher: typeof fetch,
) {
  if (!env.PORTAL_APPS_SCRIPT_URL || !env.PORTAL_APPS_SCRIPT_SECRET) throw new Error("Apps Script is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetcher(env.PORTAL_APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        secret: env.PORTAL_APPS_SCRIPT_SECRET,
        action,
        payload,
      }),
      signal: controller.signal,
    });
    const data: unknown = await response.json();
    const parsed = schema.safeParse(data);
    if (!response.ok || !parsed.success) throw new Error("Apps Script response failed validation");
    return parsed.data as z.infer<T>;
  } finally {
    clearTimeout(timer);
  }
}
