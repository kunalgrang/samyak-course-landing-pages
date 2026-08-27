import { describe, expect, it } from "vitest";
import { navigationForRoles, normalizePath } from "./Router";

describe("Router student namespace", () => {
  it("recognizes practical student login and dashboard URLs", () => {
    expect(normalizePath("/student/login")).toBe("/student/login");
    expect(normalizePath("/student/dashboard")).toBe("/student/dashboard");
    expect(normalizePath("/student/referrals")).toBe("/student/referrals");
    expect(normalizePath("/student/rules")).toBe("/student/rules");
    expect(normalizePath("/student/profile")).toBe("/student/profile");
  });

  it("keeps staff navigation separate from student self-service navigation", () => {
    expect(navigationForRoles(["owner"]).map((item) => item.path)).not.toEqual(expect.arrayContaining(["/student/referrals", "/app/referrals"]));
    expect(navigationForRoles(["student"]).map((item) => item.path)).toEqual([
      "/student/dashboard",
      "/student/certificates",
      "/student/referrals",
      "/student/rules",
      "/student/profile",
    ]);
  });
});
