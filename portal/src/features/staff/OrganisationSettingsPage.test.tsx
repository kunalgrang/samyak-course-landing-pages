import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type OrganisationSettings } from "../../lib/api";

const apiMocks = vi.hoisted(() => ({
  getOrganisationSettings: vi.fn(),
  updateOrganisationSettings: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getOrganisationSettings: apiMocks.getOrganisationSettings,
    updateOrganisationSettings: apiMocks.updateOrganisationSettings,
  };
});

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ refreshSession: apiMocks.refreshSession }),
}));

import { OrganisationSettingsPage } from "./OrganisationSettingsPage";

describe("OrganisationSettingsPage", () => {
  let root: Root;
  let container: HTMLElement;
  let windowRef: Window;

  beforeEach(() => {
    windowRef = new Window();
    vi.stubGlobal("window", windowRef);
    vi.stubGlobal("document", windowRef.document);
    vi.stubGlobal("HTMLElement", windowRef.HTMLElement);
    vi.stubGlobal("HTMLInputElement", windowRef.HTMLInputElement);
    vi.stubGlobal("HTMLSelectElement", windowRef.HTMLSelectElement);
    vi.stubGlobal("Event", windowRef.Event);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.getOrganisationSettings.mockResolvedValue({ success: true, organisation: settings() });
    apiMocks.updateOrganisationSettings.mockResolvedValue({ success: true, organisation: settings({ name: "Samyak Education" }), changedFields: ["name"] });
    apiMocks.refreshSession.mockResolvedValue({ status: "authenticated", session: {} });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    windowRef.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads settings, submits the allowed payload, shows success and refreshes the session", async () => {
    await renderPage();
    await setInput("name", "Samyak Education");
    await setInput("pan", "abcde1234f");

    await submit();

    expect(apiMocks.updateOrganisationSettings).toHaveBeenCalledWith(expect.objectContaining({
      name: "Samyak Education",
      legalName: "Samyak Education LLP",
      organisationType: "computer_training_institute",
      legalEntityType: "llp",
      addressLine1: "1 Sion Road",
      city: "Mumbai",
      stateRegion: "Maharashtra",
      country: "India",
      postcode: "400022",
      website: "https://samyak.test",
      currency: "INR",
      timezone: "Asia/Kolkata",
      pan: "ABCDE1234F",
      gstin: "",
    }));
    expect(apiMocks.updateOrganisationSettings.mock.calls[0][0]).not.toHaveProperty("slug");
    expect(apiMocks.updateOrganisationSettings.mock.calls[0][0]).not.toHaveProperty("status");
    expect(apiMocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Organisation settings saved.");
  });

  it("preserves edits and shows API field errors after save failure", async () => {
    apiMocks.updateOrganisationSettings.mockRejectedValue(new ApiError("Please check the submitted details.", { pan: ["Enter a valid PAN."] }, "invalid_request"));
    await renderPage();
    await setInput("name", "Samyak Education");
    await setInput("pan", "BAD");

    await submit();

    expect((input("name") as HTMLInputElement).value).toBe("Samyak Education");
    expect(container.textContent).toContain("Please check the submitted details.");
    expect(container.textContent).toContain("Enter a valid PAN.");
    expect(apiMocks.refreshSession).not.toHaveBeenCalled();
  });

  it("shows load failures clearly", async () => {
    apiMocks.getOrganisationSettings.mockRejectedValue(new Error("Owner access is required."));

    await renderPage();

    expect(container.textContent).toContain("Could not load organisation settings");
    expect(container.textContent).toContain("Owner access is required.");
  });

  async function renderPage() {
    await act(async () => {
      root.render(<OrganisationSettingsPage />);
    });
    await act(async () => {});
  }

  function input(name: string) {
    const element = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!element) throw new Error(`Missing input ${name}`);
    return element;
  }

  async function setInput(name: string, value: string) {
    const element = input(name);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(windowRef.HTMLInputElement.prototype, "value")?.set;
      setter?.call(element, value);
      element.dispatchEvent(new windowRef.Event("input", { bubbles: true }) as unknown as Event);
      element.dispatchEvent(new windowRef.Event("change", { bubbles: true }) as unknown as Event);
    });
  }

  async function submit() {
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    await act(async () => {
      form.dispatchEvent(new windowRef.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    });
  }
});

function settings(overrides: Partial<OrganisationSettings> = {}): OrganisationSettings {
  return {
    id: "org_samyak",
    name: "Samyak Classes",
    legalName: "Samyak Education LLP",
    organisationType: "computer_training_institute",
    legalEntityType: "llp",
    addressLine1: "1 Sion Road",
    city: "Mumbai",
    stateRegion: "Maharashtra",
    country: "India",
    postcode: "400022",
    website: "https://samyak.test",
    currency: "INR",
    timezone: "Asia/Kolkata",
    pan: "ABCDE1234F",
    gstin: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
