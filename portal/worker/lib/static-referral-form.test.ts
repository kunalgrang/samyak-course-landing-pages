import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(process.cwd(), "..");

describe("static referral form cutover", () => {
  it("calls only native public referral Worker endpoints", () => {
    const script = readFileSync(join(repoRoot, "assets/js/referral-form.js"), "utf8");
    expect(script).toContain("/api/public/referrals/resolve/");
    expect(script).toContain("/api/public/referrals/submit");
    expect(script).not.toContain("/api/referrals/referrer");
    expect(script).not.toContain("/api/referrals/courses");
    expect(script).not.toContain("/api/referrals/submit");
    expect(script).not.toMatch(/script\.google|Apps Script|APPS_SCRIPT/i);
  });

  it("documents the narrow Worker route needed by the static referral page", () => {
    const wranglerConfig = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
    expect(wranglerConfig).toContain('"pattern": "go.samyaksion.com/api/public/referrals/*"');
    expect(wranglerConfig).toContain('"zone_name": "samyaksion.com"');
    expect(wranglerConfig).not.toContain("go.samyaksion.com/*");
    expect(wranglerConfig).not.toMatch(/\*\.pages\.dev/);
  });

  it("submits actual course IDs with a bounded idempotency key and grouped categories", () => {
    const script = readFileSync(join(repoRoot, "assets/js/referral-form.js"), "utf8");
    expect(script).toContain("course.id");
    expect(script).toContain("Idempotency-Key");
    expect(script).toContain("crypto.getRandomValues");
    expect(script).toContain("optgroup");
    expect(script).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });

  it("keeps the referral page on a strict referrer policy", () => {
    const headers = readFileSync(join(repoRoot, "_headers"), "utf8");
    const page = readFileSync(join(repoRoot, "r/index.html"), "utf8");
    expect(headers).toContain("/r/*");
    expect(headers).toContain("Referrer-Policy: no-referrer");
    expect(page).toContain('<meta name="referrer" content="no-referrer">');
  });
});
