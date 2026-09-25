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

export async function markOrganisationDemoForControlledSetup(
  c: DbContext,
  input: {
    organisationId: string;
    actorLoginAccountId?: string | null;
    actorPersonId?: string | null;
    reason: string;
    source: "platform_admin" | "maintenance";
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
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false as const, status: 400, code: "DEMO_REASON_REQUIRED", message: "Record why the Organisation is being marked as demo." };
  }

  await c.env.DB.batch([
    c.env.DB.prepare("update organisations set organisation_kind = 'demo', updated_at = ? where id = ? and organisation_kind = 'normal'")
      .bind(now, input.organisationId),
    c.env.DB.prepare(
      `insert into audit_logs (id, organisation_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, old_values_json, new_values_json, metadata_json, created_at)
       values (?, ?, ?, ?, 'organisation_marked_demo', 'organisation', ?, ?, ?, ?, ?)`,
    ).bind(
      createOpaqueId("audit"),
      input.organisationId,
      input.actorLoginAccountId || null,
      input.actorPersonId || null,
      input.organisationId,
      JSON.stringify({ organisationKind: "normal" }),
      JSON.stringify({ organisationKind: "demo" }),
      JSON.stringify({ source: input.source, reason }),
      now,
    ),
  ]);

  return { ok: true as const, organisationId: input.organisationId, organisationKind: "demo" as const, changed: true };
}
