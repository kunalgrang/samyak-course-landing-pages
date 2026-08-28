import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
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

  it("keeps the portal root as the centered page shell hook", () => {
    const html = renderToStaticMarkup(<Content />);

    expect(html).toContain('class="content-stack partner-portal-page"');
    expect(html).toContain('class="page-header partner-portal-header"');
    expect(html).toContain('class="partner-portal-grid"');
  });

  it("defines a centered shell, responsive gutters, and stable metric grids in CSS", () => {
    const staffCss = readFileSync(new URL("../../styles/staff.css", import.meta.url), "utf8");
    const globalCss = readFileSync(new URL("../../styles/global.css", import.meta.url), "utf8");

    expect(staffCss).toContain("--partner-page-gutter: clamp(16px, 3vw, 32px);");
    expect(staffCss).toContain("--partner-page-max-width: 1240px;");
    expect(staffCss).toContain("width: min(calc(100% - (var(--partner-page-gutter) * 2)), var(--partner-page-max-width));");
    expect(staffCss).toContain("margin-inline: auto;");
    expect(staffCss).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(staffCss).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(globalCss).toContain(".page-content:has(.partner-portal-page)");
    expect(globalCss).toContain("padding: 0;");
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
