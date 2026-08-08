import type { ReferralDashboard } from "../../lib/api";

export const rewardSlabs = [
  { fee: "Below \u20B910,000", cash: 500, credit: 750 },
  { fee: "\u20B910,000-\u20B919,999", cash: 750, credit: 1000 },
  { fee: "\u20B920,000-\u20B929,999", cash: 1000, credit: 1500 },
  { fee: "\u20B930,000 and above", cash: 1500, credit: 2000 },
] as const;

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatIndianCurrency(value: number) {
  return currencyFormatter.format(value);
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

export function memberTypeLabel(type: string) {
  return type.toLowerCase().includes("alumni") ? "Alumni" : "Student";
}

export function programmeStatus(active: boolean) {
  return active ? "Active programme member" : "Programme inactive";
}

export function maskedMobileFromLastFour(lastFour?: string) {
  return lastFour ? `******${lastFour}` : "Not available";
}

export function referralShareText(personalLink: string) {
  return `Hi, I am sharing my Samyak Skill Circle referral link. Please use this link to enquire at Samyak Computer Classes: ${personalLink}`;
}

export function buildWhatsAppShareUrl(personalLink: string) {
  return `https://wa.me/?text=${encodeURIComponent(referralShareText(personalLink))}`;
}

export async function copyReferralLink(personalLink: string, clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard) {
  await clipboard.writeText(personalLink);
}

export function recentReferrals(dashboard: ReferralDashboard, limit = 5) {
  return dashboard.referrals.slice(0, limit);
}
