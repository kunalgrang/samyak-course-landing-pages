import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganisationOnboarding } from "../../lib/api";

const apiMocks = vi.hoisted(() => ({
  getOrganisationOnboarding: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getOrganisationOnboarding: apiMocks.getOrganisationOnboarding,
  };
});

import { OrganisationOnboardingPage } from "./OrganisationOnboardingPage";

describe("OrganisationOnboardingPage", () => {
  let root: Root;
  let container: HTMLElement;
  let windowRef: Window;

  beforeEach(() => {
    windowRef = new Window();
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLElement", windowRef.HTMLElement);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.getOrganisationOnboarding.mockResolvedValue(onboarding());
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    windowRef.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows loading before the onboarding request resolves", async () => {
    const request = deferred<OrganisationOnboarding>();
    apiMocks.getOrganisationOnboarding.mockReturnValue(request.promise);

    await act(async () => {
      root.render(<OrganisationOnboardingPage />);
    });

    expect(container.textContent).toContain("Loading onboarding");

    await act(async () => {
      request.resolve(onboarding());
      await request.promise;
    });
  });

  it("renders trial state, trial date and server-provided checklist", async () => {
    await renderPage();

    expect(container.textContent).toContain("15-day trial");
    expect(container.textContent).toContain("Trial");
    expect(container.textContent).toContain("15 Oct 2026");
    expect(container.textContent).toContain("Setup progress");
    expect(container.textContent).toContain("3/5");
    expect(container.textContent).toContain("✓Organisation profile");
    expect(container.textContent).toContain("✓Centre profile");
    expect(container.textContent).toContain("✓Owner account");
    expect(container.textContent).toContain("○Courses");
    expect(container.textContent).toContain("○Fees");
  });

  it("does not claim a non-trial commercial state is an active trial", async () => {
    apiMocks.getOrganisationOnboarding.mockResolvedValue(onboarding({
      trial: {
        state: "active",
        startedAt: "2026-09-30T00:00:00.000Z",
        endsAt: "2026-10-15T00:00:00.000Z",
      },
    }));

    await renderPage();

    expect(container.textContent).toContain("Commercial status");
    expect(container.textContent).toContain("Active");
    expect(container.textContent).toContain("Trial ended");
    expect(container.textContent).not.toContain("15-day trial");
    expect(container.textContent).not.toContain("Active until");
  });

  it("hides the multiple-Centre reminder when only one Centre was reported", async () => {
    apiMocks.getOrganisationOnboarding.mockResolvedValue(onboarding({
      onboarding: {
        ...onboarding().onboarding,
        reportedCentreCount: 1,
      },
    }));

    await renderPage();

    expect(container.textContent).not.toContain("Additional Centres");
  });

  it("distinguishes completed and incomplete checklist items", async () => {
    await renderPage();

    const items = Array.from(container.querySelectorAll(".onboarding-checklist__item"));

    expect(items.filter((item) => item.classList.contains("onboarding-checklist__item--done")).map((item) => item.textContent)).toEqual([
      "✓Organisation profile",
      "✓Centre profile",
      "✓Owner account",
    ]);
    expect(items.filter((item) => !item.classList.contains("onboarding-checklist__item--done")).map((item) => item.textContent)).toEqual([
      "○Courses",
      "○Fees",
    ]);
  });

  it("shows the multiple-Centre reminder from reported Centre count", async () => {
    await renderPage();

    expect(container.textContent).toContain("Additional Centres");
    expect(container.textContent).toContain("You reported 3 Centres");
    expect(container.textContent).toContain("Organisation Settings");
  });

  it("shows load failures clearly", async () => {
    apiMocks.getOrganisationOnboarding.mockRejectedValue(new Error("Owner access is required."));

    await renderPage();

    expect(container.textContent).toContain("Could not load onboarding");
    expect(container.textContent).toContain("Owner access is required.");
  });

  async function renderPage() {
    await act(async () => {
      root.render(<OrganisationOnboardingPage />);
    });
    await act(async () => {});
  }
});

function onboarding(overrides: Partial<OrganisationOnboarding> = {}): OrganisationOnboarding {
  return {
    success: true,
    onboarding: {
      status: "in_progress",
      reportedCentreCount: 3,
      completedSteps: ["organisation_profile", "centre_profile", "owner_account"],
      checklist: [
        { code: "organisation_profile", label: "Organisation profile", done: true },
        { code: "centre_profile", label: "Centre profile", done: true },
        { code: "owner_account", label: "Owner account", done: true },
        { code: "courses", label: "Courses", done: false },
        { code: "fees", label: "Fees", done: false },
      ],
    },
    trial: {
      state: "trial",
      startedAt: "2026-09-30T00:00:00.000Z",
      endsAt: "2026-10-15T00:00:00.000Z",
    },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
