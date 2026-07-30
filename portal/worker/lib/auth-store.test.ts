import { describe, expect, it } from "vitest";
import { hmacHex } from "./crypto";
import { buildSessionCookie, clearSessionCookie, hasSessionCookie, sessionCookieName } from "./auth-store";
import type { AppContext } from "./http";

function context(url: string, environment: "development" | "preview" | "production", cookie = "") {
  return {
    req: { url, header: (name: string) => (name.toLowerCase() === "cookie" ? cookie : undefined) },
    env: { ENVIRONMENT: environment },
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
    expect(buildSessionCookie(context("https://portal.samyaksion.com/login", "production"), "token")).not.toContain("Domain=");
    expect(clearSessionCookie(context("https://portal.samyaksion.com/login", "production"))).toBe(
      "__Host-samyak_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("uses an unprefixed persistent cookie without Secure for local HTTP development", () => {
    expect(sessionCookieName(context("http://localhost:5173/login", "development"))).toBe("samyak_session");
    expect(buildSessionCookie(context("http://localhost:5173/login", "development"), "token")).toBe(
      "samyak_session=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(buildSessionCookie(context("http://127.0.0.1:5173/login", "development"), "token")).toBe(
      "samyak_session=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(clearSessionCookie(context("http://localhost:5173/login", "development"))).toBe(
      "samyak_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(clearSessionCookie(context("http://127.0.0.1:5173/login", "development"))).toBe(
      "samyak_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("uses the __Host cookie with Secure for non-local development URLs", () => {
    expect(buildSessionCookie(context("https://samyak-student-portal.workers.dev/login", "development"), "token")).toBe(
      "__Host-samyak_session=token; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
    expect(buildSessionCookie(context("http://preview.test/login", "development"), "token")).toBe(
      "__Host-samyak_session=token; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
    );
  });

  it("detects the environment-appropriate session cookie name", () => {
    expect(hasSessionCookie(context("http://localhost:5173/login", "development", "samyak_session=token"))).toBe(true);
    expect(hasSessionCookie(context("http://localhost:5173/login", "development", "__Host-samyak_session=token"))).toBe(false);
    expect(hasSessionCookie(context("https://portal.samyaksion.com/login", "production", "__Host-samyak_session=token"))).toBe(true);
    expect(hasSessionCookie(context("https://portal.samyaksion.com/login", "production", "samyak_session=token"))).toBe(false);
  });
});
