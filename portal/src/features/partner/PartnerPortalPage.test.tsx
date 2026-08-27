import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PartnerPortal } from "../../lib/api";
import { PartnerPortalContent } from "./PartnerPortalPage";

const portal: PartnerPortal = {
  success: true,
  partner: {
    businessName: "Sion Coaching Partner",
    contactPersonName: "Asha Partner",
    partnerType: "coaching_class",
    branchName: "Sion",
    status: "active",
    currentCommissionBasisPoints: 500,
    gstBasisPoints: 1800,
    memberSince: "2026-08-26T10:00:00.000Z",
  },
  referralLink: {
    hasActiveLink: true,
    lastFour: "U0sk",
    activatedAt: "2026-08-26T10:00:00.000Z",
    publicUrl: "https://go.samyaksion.com/r/U0sk",
    recoverable: true,
    message: "Referral link ready.",
  },
  summary: {
    totalReferrals: 8,
    admissions: 3,
    awaitingAdmission: 1,
    awaitingPayment: 2,
    qualified: 4,
    approved: 2,
    paid: 1,
    totalApprovedCommissionPaise: 125000,
    totalPaidCommissionPaise: 75000,
  },
  pagination: { limit: 20, offset: 0, total: 0, hasMore: false },
  referrals: [],
};

describe("PartnerPortalContent", () => {
  it("renders the refined dashboard hierarchy without self-service link replacement controls", () => {
    const html = renderToStaticMarkup(<Content />);

    expect(html).toContain("partner-portal-page");
    expect(html).toContain("partner-link-meta");
    expect(html).toContain("partner-terms-list");
    expect(html).toContain("Sion Coaching Partner");
    expect(html).toContain("Total Referrals");
    expect(html).toContain("Paid Commission");
    expect(html).toContain("Copy Link");
    expect(html).toContain("Open Link");
    expect(html).toContain("Last four");
    expect(html).toContain("U0sk");
    expect(html).toContain("Commission");
    expect(html).toContain("5%");
    expect(html).not.toContain("Replace");
    expect(html).not.toContain("Rotate");
    expect(html).not.toContain("Revoke");
  });

  it("keeps a single-page empty referrals section compact by hiding pagination controls", () => {
    const html = renderToStaticMarkup(<Content />);

    expect(html).toContain("No referrals yet");
    expect(html).not.toContain("Previous");
    expect(html).not.toContain("Next");
  });

  it("renders pagination only when more than one page exists", () => {
    const html = renderToStaticMarkup(<Content data={{ ...portal, pagination: { limit: 20, offset: 20, total: 45, hasMore: true } }} />);

    expect(html).toContain("Previous");
    expect(html).toContain("Next");
  });
});

function Content({ data = portal }: { data?: PartnerPortal }) {
  return (
    <PartnerPortalContent
      data={data}
      mode="self"
      copied={false}
      onCopyLink={vi.fn()}
      onSignOut={vi.fn()}
      onNavigate={vi.fn()}
      onPage={vi.fn()}
      onRefresh={vi.fn()}
    />
  );
}
