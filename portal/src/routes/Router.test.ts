import { describe, expect, it } from "vitest";
import { navigationForRoles, normalizePath, redirectForRouteState } from "./Router";

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

  it("canonicalizes authenticated student legacy app URLs into the student namespace", () => {
    expect(redirectForRouteState(state({ path: "/app" }))).toBe("/student/dashboard");
    expect(redirectForRouteState(state({ path: "/app/certificates" }))).toBe("/student/certificates");
    expect(redirectForRouteState(state({ path: "/app/referrals" }))).toBe("/student/referrals");
    expect(redirectForRouteState(state({ path: "/app/rules" }))).toBe("/student/rules");
    expect(redirectForRouteState(state({ path: "/app/profile" }))).toBe("/student/profile");
    expect(redirectForRouteState(state({ path: "/student/referrals" }))).toBeNull();
  });

  it("keeps staff and student route guards loop-free", () => {
    expect(redirectForRouteState(state({ path: "/student/referrals", isStaff: true }))).toBe("/app/enquiries");
    expect(redirectForRouteState(state({ path: "/app/referrals", isStaff: true }))).toBe("/app/enquiries");
    expect(redirectForRouteState(state({ path: "/app/enquiries", isStaff: false, canAccessEnquiries: false }))).toBe("/student/dashboard");
    expect(redirectForRouteState(state({ path: "/login", isStaff: false }))).toBe("/student/dashboard");
    expect(redirectForRouteState(state({ path: "/student/login", isStaff: true }))).toBe("/app/enquiries");
  });

  it("sends unauthenticated app and student pages to the correct login experience", () => {
    expect(redirectForRouteState(state({ path: "/student/dashboard", isAuthenticated: false }))).toBe("/student/login");
    expect(redirectForRouteState(state({ path: "/app/referrals", isAuthenticated: false }))).toBe("/login");
    expect(redirectForRouteState(state({ path: "/student/dashboard", isAuthenticated: false, hasSessionError: true }))).toBeNull();
  });
});

function state(overrides: Partial<Parameters<typeof redirectForRouteState>[0]> = {}): Parameters<typeof redirectForRouteState>[0] {
  return {
    path: "/student/dashboard",
    isAuthenticated: true,
    isLoading: false,
    hasSessionError: false,
    isStaff: false,
    canAccessEnquiries: false,
    canAccessStudents: false,
    isCourseAdmin: false,
    isDiscountApprover: false,
    ...overrides,
  };
}
