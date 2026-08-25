import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EducationPartnerDetail } from "../../lib/api";

const apiMocks = vi.hoisted(() => ({
  getEducationPartner: vi.fn(),
  issueEducationPartnerReferralLink: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getEducationPartner: apiMocks.getEducationPartner,
    issueEducationPartnerReferralLink: apiMocks.issueEducationPartnerReferralLink,
  };
});

import { copyTextToClipboard, EducationPartnerDetailPage } from "./EducationPartnersPage";

describe("EducationPartnerDetailPage", () => {
  let root: Root;
  let container: HTMLElement;
  let windowRef: Window;

  beforeEach(() => {
    windowRef = new Window();
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("navigator", windowRef.navigator);
    vi.stubGlobal("HTMLElement", windowRef.HTMLElement);
    vi.stubGlobal("MouseEvent", windowRef.MouseEvent);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    windowRef.setTimeout = vi.fn() as unknown as typeof windowRef.setTimeout;
    Object.defineProperty(windowRef.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.getEducationPartner.mockResolvedValue(partnerDetail());
    apiMocks.issueEducationPartnerReferralLink.mockResolvedValue({
      success: true,
      created: true,
      link: "/r/PARTNER-LINK-1234567890",
      shownOnce: true,
      lastFour: "7890",
      activatedAt: "2026-08-25T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    await new Promise((resolve) => setImmediate(resolve));
    windowRef.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows the exact commission basis and GST wording on the partner profile", async () => {
    await renderDetail();

    expect(container.textContent).toContain("Commission");
    expect(container.textContent).toContain("7.5%");
    expect(container.textContent).toContain("Calculated on course fee before GST.");
    expect(container.textContent).toContain("Current GST: 18%");
    expect(container.textContent).toContain("Commission changes apply to new referrals only.");
  });

  it("formats non-18 GST basis points without frontend hardcoding", async () => {
    apiMocks.getEducationPartner.mockResolvedValue(partnerDetail({}, { currentGstBasisPoints: 1225 }));
    await renderDetail();

    expect(container.textContent).toContain("Current GST: 12.25%");
  });

  it("shows Generate Referral Link when there is no active link", async () => {
    apiMocks.getEducationPartner.mockResolvedValue(partnerDetail({ activeLink: null }));
    await renderDetail();

    expect(container.textContent).toContain("No active link");
    expect(buttonText()).toContain("Generate Referral Link");
    expect(container.textContent).not.toContain("Copy Link");
    expect(container.querySelector("a[href^='https://go.samyaksion.com/r/']")).toBeNull();
  });

  it("does not invent a full URL for an existing active link after reload", async () => {
    await renderDetail();

    expect(container.textContent).toContain("Active · last four 7890");
    expect(container.textContent).toContain("Full link is shown only when generated.");
    expect(buttonText()).not.toContain("Generate Referral Link");
    expect(container.textContent).not.toContain("https://go.samyaksion.com/r/");
    expect(container.textContent).not.toContain("/r/");
    expect(container.querySelector("a.partner-link-open")).toBeNull();
  });

  it("exposes generated public referral links with copy and open actions", async () => {
    apiMocks.getEducationPartner.mockResolvedValue(partnerDetail({ activeLink: null }));
    await renderDetail();
    clickButton("Generate Referral Link");
    await act(async () => {});

    const expectedUrl = "https://go.samyaksion.com/r/PARTNER-LINK-1234567890";
    expect(container.textContent).toContain(expectedUrl);
    expect(container.textContent).toContain("Copy Link");
    const openLink = container.querySelector<HTMLAnchorElement>("a.partner-link-open");
    expect(openLink?.textContent).toBe("Open Link");
    expect(openLink?.href).toBe(expectedUrl);
    expect(openLink?.target).toBe("_blank");
    expect(openLink?.rel).toContain("noopener");
    expect(openLink?.rel).toContain("noreferrer");
    expect(container.textContent).not.toContain("token_hash");
    expect(container.textContent).not.toContain("referrerProfileId");

    clickButton("Copy Link");
    await act(async () => {});

    expect(windowRef.navigator.clipboard.writeText).toHaveBeenCalledWith(expectedUrl);
    expect(container.textContent).toContain("Copied");
    expect(container.textContent).toContain("Referral link copied.");
  });

  it("copies the exact public URL through the clipboard helper", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    await copyTextToClipboard("https://go.samyaksion.com/r/PARTNER-LINK-1234567890", clipboard);
    expect(clipboard.writeText).toHaveBeenCalledWith("https://go.samyaksion.com/r/PARTNER-LINK-1234567890");
  });

  it("keeps the long generated link inside a truncating display container", async () => {
    apiMocks.getEducationPartner.mockResolvedValue(partnerDetail({ activeLink: null }));
    await renderDetail();
    clickButton("Generate Referral Link");
    await act(async () => {});

    const linkValue = container.querySelector<HTMLElement>(".partner-link-value");
    expect(linkValue?.className).toContain("partner-link-value");
    expect(linkValue?.getAttribute("aria-label")).toBe("Generated public referral URL");
    expect(linkValue?.getAttribute("title")).toBe("https://go.samyaksion.com/r/PARTNER-LINK-1234567890");
  });

  it("falls back to textarea copy when clipboard writeText rejects", async () => {
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("denied")) };
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    await copyTextToClipboard("https://go.samyaksion.com/r/FALLBACK-LINK-1234567890", clipboard);

    expect(clipboard.writeText).toHaveBeenCalledWith("https://go.samyaksion.com/r/FALLBACK-LINK-1234567890");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports copy failure honestly when clipboard and fallback both fail", async () => {
    apiMocks.getEducationPartner.mockResolvedValue(partnerDetail({ activeLink: null }));
    Object.defineProperty(windowRef.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    await renderDetail();
    clickButton("Generate Referral Link");
    await act(async () => {});

    clickButton("Copy Link");
    await act(async () => {});

    expect(container.textContent).toContain("Couldn't copy - select the link manually.");
    expect(container.textContent).not.toContain("Referral link copied.");
  });

  it("clears generated link and copied state when switching partners", async () => {
    apiMocks.getEducationPartner
      .mockResolvedValueOnce(partnerDetail({ activeLink: null }))
      .mockResolvedValueOnce(partnerDetail({ activeLink: { lastFour: "7890", activatedAt: "2026-08-25T00:00:00.000Z" } }))
      .mockResolvedValueOnce(partnerDetail({ id: "epartner_2", businessName: "Second Partner", activeLink: null }));
    await renderDetail("epartner_1");
    clickButton("Generate Referral Link");
    await act(async () => {});
    clickButton("Copy Link");
    await act(async () => {});

    await renderDetail("epartner_2");
    await act(async () => {});

    expect(container.textContent).toContain("Second Partner");
    expect(container.textContent).not.toContain("https://go.samyaksion.com/r/PARTNER-LINK-1234567890");
    expect(container.textContent).not.toContain("Copied");
    expect(buttonText()).toContain("Generate Referral Link");
  });

  async function renderDetail(id = "epartner_1") {
    await act(async () => {
      root.render(<EducationPartnerDetailPage partnerId={id} onNavigate={() => undefined} isOwner={true} />);
    });
    await act(async () => {});
  }

  function clickButton(text: string) {
    const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === text);
    if (!button) throw new Error(`Button not found: ${text}`);
    act(() => {
      button.dispatchEvent(new windowRef.MouseEvent("click", { bubbles: true }) as unknown as Event);
    });
  }

  function buttonText() {
    return Array.from(container.querySelectorAll("button")).map((button) => button.textContent || "");
  }
});

function partnerDetail(
  overrides: Partial<EducationPartnerDetail["partner"]> = {},
  commercialTerms: Partial<EducationPartnerDetail["commercialTerms"]> = {},
): EducationPartnerDetail {
  return {
    success: true,
    partner: {
      id: "epartner_1",
      homeBranchId: "branch_sion",
      branchName: "Sion",
      partnerType: "college",
      businessName: "Future Skills College",
      contactPersonName: "Priya Partner",
      maskedMobile: "••••••1234",
      status: "active",
      currentCommissionBasisPoints: 750,
      internalNotes: "",
      referrerProfileId: "refprof_partner",
      activeLink: { lastFour: "7890", activatedAt: "2026-08-25T00:00:00.000Z" },
      referralCount: 0,
      admissionCount: 0,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      ...overrides,
    },
    commercialTerms: {
      currentGstBasisPoints: 1800,
      ...commercialTerms,
    },
    metrics: {
      totalReferrals: 0,
      admissions: 0,
      approved: 0,
      paid: 0,
      totalApprovedCommissionPaise: 0,
      totalPaidCommissionPaise: 0,
    },
  };
}
