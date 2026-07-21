import { describe, expect, it } from "vitest";
import app from "../index";

describe("health routes", () => {
  it("returns the health response contract", async () => {
    const response = await app.request("https://portal.test/api/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      success: true,
      service: "samyak-student-portal",
    });
  });

  it("returns version metadata", async () => {
    const response = await app.request("https://portal.test/api/version");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      service: "samyak-student-portal",
      version: "0.1.0",
    });
  });
});
