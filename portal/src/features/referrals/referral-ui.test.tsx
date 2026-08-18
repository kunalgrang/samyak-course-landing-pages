import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { appNavigation } from "../../app/navigation";
import { staffNavigation } from "../../app/navigation";
import type { ReferralDashboard, SessionResponse, StaffReferralList, StudentHome } from "../../lib/api";
import { ProfileContent } from "../profile/ProfilePage";
import { OverviewContent } from "../../routes/ShellHomePage";
import { RulesPage } from "../../routes/RulesPage";
import { ReferralsContent } from "./ReferralsPage";
import { ContactCell, ReferralOperationsContent } from "../staff/ReferralOperationsPage";
import {
  buildWhatsAppShareUrl,
  copyReferralLink,
  formatIndianCurrency,
  maskedMobileFromLastFour,
  rewardSlabs,
} from "./referralUtils";

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
  linkStatus: {
    hasActiveLink: true,
    lastFour: "A123",
    activatedAt: "2026-07-01",
    expiresAt: null,
    canGenerate: false,
    canRotate: true,
    message: "Your active referral link cannot be displayed again. Rotate it to create a new link.",
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

const studentHome: StudentHome = {
  success: true,
  identity: {
    personId: "person_ssc_001",
    fullName: "Asha Student",
    publicName: "Asha S.",
    studentId: "SYK-SION-000001",
    studentStatus: "on_hold",
    lifecycleStatus: "CURRENT",
    studentSince: "2025-04-10",
    branchName: "Sion",
  },
  courseHistory: [
    {
      enrolmentId: "enrol_1",
      enrolmentNumber: "ENR-SION-000001",
      courseId: "course_full_stack",
      courseCode: "FULL_STACK",
      courseName: "Full Stack Development",
      durationLabel: "12 months",
      admissionDate: "2025-04-10",
      joiningDate: "2025-04-12",
      completionDate: null,
      status: "on_hold",
    },
  ],
  skillCircle: {
    programmeName: "Samyak Skill Circle",
    eligible: true,
    hasActiveReferralLink: true,
    referralDashboardPath: "/app/referrals",
    message: "Your referral dashboard is ready.",
  },
};

const staffReferralList: StaffReferralList = {
  success: true,
  summary: { totalReferrals: 1, admitted: 1, paymentDataUnavailable: 1, expired: 0 },
  pagination: { limit: 20, offset: 0, total: 1, hasMore: false },
  filters: {},
  referrals: [
    {
      referralId: "referral_01",
      shortReference: "ERRAL_01",
      branchName: "Sion",
      submittedAt: "2026-08-06T10:00:00.000Z",
      validUntil: "2026-11-04T10:00:00.000Z",
      validityState: "valid_admission",
      lastActivityAt: "2026-08-07T10:00:00.000Z",
      referrerName: "Asha S.",
      referrerType: "student",
      prospectPublicName: "Future L.",
      prospectContact: {
        mobile: "9876543210",
        mobileDisplay: "+91 98765 43210",
        whatsappUrl: "https://wa.me/919876543210?text=Hi%2C%20this%20is%20Samyak%20Computer%20Classes%2C%20Sion.",
        callUrl: "tel:+919876543210",
      },
      courseInterested: "Full Stack",
      referralStatus: "converted",
      linkedEnquiry: { id: "enq_1", enquiryNumber: "ENQ-SION-2026-0001", status: "converted" },
      linkedEnrolment: { id: "enrol_1", enrolmentNumber: "ENR-SION-2026-0001", status: "active" },
      admissionStatus: "active",
      qualificationState: "admitted_payment_data_unavailable",
      rewardStatus: "Payment data unavailable",
      reward: null,
    },
  ],
};

describe("student referral portal UI", () => {
  it("formats Indian currency with rupee symbol and Indian grouping", () => {
    expect(formatIndianCurrency(1500)).toBe("\u20B91,500");
    expect(formatIndianCurrency(200000)).toBe("\u20B92,00,000");
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
      { fee: "Below \u20B910,000", cash: 500, credit: 750 },
      { fee: "\u20B910,000-\u20B919,999", cash: 750, credit: 1000 },
      { fee: "\u20B920,000-\u20B929,999", cash: 1000, credit: 1500 },
      { fee: "\u20B930,000 and above", cash: 1500, credit: 2000 },
    ]);
    const html = renderToStaticMarkup(<RulesPage />);
    expect(html).toContain("Rewards &amp; Benefits");
    expect(html).toContain("A benefit for your friend too");
    expect(html).toContain("complimentary classroom AI Prompting Crash Course");
    expect(html).toContain("\u20B91,500 cash");
    expect(html).toContain("\u20B92,000 course credit");
  });

  it("renders overview with student identity, course history and no development placeholders", () => {
    const html = renderToStaticMarkup(<OverviewContent home={studentHome} />);
    expect(html).toContain("Hi, Asha");
    expect(html).toContain("SYK-SION-000001");
    expect(html).toContain("Current student - On Hold");
    expect(html).toContain("Full Stack Development");
    expect(html).toContain("Samyak Skill Circle");
    expect(html).not.toContain("https://portal.samyaksion.com/r/ASHA123");
    expect(html).not.toMatch(/Portal foundation|API health routes|D1 schema|Phase 1|Temporary client guard|No dashboard data yet|records are deliberately not mocked|coding pass/i);
  });

  it("shows the empty course-history state", () => {
    const emptyHome = { ...studentHome, courseHistory: [] };
    const html = renderToStaticMarkup(<OverviewContent home={emptyHome} />);
    expect(html).toContain("No courses found");
    expect(html).toContain("Your imported course history will appear here after it is available.");
  });

  it("renders safe profile fields and never renders a full mobile number", () => {
    const html = renderToStaticMarkup(
      <ProfileContent home={studentHome} session={session} switchingPersonId={null} switchError={false} onSwitch={() => undefined} />,
    );
    expect(html).toContain("Asha Student");
    expect(html).toContain("Student");
    expect(html).toContain("Full Stack Development");
    expect(html).toContain("SYK-SION-000001");
    expect(html).toContain("******3210");
    expect(html).toContain("On Hold");
    expect(html).not.toContain("9876543210");
    expect(maskedMobileFromLastFour("3210")).toBe("******3210");
  });

  it("keeps shared-mobile profile choices isolated by active state", () => {
    const html = renderToStaticMarkup(
      <ProfileContent home={studentHome} session={session} switchingPersonId={null} switchError={false} onSwitch={() => undefined} />,
    );
    expect(html).toContain("Asha S.");
    expect(html).toContain("Ravi A.");
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain("aria-pressed=\"false\"");
  });

  it("uses student-facing navigation labels", () => {
    expect(appNavigation.map((item) => item.label)).toEqual(["Overview", "My Referrals", "Rewards & Benefits", "My Profile"]);
  });

  it("adds staff referral operations navigation and renders a compact operations queue", () => {
    expect(staffNavigation.map((item) => item.label)).toContain("Referral Operations");
    const html = renderToStaticMarkup(<ReferralOperationsContent data={staffReferralList} onNavigate={() => undefined} onPage={() => undefined} />);
    expect(html).toContain("Referral queue");
    expect(html).toContain("ENQ-SION-2026-0001");
    expect(html).toContain("Admitted Payment Data Unavailable");
    expect(html).toContain("Valid admission");
    expect(html).toContain("+91 98765 43210");
    expect(html).toContain("WhatsApp prospect");
    expect(html).toContain("Call prospect");
    expect(html).toContain("https://wa.me/919876543210");
    expect(html).toContain("tel:+919876543210");
    expect(html).not.toContain("mobile_hash");
  });

  it("renders staff referral missing-contact state without active actions", () => {
    const html = renderToStaticMarkup(
      <ReferralOperationsContent
        data={{
          ...staffReferralList,
          referrals: [
            {
              ...staffReferralList.referrals[0],
              prospectContact: { mobile: null, mobileDisplay: null, whatsappUrl: null, callUrl: null },
            },
          ],
        }}
        onNavigate={() => undefined}
        onPage={() => undefined}
      />,
    );
    expect(html).toContain("Contact unavailable");
    expect(html).not.toContain("WhatsApp prospect");
    expect(html).not.toContain("Call prospect");
  });

  it("renders referral detail contact actions and missing-contact copy", () => {
    const html = renderToStaticMarkup(<ContactCell contact={staffReferralList.referrals[0].prospectContact} />);
    expect(html).toContain("+91 98765 43210");
    expect(html).toContain("WhatsApp prospect");
    expect(html).toContain("Call prospect");

    const missing = renderToStaticMarkup(<ContactCell contact={{ mobile: null, mobileDisplay: null, whatsappUrl: null, callUrl: null }} />);
    expect(missing).toContain("Contact number unavailable");
    expect(missing).not.toContain("href=");
  });

  it("renders referral share actions", () => {
    const html = renderToStaticMarkup(
      <ReferralsContent
        dashboard={dashboard}
        oneTimeLink="https://go.samyaksion.com/r/NEW123"
        copied={true}
        canShare={true}
        onCopy={() => undefined}
        onNativeShare={() => undefined}
      />,
    );
    expect(html).toContain("Copied");
    expect(html).toContain("Share on WhatsApp");
    expect(html).toContain("Referral link copied.");
    expect(html).toContain("https://go.samyaksion.com/r/NEW123");
    expect(html).not.toContain("https://portal.samyaksion.com/r/ASHA123");
  });

  it("renders active-link metadata without reconstructing the raw token", () => {
    const html = renderToStaticMarkup(
      <ReferralsContent dashboard={dashboard} copied={false} canShare={false} onCopy={() => undefined} onNativeShare={() => undefined} />,
    );
    expect(html).toContain("Active link ending ...A123");
    expect(html).toContain("Rotate referral link");
    expect(html).not.toContain("https://portal.samyaksion.com/r/ASHA123");
  });

  it("renders generate controls when no active referral link exists", () => {
    const html = renderToStaticMarkup(
      <ReferralsContent
        dashboard={{
          ...dashboard,
          linkStatus: {
            hasActiveLink: false,
            lastFour: null,
            activatedAt: null,
            expiresAt: null,
            canGenerate: true,
            canRotate: false,
            message: "Generate a referral link to share with friends.",
          },
        }}
        copied={false}
        canShare={false}
        onCopy={() => undefined}
        onNativeShare={() => undefined}
      />,
    );
    expect(html).toContain("No active referral link");
    expect(html).toContain("Generate referral link");
    expect(html).not.toContain("Copy Link");
  });
});
