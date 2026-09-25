import { createOpaqueId } from "./crypto";

export const ORGANISATION_KINDS = ["normal", "demo"] as const;
export type OrganisationKind = typeof ORGANISATION_KINDS[number];

export type TenantOutboundChannel = "sms" | "whatsapp" | "email" | "push";

export type TenantOperationalMessagingPolicy =
  | {
      allowed: true;
      mode: "live";
    }
  | {
      allowed: false;
      mode: "blocked";
      reason: "demo_organisation_operational_messaging_blocked";
    };

export type OrganisationSafetyProfile = {
  organisationId: string;
  organisationKind: OrganisationKind;
  isDemo: boolean;
  excludeFromBusinessMetrics: boolean;
  billableCustomer: boolean;
};

export type OrganisationDemoMarkSource = "platform_admin" | "maintenance";

export type OrganisationDemoAuditValues = {
  action: "organisation_marked_demo";
  entityType: "organisation";
  oldValuesJson: string;
  newValuesJson: string;
  metadataJson: string;
};

type DbContext = {
  env: {
    DB: D1Database;
  };
};

export function parseOrganisationKind(value: unknown): OrganisationKind {
  return value === "demo" ? "demo" : "normal";
}

export function isDemoOrganisationKind(kind: OrganisationKind) {
  return kind === "demo";
}

export function isPlatformAuthenticationOtpAllowed(_kind: OrganisationKind) {
  return true;
}

export function tenantOperationalMessagingPolicy(kind: OrganisationKind, _channel: TenantOutboundChannel): TenantOperationalMessagingPolicy {
  if (kind === "demo") {
    return {
      allowed: false,
      mode: "blocked",
      reason: "demo_organisation_operational_messaging_blocked",
    };
  }
  return { allowed: true, mode: "live" };
}

export function shouldExcludeFromBusinessMetrics(kind: OrganisationKind) {
  return kind === "demo";
}

export function isBillableCustomerOrganisationKind(kind: OrganisationKind) {
  return kind === "normal";
}

export async function getOrganisationSafetyProfile(c: DbContext, organisationId: string): Promise<OrganisationSafetyProfile | null> {
  const row = await c.env.DB.prepare("select id, organisation_kind from organisations where id = ?")
    .bind(organisationId)
    .first<{ id: string; organisation_kind: string | null }>();
  if (!row) return null;
  const organisationKind = parseOrganisationKind(row.organisation_kind);
  return {
    organisationId: row.id,
    organisationKind,
    isDemo: isDemoOrganisationKind(organisationKind),
    excludeFromBusinessMetrics: shouldExcludeFromBusinessMetrics(organisationKind),
    billableCustomer: isBillableCustomerOrganisationKind(organisationKind),
  };
}

export function buildOrganisationDemoAuditValues(input: {
  reason: string;
  source: OrganisationDemoMarkSource;
}): { ok: true; values: OrganisationDemoAuditValues } | { ok: false; status: 400; code: "DEMO_REASON_REQUIRED"; message: string } {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, status: 400, code: "DEMO_REASON_REQUIRED", message: "Record why the Organisation is being marked as demo." };
  }

  return {
    ok: true,
    values: {
      action: "organisation_marked_demo",
      entityType: "organisation",
      oldValuesJson: JSON.stringify({ organisationKind: "normal" }),
      newValuesJson: JSON.stringify({ organisationKind: "demo" }),
      metadataJson: JSON.stringify({ source: input.source, reason }),
    },
  };
}

export async function markOrganisationDemoForControlledSetup(
  c: DbContext,
  input: {
    organisationId: string;
    actorLoginAccountId?: string | null;
    actorPersonId?: string | null;
    reason: string;
    source: OrganisationDemoMarkSource;
    now?: string;
  },
) {
  const existing = await getOrganisationSafetyProfile(c, input.organisationId);
  if (!existing) {
    return { ok: false as const, status: 404, code: "ORGANISATION_NOT_FOUND", message: "Organisation was not found." };
  }
  if (existing.organisationKind === "demo") {
    return { ok: true as const, organisationId: input.organisationId, organisationKind: "demo" as const, changed: false };
  }

  const now = input.now || new Date().toISOString();
  const audit = buildOrganisationDemoAuditValues({ reason: input.reason, source: input.source });
  if (!audit.ok) return audit;

  const update = await c.env.DB.prepare("update organisations set organisation_kind = 'demo', updated_at = ? where id = ? and organisation_kind = 'normal'")
    .bind(now, input.organisationId)
    .run();
  const changes = Number(update.meta?.changes || update.meta?.rows_written || 0);
  if (changes === 0) {
    const refreshed = await getOrganisationSafetyProfile(c, input.organisationId);
    if (refreshed?.organisationKind === "demo") {
      return { ok: true as const, organisationId: input.organisationId, organisationKind: "demo" as const, changed: false };
    }
    return { ok: false as const, status: 409, code: "ORGANISATION_DEMO_TRANSITION_CONFLICT", message: "Organisation was not updated; reload the Organisation safety profile before retrying." };
  }

  await c.env.DB.prepare(
    `insert into audit_logs (id, organisation_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, old_values_json, new_values_json, metadata_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    createOpaqueId("audit"),
    input.organisationId,
    input.actorLoginAccountId || null,
    input.actorPersonId || null,
    audit.values.action,
    audit.values.entityType,
    input.organisationId,
    audit.values.oldValuesJson,
    audit.values.newValuesJson,
    audit.values.metadataJson,
    now,
  ).run();

  return { ok: true as const, organisationId: input.organisationId, organisationKind: "demo" as const, changed: true };
}
