import { describe, expect, it } from "vitest";
import { CURRENT_ORGANISATION_ID, resolveAuthenticatedOrganisationContext, resolveOrganisationContext, trustedOrganisationId } from "./tenant-context";
import type { AppContext } from "./http";

describe("trusted organisation context", () => {
  it("resolves the current Samyak tenant", () => {
    expect(resolveOrganisationContext(fakeContext()).organisationId).toBe(CURRENT_ORGANISATION_ID);
    expect(trustedOrganisationId(fakeContext())).toBe("org_samyak");
  });

  it("ignores arbitrary client-supplied organisation values", () => {
    const c = fakeContext("https://portal.test/api/auth/session?organisation_id=org_other", {
      "x-organisation-id": "org_other",
      "x-tenant-id": "org_other",
      cookie: "organisation_id=org_other",
    });

    expect(resolveOrganisationContext(c).organisationId).toBe("org_samyak");
  });

  it("derives authenticated organisation context from a validated session membership", () => {
    expect(resolveAuthenticatedOrganisationContext({ record: { organisation_membership_id: "omem_other", organisation_id: "org_other" } })).toEqual({
      organisationId: "org_other",
    });
    expect(resolveAuthenticatedOrganisationContext({ record: { organisation_membership_id: null, organisation_id: "org_other" } })).toBeNull();
    expect(resolveAuthenticatedOrganisationContext({ record: { organisation_membership_id: "omem_other", organisation_id: null } })).toBeNull();
  });
});

function fakeContext(url = "https://portal.test/api/auth/session", headers: Record<string, string> = {}) {
  return {
    env: {},
    req: {
      url,
      header(name: string) {
        return headers[name.toLowerCase()];
      },
    },
  } as unknown as AppContext;
}
