import { describe, expect, it, vi } from "vitest";
import app from "../index";
import type { WorkerBindings } from "../bindings";

class FakeD1Statement {
  constructor(
    private readonly db: FakeD1,
    private readonly sql: string,
    private values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("count(*) as count")) return { count: 0 } as T;
    if (this.sql.includes("from user_sessions")) return null as T;
    return null as T;
  }

  async all<T>() {
    return { results: [] as T[] };
  }

  async run() {
    this.db.writes.push({ sql: this.sql, values: this.values });
    return { success: true };
  }
}

class FakeD1 {
  writes: Array<{ sql: string; values: unknown[] }> = [];

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }
}

function env(db = new FakeD1()): WorkerBindings {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: "development",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    PORTAL_APPS_SCRIPT_URL: "https://script.test",
    PORTAL_APPS_SCRIPT_SECRET: "portal-secret",
    SESSION_PEPPER: "test-pepper",
    DEV_OTP: "123456",
  };
}

describe("auth routes", () => {
  it("requires same-origin for state-changing auth requests", async () => {
    const response = await app.request(
      "http://localhost/api/auth/request-otp",
      {
        method: "POST",
        headers: { Origin: "https://evil.test", "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: "9876543210", turnstileToken: "token" }),
      },
      env(),
    );
    expect(response.status).toBe(403);
  });

  it("returns generic unknown-mobile challenge shape and stores no plaintext mobile in D1", async () => {
    const db = new FakeD1();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("siteverify")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, action: "request-otp", hostname: "localhost" }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, eligible: false, profiles: [] }) });
      }),
    );

    const response = await app.request(
      "http://localhost/api/auth/request-otp",
      {
        method: "POST",
        headers: { Origin: "http://localhost", "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: "9876543210", turnstileToken: "token" }),
      },
      env(db),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      message: "If this mobile number is registered, an OTP has been sent.",
    });
    expect(JSON.stringify(db.writes)).not.toContain("9876543210");
  });

  it("keeps /api/health working", async () => {
    const response = await app.request("https://portal.test/api/health", {}, env());
    expect(response.status).toBe(200);
  });

  it("rejects protected referral API when unauthenticated", async () => {
    const response = await app.request("https://portal.test/api/student/referrals", {}, env());
    expect(response.status).toBe(401);
  });
});
