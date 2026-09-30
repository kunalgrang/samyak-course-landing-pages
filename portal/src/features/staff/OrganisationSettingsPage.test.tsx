import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type OrganisationSettings, type StaffCentre } from "../../lib/api";

const apiMocks = vi.hoisted(() => ({
  getOrganisationSettings: vi.fn(),
  updateOrganisationSettings: vi.fn(),
  getCentres: vi.fn(),
  createCentre: vi.fn(),
  updateCentre: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getOrganisationSettings: apiMocks.getOrganisationSettings,
    updateOrganisationSettings: apiMocks.updateOrganisationSettings,
    getCentres: apiMocks.getCentres,
    createCentre: apiMocks.createCentre,
    updateCentre: apiMocks.updateCentre,
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
    vi.stubGlobal("MouseEvent", windowRef.MouseEvent);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.getOrganisationSettings.mockResolvedValue({ success: true, organisation: settings() });
    apiMocks.updateOrganisationSettings.mockResolvedValue({ success: true, organisation: settings({ name: "Samyak Education" }), changedFields: ["name"] });
    apiMocks.getCentres.mockResolvedValue({ success: true, centres: [activeCentre(), pendingCentre()] });
    apiMocks.createCentre.mockResolvedValue({ success: true, centre: pendingCentre({ id: "branch_new", name: "Andheri Centre", code: "CTR-003" }) });
    apiMocks.updateCentre.mockResolvedValue({ success: true, centre: pendingCentre({ name: "Samyak Pending Updated" }), changedFields: ["name"] });
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

  it("loads and displays active and pending centres in the Centres tab", async () => {
    await renderPage();

    await clickButton("Centres");

    expect(apiMocks.getCentres).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Samyak Main");
    expect(container.textContent).toContain("Samyak Pending");
    expect(container.textContent).toContain("Existing access");
    expect(container.textContent).toContain("Pending subscription");
    expect(container.textContent).toContain("Centre code");
    expect(container.textContent).toContain("CTR-001");
  });

  it("finishes a delayed successful Centres request without refetching on rerender or selection", async () => {
    const centresRequest = deferred<{ success: true; centres: StaffCentre[] }>();
    apiMocks.getCentres.mockReturnValue(centresRequest.promise);

    await renderPage();
    await clickButton("Centres");

    expect(container.textContent).toContain("Loading centres");
    await act(async () => {});
    expect(apiMocks.getCentres).toHaveBeenCalledTimes(1);

    await act(async () => {
      centresRequest.resolve({ success: true, centres: [activeCentre(), pendingCentre()] });
      await centresRequest.promise;
    });
    await act(async () => {});

    expect(container.textContent).not.toContain("Loading centres");
    expect(container.textContent).toContain("Samyak Main");
    expect(container.textContent).toContain("Samyak Pending");
    expect((input("centreName") as HTMLInputElement).value).toBe("Samyak Main");
    expect((input("centreAddressLine1") as HTMLInputElement).value).toBe("1 Main Road");

    await clickButton("Samyak PendingCTR-002Pending subscription");

    expect((input("centreName") as HTMLInputElement).value).toBe("Samyak Pending");
    expect((input("centreAddressLine1") as HTMLInputElement).value).toBe("2 Trial Road");
    expect(apiMocks.getCentres).toHaveBeenCalledTimes(1);
  });

  it("finishes a delayed rejected Centres request without getting stuck loading", async () => {
    const centresRequest = deferred<{ success: true; centres: StaffCentre[] }>();
    apiMocks.getCentres.mockReturnValue(centresRequest.promise);

    await renderPage();
    await clickButton("Centres");

    expect(container.textContent).toContain("Loading centres");
    await act(async () => {});

    await act(async () => {
      centresRequest.reject(new Error("Owner access is required."));
      await centresRequest.promise.catch(() => {});
    });
    await act(async () => {});

    expect(container.textContent).not.toContain("Loading centres");
    expect(container.textContent).toContain("Could not load centres");
    expect(container.textContent).toContain("Owner access is required.");
    expect(apiMocks.getCentres).toHaveBeenCalledTimes(1);
  });

  it("creates a centre without client-controlled code or lifecycle fields", async () => {
    await renderPage();
    await clickButton("Centres");
    await clickButton("New Centre");
    await setInput("centreName", "Andheri Centre");
    await setInput("mobile", "9876543210");
    await setInput("centreEmail", "andheri@samyak.test");
    await setInput("centreAddressLine1", "3 Station Road");
    await setInput("centreCity", "Mumbai");
    await setInput("centreStateRegion", "Maharashtra");
    await setInput("centrePostcode", "400050");
    await setInput("centrePan", "abcde1234f");

    await submit();

    expect(apiMocks.createCentre).toHaveBeenCalledWith({
      name: "Andheri Centre",
      mobile: "9876543210",
      email: "andheri@samyak.test",
      addressLine1: "3 Station Road",
      city: "Mumbai",
      stateRegion: "Maharashtra",
      postcode: "400050",
      country: "India",
      operatingModel: "company_owned",
      currency: "INR",
      timezone: "Asia/Kolkata",
      pan: "ABCDE1234F",
      gstin: "",
    });
    expect(apiMocks.createCentre.mock.calls[0][0]).not.toHaveProperty("code");
    expect(apiMocks.createCentre.mock.calls[0][0]).not.toHaveProperty("status");
    expect(apiMocks.createCentre.mock.calls[0][0]).not.toHaveProperty("centreStatus");
    expect(container.textContent).toContain("Centre created. It will become active after its subscription payment is verified.");
  });

  it("edits centre details with code and status shown read-only", async () => {
    await renderPage();
    await clickButton("Centres");
    await clickButton("Samyak PendingCTR-002Pending subscription");
    await setInput("centreName", "Samyak Pending Updated");
    await setInput("newMobile", "9999988888");

    await submit();

    expect(container.textContent).toContain("Centre code");
    expect(container.textContent).toContain("CTR-002");
    expect(container.querySelector<HTMLInputElement>('input[name="code"]')).toBeNull();
    expect(apiMocks.updateCentre).toHaveBeenCalledWith("branch_pending", expect.objectContaining({
      name: "Samyak Pending Updated",
      newMobile: "9999988888",
      email: "pending@samyak.test",
      addressLine1: "2 Trial Road",
      operatingModel: "franchise_operated",
    }));
    expect(apiMocks.updateCentre.mock.calls[0][1]).not.toHaveProperty("code");
    expect(apiMocks.updateCentre.mock.calls[0][1]).not.toHaveProperty("status");
    expect(container.textContent).toContain("Centre details saved.");
  });

  it("shows centre API field errors while preserving edits", async () => {
    apiMocks.createCentre.mockRejectedValue(new ApiError("Please check the submitted details.", { mobile: ["Enter a valid Indian mobile number."] }, "invalid_mobile"));
    await renderPage();
    await clickButton("Centres");
    await clickButton("New Centre");
    await setInput("centreName", "Andheri Centre");
    await setInput("mobile", "12345");

    await submit();

    expect((input("centreName") as HTMLInputElement).value).toBe("Andheri Centre");
    expect(container.textContent).toContain("Please check the submitted details.");
    expect(container.textContent).toContain("Enter a valid Indian mobile number.");
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
    await act(async () => {});
  }

  async function clickButton(text: string) {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
    if (!button) throw new Error(`Missing button ${text}. Saw: ${Array.from(container.querySelectorAll("button")).map((candidate) => candidate.textContent).join(", ")}`);
    await act(async () => {
      button.dispatchEvent(new windowRef.MouseEvent("click", { bubbles: true }) as unknown as MouseEvent);
    });
    await act(async () => {});
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

function activeCentre(overrides: Partial<StaffCentre> = {}): StaffCentre {
  return {
    id: "branch_main",
    name: "Samyak Main",
    code: "CTR-001",
    addressLine1: "1 Main Road",
    city: "Mumbai",
    stateRegion: "Maharashtra",
    postcode: "400022",
    country: "India",
    maskedMobile: "******3210",
    email: "main@samyak.test",
    operatingModel: "company_owned",
    currency: "INR",
    timezone: "Asia/Kolkata",
    pan: "ABCDE1234F",
    gstin: "",
    status: "active",
    centreStatus: "active",
    commercialState: "legacy_existing",
    commercialStatusLabel: "Existing access",
    canOperate: true,
    subscriptionStatusLabel: "Existing access",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function pendingCentre(overrides: Partial<StaffCentre> = {}): StaffCentre {
  return {
    ...activeCentre({
      id: "branch_pending",
      name: "Samyak Pending",
      code: "CTR-002",
      addressLine1: "2 Trial Road",
      maskedMobile: "******6789",
      email: "pending@samyak.test",
      operatingModel: "franchise_operated",
      status: "inactive",
      centreStatus: "pending_subscription",
      commercialState: "pending_payment",
      commercialStatusLabel: "Pending subscription",
      canOperate: false,
      subscriptionStatusLabel: "Pending subscription",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
