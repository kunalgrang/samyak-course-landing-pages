import { describe, expect, it } from "vitest";
import { normalizeIndianMobile } from "./mobile";

describe("normalizeIndianMobile", () => {
  it("normalizes accepted Indian mobile formats", () => {
    expect(normalizeIndianMobile("9876543210")).toBe("9876543210");
    expect(normalizeIndianMobile("+91 98765 43210")).toBe("9876543210");
    expect(normalizeIndianMobile("09876543210")).toBe("9876543210");
    expect(normalizeIndianMobile("919876543210")).toBe("9876543210");
  });

  it("rejects invalid mobile numbers", () => {
    expect(normalizeIndianMobile("1234567890")).toBeNull();
    expect(normalizeIndianMobile("98765")).toBeNull();
  });
});
