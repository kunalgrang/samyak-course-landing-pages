import { describe, expect, it } from "vitest";
import {
  DEFAULT_COUNTRY_CODE,
  countries,
  countryByCode,
  hasCuratedSubdivisions,
  isValidSubdivision,
  subdivisionLabel,
} from "./geography";

describe("geography data", () => {
  it("defaults to India and exposes a reusable country list", () => {
    expect(DEFAULT_COUNTRY_CODE).toBe("IN");
    expect(countries.length).toBeGreaterThan(70);
    expect(countryByCode("IN")?.name).toBe("India");
  });

  it("includes current India states and union territories", () => {
    expect(subdivisionLabel("IN")).toBe("State / Union Territory");
    expect(hasCuratedSubdivisions("IN")).toBe(true);
    expect(isValidSubdivision("IN", "Maharashtra")).toBe(true);
    expect(isValidSubdivision("IN", "Delhi")).toBe(true);
  });

  it("models other major country subdivision terminology", () => {
    expect(subdivisionLabel("US")).toBe("State");
    expect(isValidSubdivision("US", "California")).toBe(true);
    expect(subdivisionLabel("CA")).toBe("Province / Territory");
    expect(isValidSubdivision("CA", "Ontario")).toBe(true);
    expect(subdivisionLabel("AE")).toBe("Emirate");
    expect(isValidSubdivision("AE", "Dubai")).toBe(true);
  });

  it("allows free-text regions where no curated list exists", () => {
    expect(hasCuratedSubdivisions("BR")).toBe(false);
    expect(subdivisionLabel("BR")).toBe("State / Province / Region");
    expect(isValidSubdivision("BR", "Sao Paulo")).toBe(true);
  });

  it("rejects incompatible curated subdivision values", () => {
    expect(isValidSubdivision("US", "Maharashtra")).toBe(false);
  });
});
