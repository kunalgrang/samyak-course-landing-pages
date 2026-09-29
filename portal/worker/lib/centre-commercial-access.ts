export const CENTRE_COMMERCIAL_STATES = [
  "pending_payment",
  "trial",
  "active",
  "grace",
  "past_due",
  "suspended",
  "cancelled",
  "legacy_existing",
] as const;

export const CENTRE_OPERATIONAL_COMMERCIAL_STATES = ["trial", "active", "legacy_existing"] as const;

export const CENTRE_COMMERCIAL_SOURCES = [
  "migration_backfill",
  "organisation_signup_trial",
  "centre_created",
  "maintenance_activation",
  "billing_provider",
] as const;

export const CENTRE_PAYMENT_EVIDENCE_SOURCES = [
  "external_manual_verification",
  "payment_provider",
  "invoice_settlement",
] as const;

export type CentreCommercialState = typeof CENTRE_COMMERCIAL_STATES[number];
export type CentreOperationalCommercialState = typeof CENTRE_OPERATIONAL_COMMERCIAL_STATES[number];
export type CentreCommercialSource = typeof CENTRE_COMMERCIAL_SOURCES[number];
export type CentrePaymentEvidenceSource = typeof CENTRE_PAYMENT_EVIDENCE_SOURCES[number];

export function isCentreCommerciallyOperational(state: string | null | undefined): state is CentreOperationalCommercialState {
  return (CENTRE_OPERATIONAL_COMMERCIAL_STATES as readonly string[]).includes(String(state || ""));
}

export function centreCommercialStatusLabel(state: string | null | undefined) {
  switch (state) {
    case "pending_payment":
      return "Pending subscription";
    case "trial":
      return "Trial";
    case "active":
      return "Active subscription";
    case "legacy_existing":
      return "Existing access";
    case "grace":
      return "Grace";
    case "past_due":
      return "Past due";
    case "suspended":
      return "Suspended";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

export function operationalCentreJoinSql(branchAlias = "branches") {
  return `join centre_commercial_access on centre_commercial_access.branch_id = ${branchAlias}.id
          and centre_commercial_access.organisation_id = ${branchAlias}.organisation_id`;
}

export function operationalCentreWhereSql(branchAlias = "branches", commercialAlias = "centre_commercial_access") {
  return `${branchAlias}.status = 'active'
    and ${branchAlias}.centre_status = 'active'
    and ${commercialAlias}.state in (${CENTRE_OPERATIONAL_COMMERCIAL_STATES.map((state) => `'${state}'`).join(", ")})`;
}
