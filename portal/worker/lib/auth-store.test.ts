import { describe, expect, it } from "vitest";
import { hmacHex } from "./crypto";
import { buildSessionCookie, checkOtpRequestLimits, clearSessionCookie, hasSessionCookie, sessionCookieName, type OtpChallengePurpose } from "./auth-store";
import type { AppContext } from "./http";

function context(url: string, environment: "development" | "preview" | "production", cookie = "") {
  return {
    req: { url, header: (name: string) => (name.toLowerCase() === "cookie" ? cookie : undefined) },
    env: { ENVIRONMENT: environment },
  } as unknown as AppContext;
}

type ChallengeLimitRow = {
  mobile_hash: string;
  purpose: OtpChallengePurpose;
  ip_hash: string;
  requested_at: string;
};

function rateLimitContext(challenges: ChallengeLimitRow[]) {
  return {
    env: {
      DB: {
        prepare: (sql: string) => ({
          bind: (...values: unknown[]) => ({
            first: async () => {
              if (sql.includes("mobile_hash = ?")) {
                const [hash, purpose, since] = values as [string, OtpChallengePurpose, string];
                return { count: challenges.filter((row) => row.mobile_hash === hash && row.purpose === purpose && row.requested_at >= since).length };
              }
              const [hash, since] = values as [string, string];
              return { count: challenges.filter((row) => row.ip_hash === hash && row.requested_at >= since).length };
            },
          }),
        }),
      },
    },
  } as unknown as AppContext;
}

describe("session security helpers", () => {
  it("hashes session tokens instead of storing raw tokens", async () => {
    const hash = await hmacHex("pepper", "session", "raw-session-token");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("raw-session-token");
  });

  it("uses the __Host cookie with secure attributes in production", () => {
    expect(buildSessionCookie(context("https://portal.samyaksion.com/login", "production"), "token")).toBe(
      "__Host-samyak_session=token; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(buildSessionCookie(context("https://portal.samyaksion.com/trainer/login", "production"), "token", "trainer")).toBe(
      "__Host-samyak_trainer_session=token; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(buildSessionCookie(context("https://portal.samyaksion.com/login", "production"), "token")).not.toContain("Domain=");
    expect(buildSessionCookie(context("https://portal.samyaksion.com/trainer/login", "production"), "token", "trainer")).not.toContain("Domain=");
    expect(clearSessionCookie(context("https://portal.samyaksion.com/login", "production"))).toBe(
      "__Host-samyak_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(clearSessionCookie(context("https://portal.samyaksion.com/trainer/login", "production"), "trainer")).toBe(
      "__Host-samyak_trainer_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("uses an unprefixed persistent cookie without Secure for local HTTP development", () => {
    expect(sessionCookieName(context("http://localhost:5173/login", "development"))).toBe("samyak_session");
    expect(sessionCookieName(context("http://localhost:5173/trainer/login", "development"), "trainer")).toBe("samyak_trainer_session");
    expect(buildSessionCookie(context("http://localhost:5173/login", "development"), "token")).toBe(
      "samyak_session=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(buildSessionCookie(context("http://localhost:5173/trainer/login", "development"), "token", "trainer")).toBe(
      "samyak_trainer_session=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(buildSessionCookie(context("http://127.0.0.1:5173/login", "development"), "token")).toBe(
      "samyak_session=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(clearSessionCookie(context("http://localhost:5173/login", "development"))).toBe(
      "samyak_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(clearSessionCookie(context("http://localhost:5173/trainer/login", "development"), "trainer")).toBe(
      "samyak_trainer_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(clearSessionCookie(context("http://127.0.0.1:5173/login", "development"))).toBe(
      "samyak_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("uses the __Host cookie with Secure for non-local development URLs", () => {
    expect(buildSessionCookie(context("https://samyak-student-portal.workers.dev/login", "development"), "token")).toBe(
      "__Host-samyak_session=token; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(buildSessionCookie(context("https://samyak-student-portal.workers.dev/trainer/login", "development"), "token", "trainer")).toBe(
      "__Host-samyak_trainer_session=token; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(buildSessionCookie(context("http://preview.test/login", "development"), "token")).toBe(
      "__Host-samyak_session=token; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
  });

  it("detects the environment-appropriate session cookie name", () => {
    expect(hasSessionCookie(context("http://localhost:5173/login", "development", "samyak_session=token"))).toBe(true);
    expect(hasSessionCookie(context("http://localhost:5173/trainer/login", "development", "samyak_trainer_session=token"), "trainer")).toBe(true);
    expect(hasSessionCookie(context("http://localhost:5173/login", "development", "__Host-samyak_session=token"))).toBe(false);
    expect(hasSessionCookie(context("http://localhost:5173/trainer/login", "development", "samyak_session=token"), "trainer")).toBe(false);
    expect(hasSessionCookie(context("https://portal.samyaksion.com/login", "production", "__Host-samyak_session=token"))).toBe(true);
    expect(hasSessionCookie(context("https://portal.samyaksion.com/trainer/login", "production", "__Host-samyak_trainer_session=token"), "trainer")).toBe(true);
    expect(hasSessionCookie(context("https://portal.samyaksion.com/login", "production", "samyak_session=token"))).toBe(false);
    expect(hasSessionCookie(context("https://portal.samyaksion.com/trainer/login", "production", "__Host-samyak_session=token"), "trainer")).toBe(false);
  });
});

describe("OTP request limits", () => {
  const now = new Date("2026-09-28T10:00:00.000Z");

  it("counts mobile request limits per OTP purpose", async () => {
    const signupRows = Array.from({ length: 8 }, (_, index) => ({
      mobile_hash: "mobile-one",
      purpose: "signup" as const,
      ip_hash: `ip-signup-${index}`,
      requested_at: "2026-09-28T09:30:00.000Z",
    }));
    const c = rateLimitContext(signupRows);

    await expect(checkOtpRequestLimits(c, "mobile-one", "new-ip", "signup", now)).resolves.toBe(false);
    await expect(checkOtpRequestLimits(c, "mobile-one", "new-ip", "login", now)).resolves.toBe(true);
  });

  it("keeps IP request limits shared across OTP purposes", async () => {
    const mixedPurposeRows = Array.from({ length: 10 }, (_, index) => ({
      mobile_hash: `mobile-${index}`,
      purpose: index % 2 === 0 ? ("signup" as const) : ("login" as const),
      ip_hash: "shared-ip",
      requested_at: "2026-09-28T09:55:00.000Z",
    }));
    const c = rateLimitContext(mixedPurposeRows);

    await expect(checkOtpRequestLimits(c, "fresh-mobile", "shared-ip", "login", now)).resolves.toBe(false);
    await expect(checkOtpRequestLimits(c, "fresh-mobile", "shared-ip", "signup", now)).resolves.toBe(false);
  });
});
