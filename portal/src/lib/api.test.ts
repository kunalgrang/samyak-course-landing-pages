import { describe, expect, it, vi } from "vitest";
import { getHealth } from "./api";

describe("getHealth", () => {
  it("parses the health response contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          service: "samyak-student-portal",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHealth()).resolves.toEqual({
      success: true,
      service: "samyak-student-portal",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/health", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });
  });
});
