import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { registerConfigRoutes } from "./config";

function routeApp() {
  const app = new Hono();
  registerConfigRoutes(app as never);
  return app;
}

describe("public config routes", () => {
  it("exposes only https Google review URLs", async () => {
    const app = routeApp();
    const safe = await app.request("/api/public-config", {}, { GOOGLE_REVIEW_URL: "https://example.com/review?place=1" } as never);
    const unsafe = await app.request("/api/public-config", {}, { GOOGLE_REVIEW_URL: "javascript:alert(1)" } as never);

    await expect(safe.json()).resolves.toMatchObject({ googleReviewUrl: "https://example.com/review?place=1" });
    await expect(unsafe.json()).resolves.toMatchObject({ googleReviewUrl: "" });
  });
});
