import { describe, expect, it } from "vitest";
import { normalizeIndianMobile } from "./staff-students";

describe("normalizeIndianMobile", () => {
  it("normalizes valid Indian mobile formats", () => {
    expect(normalizeIndianMobile("98765 43210")).toBe("+919876543210");
    expect(normalizeIndianMobile("+91-98765-43210")).toBe("+919876543210");
    expect(normalizeIndianMobile("919876543210")).toBe("+919876543210");
  });

  it("rejects invalid or landline-like values", () => {
    expect(normalizeIndianMobile("12345")).toBeNull();
    expect(normalizeIndianMobile("022-12345678")).toBeNull();
    expect(normalizeIndianMobile("5123456789")).toBeNull();
  });
});
