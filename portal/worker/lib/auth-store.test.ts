import { describe, expect, it } from "vitest";
import { hmacHex } from "./crypto";
import { buildSessionCookie, clearSessionCookie } from "./auth-store";
import type { AppContext } from "./http";

function context(url: string, environment: "development" | "production") {
  return {
    req: { url },
    env: { ENVIRONMENT: environment },
  } as unknown as AppContext;
}

describe("session security helpers", () => {
  it("hashes session tokens instead of storing raw tokens", async () => {
    const hash = await hmacHex("pepper", "session", "raw-session-token");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("raw-session-token");
  });

  it("uses secure cookie attributes in production and local-safe cookies on localhost", () => {
    expect(buildSessionCookie(context("https://portal.samyaksion.com/login", "production"), "token")).toContain("Secure");
    expect(buildSessionCookie(context("http://localhost:5173/login", "development"), "token")).not.toContain("Secure");
    expect(clearSessionCookie(context("https://portal.samyaksion.com/login", "production"))).toContain("Max-Age=0");
  });
});
