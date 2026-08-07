import { describe, expect, it, vi } from "vitest";
import { validateTurnstile } from "./turnstile";
import type { WorkerBindings } from "../bindings";

const env: WorkerBindings = {
  DB: {} as D1Database,
  ENVIRONMENT: "production",
  TURNSTILE_SITE_KEY: "site",
  TURNSTILE_SECRET_KEY: "secret",
  SESSION_PEPPER: "pepper",
};

describe("validateTurnstile", () => {
  it("accepts successful siteverify responses", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, action: "request-otp", hostname: "portal.samyaksion.com" }),
    });
    await expect(
      validateTurnstile({
        env,
        token: "token",
        expectedAction: "request-otp",
        hostname: "portal.samyaksion.com",
        fetcher,
      }),
    ).resolves.toEqual({ ok: true, resultCode: "TURNSTILE_OK" });
  });

  it("rejects action and hostname mismatches", async () => {
    await expect(
      validateTurnstile({
        env,
        token: "token",
        expectedAction: "request-otp",
        hostname: "portal.samyaksion.com",
        fetcher: vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true, action: "other", hostname: "portal.samyaksion.com" }),
        }),
      }),
    ).resolves.toMatchObject({ ok: false, resultCode: "TURNSTILE_ACTION_MISMATCH" });

    await expect(
      validateTurnstile({
        env,
        token: "token",
        expectedAction: "request-otp",
        hostname: "portal.samyaksion.com",
        fetcher: vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true, action: "request-otp", hostname: "evil.test" }),
        }),
      }),
    ).resolves.toMatchObject({ ok: false, resultCode: "TURNSTILE_HOSTNAME_MISMATCH" });
  });
});
