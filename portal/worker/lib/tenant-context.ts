import type { AppContext } from "./http";

export const CURRENT_ORGANISATION_ID = "org_samyak";
export const ORG_ID = CURRENT_ORGANISATION_ID;

export type OrganisationContext = {
  organisationId: string;
};

export type AuthenticatedOrganisationSession = {
  record: {
    organisation_id?: string | null;
  };
};

export function resolveOrganisationContext(_c: Pick<AppContext, "req" | "env">): OrganisationContext {
  return { organisationId: CURRENT_ORGANISATION_ID };
}

export function trustedOrganisationId(c: Pick<AppContext, "req" | "env">) {
  return resolveOrganisationContext(c).organisationId;
}

export function resolveAuthenticatedOrganisationContext(session: AuthenticatedOrganisationSession): OrganisationContext | null {
  if (session.record.organisation_id !== CURRENT_ORGANISATION_ID) return null;
  return { organisationId: session.record.organisation_id };
}
