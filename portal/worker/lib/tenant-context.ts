import type { AppContext } from "./http";

export const CURRENT_ORGANISATION_ID = "org_samyak";
export const ORG_ID = CURRENT_ORGANISATION_ID;

export type OrganisationContext = {
  organisationId: string;
};

export type AuthenticatedOrganisationSession = {
  record: {
    organisation_id?: string | null;
    organisation_membership_id?: string | null;
  };
};

export function resolveOrganisationContext(_c: Pick<AppContext, "req" | "env">): OrganisationContext {
  return { organisationId: CURRENT_ORGANISATION_ID };
}

export function trustedOrganisationId(c: Pick<AppContext, "req" | "env">) {
  return resolveOrganisationContext(c).organisationId;
}

export function setAuthenticatedOrganisationId(c: Partial<Pick<AppContext, "set">>, organisationId: string) {
  if (typeof c.set === "function") c.set("authenticatedOrganisationId", organisationId);
}

export function authenticatedOrDefaultOrganisationId(c: Partial<Pick<AppContext, "get">>) {
  if (typeof c.get !== "function") return CURRENT_ORGANISATION_ID;
  return c.get("authenticatedOrganisationId") || CURRENT_ORGANISATION_ID;
}

export function resolveAuthenticatedOrganisationContext(session: AuthenticatedOrganisationSession): OrganisationContext | null {
  if (!session.record.organisation_membership_id || !session.record.organisation_id) return null;
  return { organisationId: session.record.organisation_id };
}
