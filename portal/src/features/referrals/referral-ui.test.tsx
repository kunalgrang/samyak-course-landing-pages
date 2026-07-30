import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { appNavigation } from "../../app/navigation";
import type { ReferralDashboard, SessionResponse } from "../../lib/api";
import { ProfileContent } from "../profile/ProfilePage";
import { ReferralsContent } from "./ReferralsPage";
import {
  buildWhatsAppShareUrl,
  copyReferralLink,
  formatIndianCurrency,
  maskedMobileFromLastFour,
  rewardSlabs,
} from "./referralUtils";
import { OverviewContent } from "../../routes/ShellHomePage";
import { RulesPage } from "../../routes/RulesPage";

const dashboard: ReferralDashboard = {
  success: true,
  profile: {
    externalReferrerId: "SSC-001",
    fullName: "Asha Student",
    publicName: "Asha S.",
    referrerType: "Student",
    courseStudied: "Full Stack Development",
    memberSince: "2026-07-01",
    personalLink: "https://portal.samyaksion.com/r/ASHA123",
    active: true,
  },
  summary: {
    totalReferrals: 3,
    successfulAdmissions: 1,
    cashRewardsEarned: 1500,
    courseCreditEarned: 2000,
  },
  referrals: [
    {
      referralId: "REF-1",
      prospectPublicName: "Rahul S.",
      courseInterested: "Data Analytics",
      submissionDate: "2026-07-20",
      publicStatus: "Reward Eligible",
      rewardStatus: "Approved",
      rewardChoice: "Cash",
      cashReward: 1500,
      courseCredit: 2000,
      approvedRewardAmount: 1500,
      rewardPaymentDate: "",
    },
  ],
};

const session: SessionResponse = {
  authenticated: true,
  activeProfile: {
    personId: "person_ssc_001",
    publicName: "Asha S.",
    accessType: "self",
    roles: ["student"],
    effectiveRoles: ["student"],
  },
  profiles: [
    {
      personId: "person_ssc_001",
      publicName: "Asha S.",
      accessType: "self",
      roles: ["student"],
      effectiveRoles: [],
    },
    {
      personId: "person_ssc_002",
      publicName: "Ravi A.",
      accessType: "self",
      roles: ["alumni"],
      effectiveRoles: [],
    },
  ],
  mobileLastFour: "3210",
  accountRoles: [],
};

describe("student referral portal UI", () => {
  it("formats Indian currency with rupee symbol and Indian grouping", () => {
    expect(formatIndianCurrency(1500)).toBe("₹1,500");
    expect(formatIndianCurrency(200000)).toBe("₹2,00,000");
  });

  it("builds WhatsApp share URLs from the personal referral link", () => {
    const url = buildWhatsAppShareUrl("https://portal.samyaksion.com/r/ASHA123");
    expect(url).toContain("https://wa.me/?text=");
    expect(decodeURIComponent(url)).toContain("Samyak Skill Circle referral link");
    expect(decodeURIComponent(url)).toContain("https://portal.samyaksion.com/r/ASHA123");
  });

  it("copies the referral link through the clipboard contract", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    await copyReferralLink("https://portal.samyaksion.com/r/ASHA123", clipboard);
    expect(clipboard.writeText).toHaveBeenCalledWith("https://portal.samyaksion.com/r/ASHA123");
  });

  it("uses the exact reward slabs and friend benefit copy", () => {
    expect(rewardSlabs).toEqual([
      { fee: "Below ₹10,000", cash: 500, credit: 750 },
      { fee: "₹10,000-₹19,999", cash: 750, credit: 1000 },
      { fee: "₹20,000-₹29,999", cash: 1000, credit: 1500 },
      { fee: "₹30,000 and above", cash: 1500, credit: 2000 },
    ]);
    const html = renderToStaticMarkup(<RulesPage />);
    expect(html).toContain("Rewards &amp; Benefits");
    expect(html).toContain("A benefit for your friend too");
    expect(html).toContain("complimentary classroom AI Prompting Crash Course");
    expect(html).toContain("₹1,500 cash");
    expect(html).toContain("₹2,000 course credit");
  });

  it("renders overview with profile name, summary and no development placeholders", () => {
    const html = renderToStaticMarkup(
      <OverviewContent dashboard={dashboard} copied={false} canShare={false} onCopy={() => undefined} onNativeShare={() => undefined} />,
    );
    expect(html).toContain("Hi, Asha");
    expect(html).toContain("Total referrals");
    expect(html).toContain("₹1,500");
    expect(html).toContain("Rahul S.");
    expect(html).not.toMatch(/Portal foundation|API health routes|D1 schema|Phase 1|Temporary client guard|No dashboard data yet|records are deliberately not mocked|coding pass/i);
  });

  it("shows the empty referral state", () => {
    const emptyDashboard = { ...dashboard, referrals: [] };
    const html = renderToStaticMarkup(
      <OverviewContent dashboard={emptyDashboard} copied={false} canShare={false} onCopy={() => undefined} onNativeShare={() => undefined} />,
    );
    expect(html).toContain("No referrals yet");
    expect(html).toContain("Share your personal link with a friend who may benefit from learning a new skill.");
  });

  it("renders safe profile fields and never renders a full mobile number", () => {
    const html = renderToStaticMarkup(
      <ProfileContent dashboard={dashboard} session={session} switchingPersonId={null} switchError={false} onSwitch={() => undefined} />,
    );
    expect(html).toContain("Asha Student");
    expect(html).toContain("Student");
    expect(html).toContain("Full Stack Development");
    expect(html).toContain("******3210");
    expect(html).toContain("Active");
    expect(html).not.toContain("9876543210");
    expect(maskedMobileFromLastFour("3210")).toBe("******3210");
  });

  it("keeps shared-mobile profile choices isolated by active state", () => {
    const html = renderToStaticMarkup(
      <ProfileContent dashboard={dashboard} session={session} switchingPersonId={null} switchError={false} onSwitch={() => undefined} />,
    );
    expect(html).toContain("Asha S.");
    expect(html).toContain("Ravi A.");
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain("aria-pressed=\"false\"");
  });

  it("uses student-facing navigation labels", () => {
    expect(appNavigation.map((item) => item.label)).toEqual(["Overview", "My Referrals", "Rewards & Benefits", "My Profile"]);
  });

  it("renders referral share actions", () => {
    const html = renderToStaticMarkup(
      <ReferralsContent dashboard={dashboard} copied={true} canShare={true} onCopy={() => undefined} onNativeShare={() => undefined} />,
    );
    expect(html).toContain("Copied");
    expect(html).toContain("Share on WhatsApp");
    expect(html).toContain("Referral link copied.");
  });
});
