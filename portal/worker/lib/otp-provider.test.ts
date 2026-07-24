import { describe, expect, it, vi } from "vitest";
import { canUseDevelopmentOtp, DevelopmentOtpProvider, getOtpProvider, Msg91OtpProvider } from "./otp-provider";
import type { WorkerBindings } from "../bindings";

const baseEnv: WorkerBindings = {
  DB: {} as D1Database,
  ENVIRONMENT: "development",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  PORTAL_APPS_SCRIPT_URL: "https://script.test",
  PORTAL_APPS_SCRIPT_SECRET: "portal-secret",
  SESSION_PEPPER: "pepper",
  DEV_OTP: "123456",
};

describe("OTP providers", () => {
  it("constructs MSG91 V5 send requests without exposing raw errors", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ type: "success", message: "request-id" }),
    });
    const provider = new Msg91OtpProvider({
      authKey: "auth",
      templateId: "template",
      senderId: "SENDER",
      fetcher,
    });

    await expect(provider.sendOtp("9876543210")).resolves.toEqual({
      ok: true,
      providerRequestId: "request-id",
      resultCode: "MSG91_OK",
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain("https://control.msg91.com/api/v5/otp");
    expect(url).toContain("mobile=919876543210");
    expect(url).toContain("template_id=template");
    expect(init).toMatchObject({ method: "POST" });
  });

  it("sanitizes MSG91 failures", async () => {
    const provider = new Msg91OtpProvider({
      authKey: "auth",
      templateId: "template",
      fetcher: vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ message: "provider said private detail" }),
      }),
    });

    await expect(provider.sendOtp("9876543210")).resolves.toEqual({
      ok: false,
      resultCode: "MSG91_HTTP_ERROR",
    });
  });

  it("locks the development provider to localhost development without MSG91 config", async () => {
    expect(canUseDevelopmentOtp(baseEnv, "localhost")).toBe(true);
    expect(canUseDevelopmentOtp({ ...baseEnv, ENVIRONMENT: "production" }, "localhost")).toBe(false);
    expect(canUseDevelopmentOtp(baseEnv, "portal.samyaksion.com")).toBe(false);
    expect(getOtpProvider({ ...baseEnv, MSG91_AUTH_KEY: "auth", MSG91_TEMPLATE_ID: "template" }, "localhost")?.name).toBe("msg91");
    await expect(new DevelopmentOtpProvider("123456").verifyOtp("9876543210", "111111")).resolves.toMatchObject({
      ok: false,
      resultCode: "DEV_INVALID",
    });
  });
});
