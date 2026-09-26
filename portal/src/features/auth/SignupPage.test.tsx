import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  createSignupOrganisation: vi.fn(),
  getPublicConfig: vi.fn(),
  requestSignupOtp: vi.fn(),
  resendSignupOtp: vi.fn(),
  verifySignupOtp: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    createSignupOrganisation: apiMocks.createSignupOrganisation,
    getPublicConfig: apiMocks.getPublicConfig,
    requestSignupOtp: apiMocks.requestSignupOtp,
    resendSignupOtp: apiMocks.resendSignupOtp,
    verifySignupOtp: apiMocks.verifySignupOtp,
  };
});

vi.mock("./AuthContext", () => ({
  useAuth: () => ({ refreshSession: apiMocks.refreshSession }),
}));

import { buildSignupCreatePayload, SignupPage, signupDefaultForm, validateSignupFormDetails, type SignupFormState } from "./SignupPage";

describe("SignupPage organisation details", () => {
  let root: Root;
  let container: HTMLElement;
  let window: Window;

  beforeEach(() => {
    window = new Window();
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).HTMLInputElement = window.HTMLInputElement;
    (globalThis as any).HTMLSelectElement = window.HTMLSelectElement;
    (globalThis as any).Event = window.Event;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    (window as any).turnstile = {
      render: vi.fn((_element, options) => {
        options.callback("turnstile-token");
        return "widget";
      }),
      remove: vi.fn(),
      reset: vi.fn(),
    };
    apiMocks.getPublicConfig.mockResolvedValue({ turnstileSiteKey: "site-key", otpEnabled: true, googleReviewUrl: "" });
    apiMocks.requestSignupOtp.mockResolvedValue({ success: true, challengeId: "challenge_1", maskedMobile: "******3210", message: "sent", requestId: "req_1" });
    apiMocks.verifySignupOtp.mockResolvedValue({ success: true, signupVerificationId: "signup_1", requestId: "req_2" });
    apiMocks.createSignupOrganisation.mockResolvedValue({ success: true, organisation: { id: "org_1", name: "Apex Skills" }, trial: { startedAt: "2026-09-26T00:00:00.000Z", endsAt: "2026-10-11T00:00:00.000Z" }, requestId: "req_3" });
    apiMocks.refreshSession.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    vi.clearAllMocks();
  });

  it("defaults country to India and switches curated subdivision options", async () => {
    await renderDetails();

    const country = select("Country");
    expect(country.value).toBe("IN");
    expect(optionTexts(select("State / Union Territory"))).toContain("Maharashtra");

    changeSelect(country, "US");
    expect(optionTexts(select("State"))).toContain("California");
    changeSelect(select("State"), "California");
    changeSelect(country, "BR");
    expect(input("State / Province / Region").value).toBe("");
  });

  it("falls back to text region for unsupported subdivision countries", async () => {
    await renderDetails();

    changeSelect(select("Country"), "BR");
    fill("State / Province / Region", "Sao Paulo");

    expect(input("State / Province / Region").value).toBe("Sao Paulo");
  });

  it("derives Centre address from organisation address while checked and follows later changes", async () => {
    const form = completeForm({ address: "Updated Organisation Address" });
    const payload = buildSignupCreatePayload(form, "signup_1", "idem_1");

    expect(payload.centre).toMatchObject({
      address: "Updated Organisation Address",
      city: "Mumbai",
      stateRegion: "Maharashtra",
      postcode: "400022",
      country: "India",
    });
  });

  it("allows independent Centre address after unchecking same-address", async () => {
    const form = completeForm({
      sameCentreAddress: false,
      centreCountryCode: "AE",
      centreStateRegion: "Dubai",
      centreCity: "Dubai",
      centrePostcode: "00000",
      centreAddress: "Centre Address",
    });
    const payload = buildSignupCreatePayload(form, "signup_1", "idem_1");

    expect(payload.centre).toMatchObject({
      address: "Centre Address",
      city: "Dubai",
      stateRegion: "Dubai",
      postcode: "00000",
      country: "United Arab Emirates",
    });
  });

  it("derives Centre contact from verified account contact while checked", async () => {
    const form = completeForm({ authorityEmail: "updated@example.com" });
    const payload = buildSignupCreatePayload(form, "signup_1", "idem_1");

    expect(payload.centre.mobile).toBe("9876543210");
    expect(payload.centre.email).toBe("updated@example.com");
  });

  it("allows separate Centre contact after unchecking same-contact", async () => {
    const form = completeForm({
      sameCentreContact: false,
      centreMobile: "9876543211",
      centreEmail: "centre@example.com",
    });
    const payload = buildSignupCreatePayload(form, "signup_1", "idem_1");

    expect(payload.centre.mobile).toBe("9876543211");
    expect(payload.centre.email).toBe("centre@example.com");
  });

  it("reports one Centre for No and requires at least two for Yes", async () => {
    expect(buildSignupCreatePayload(completeForm(), "signup_1", "idem_1").onboarding.reportedCentreCount).toBe(1);
    expect(validateSignupFormDetails(completeForm({ hasMultipleCentres: true, reportedCentreCount: "1" }))).toBe("Enter at least 2 Centres, or choose No.");
    expect(buildSignupCreatePayload(completeForm({ hasMultipleCentres: true, reportedCentreCount: "4" }), "signup_1", "idem_1").onboarding.reportedCentreCount).toBe(4);
  });

  async function renderDetails() {
    apiMocks.createSignupOrganisation.mockClear();
    root.unmount();
    container.textContent = "";
    root = createRoot(container);
    await act(async () => {
      root.render(<SignupPage onComplete={vi.fn()} />);
    });
    await act(async () => undefined);
    fill("Authorised mobile number", "9876543210");
    await submit("form.login-form");
    fill("OTP sent to ******3210", "1234");
    await submit("form.login-form");
  }

  function input(label: string) {
    const element = elementByLabel(label);
    if (!element) throw new Error(`Input not found: ${label}`);
    return element as unknown as HTMLInputElement;
  }

  function select(label: string) {
    const element = elementByLabel(label);
    if (!element) throw new Error(`Select not found: ${label}`);
    return element as unknown as HTMLSelectElement;
  }

  function elementByLabel(label: string) {
    const aria = container.querySelector(`[aria-label="${label}"]`);
    if (aria) return aria;
    const labelElement = Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.includes(label));
    const forId = labelElement?.getAttribute("for");
    if (forId) return container.querySelector(`#${forId}`);
    return labelElement?.querySelector("input,select") || null;
  }

  function fill(label: string, value: string) {
    const element = input(label);
    act(() => {
      setNativeValue(element, value);
      element.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
      element.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    });
  }

  function changeSelect(element: HTMLSelectElement, value: string) {
    act(() => {
      setNativeValue(element, value);
      element.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    });
  }

  async function submit(selector: string) {
    const form = container.querySelector(selector);
    if (!form) throw new Error(`Form not found: ${selector}`);
    await act(async () => {
      form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
    });
  }

  function optionTexts(element: HTMLSelectElement) {
    return Array.from(element.options).map((option) => option.textContent || "");
  }

  function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter?.call(element, value);
  }

  function completeForm(overrides: Partial<SignupFormState> = {}): SignupFormState {
    return {
      ...signupDefaultForm,
      mobile: "9876543210",
      brandName: "Apex Skills",
      legalName: "Apex Skills Private Limited",
      authorityName: "Asha Owner",
      authorityEmail: "asha.owner@example.com",
      address: "101 Skill Street",
      city: "Mumbai",
      stateRegion: "Maharashtra",
      postcode: "400022",
      centreName: "Main Centre",
      termsAccepted: true,
      ...overrides,
    };
  }
});
