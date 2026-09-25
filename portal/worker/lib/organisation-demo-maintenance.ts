/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpaqueId } from "./crypto.ts";
import { buildOrganisationDemoAuditValues, ORGANISATION_KINDS, type OrganisationKind } from "./organisation-safety.ts";
import { type RemoteD1Client, type RemoteD1QueryResult, WranglerRemoteD1Client } from "./legacy-import-remote-preflight.ts";

export const PRODUCTION_DEMO_DATABASE = "samyak-student-portal";

export type DemoMaintenanceArgs = {
  remote: boolean;
  preflight: boolean;
  apply: boolean;
  confirmApply: boolean;
  confirmProductionDemo: boolean;
  organisationId: string;
  expectedName: string;
  reason: string;
  databaseName: string;
};

export type DemoMaintenanceTarget = {
  id: string;
  name: string;
  status: string;
  organisationKind: string;
  centreCount: number;
  membershipCount: number;
  commercialAccessState: string | null;
  demoOrganisationCount: number;
};

export type DemoMaintenancePreflightReport = {
  mode: "remote_preflight";
  status: "READY" | "ALREADY_DEMO" | "BLOCKED";
  code: string;
  writeOperationsPerformed: false;
  target: DemoMaintenanceTarget | null;
  zeroWriteProof: {
    queries: number;
    changedDbFalse: boolean;
    rowsWritten: number;
  };
};

export type DemoMaintenanceApplyReport = {
  mode: "remote_apply";
  status: "APPLIED" | "ALREADY_DEMO";
  code: string;
  remoteWriteExecuted: boolean;
  remoteWriteModel: "d1_execute_file_guarded_transaction";
  auditId: string | null;
  preflight: DemoMaintenancePreflightReport;
  verification: {
    organisationKind: OrganisationKind;
    auditRowsCreated: number;
    demoOrganisationCountBefore: number;
    demoOrganisationCountAfter: number;
  };
};

export type RemoteD1WriteClient = RemoteD1Client & {
  databaseName: string;
  cwd: string;
  metas?: Array<{ changed_db?: boolean; changes?: number; rows_written?: number }>;
  executeSqlFile(sql: string): Promise<void> | void;
};

export function validateDemoMaintenanceRequest(input: DemoMaintenanceArgs) {
  if (!input.remote) throw new Error("Demo Organisation maintenance requires --remote.");
  if (input.preflight === input.apply) throw new Error("Use exactly one of --preflight or --apply.");
  if (!input.organisationId.trim()) throw new Error("Missing --organisation.");
  if (!input.expectedName.trim()) throw new Error("Missing --expected-name.");
  if (input.databaseName !== PRODUCTION_DEMO_DATABASE) throw new Error(`Demo Organisation maintenance is locked to D1 database ${PRODUCTION_DEMO_DATABASE}.`);
  if (input.apply) {
    if (!input.confirmApply || !input.confirmProductionDemo) {
      throw new Error("Remote demo apply requires --remote --apply --confirm-apply --confirm-production-demo.");
    }
    if (!input.reason.trim()) throw new Error("Missing --reason.");
  }
}

export async function buildRemotePreflightDemoOrganisation(
  client: RemoteD1Client,
  options: Pick<DemoMaintenanceArgs, "organisationId" | "expectedName">,
): Promise<DemoMaintenancePreflightReport> {
  const queryMetas: Array<{ changed_db?: boolean; changes?: number; rows_written?: number }> = [];
  const execute = async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string) => {
    const result = await client.execute<T>(sql);
    queryMetas.push(result.meta);
    return result.results;
  };

  const target = await loadDemoMaintenanceTarget(execute, options.organisationId);
  const reportBase = {
    mode: "remote_preflight" as const,
    writeOperationsPerformed: false as const,
    target,
    zeroWriteProof: {
      queries: queryMetas.length,
      changedDbFalse: queryMetas.every((meta) => meta.changed_db === false),
      rowsWritten: queryMetas.reduce((sum, meta) => sum + Number(meta.rows_written || meta.changes || 0), 0),
    },
  };

  if (!target) return { ...reportBase, status: "BLOCKED", code: "ORGANISATION_NOT_FOUND" };
  if (target.name !== options.expectedName) return { ...reportBase, status: "BLOCKED", code: "EXPECTED_NAME_MISMATCH" };
  if (!isKnownOrganisationKind(target.organisationKind)) return { ...reportBase, status: "BLOCKED", code: "UNEXPECTED_ORGANISATION_KIND" };
  if (target.status !== "active") return { ...reportBase, status: "BLOCKED", code: "ORGANISATION_NOT_ACTIVE" };
  if (target.organisationKind === "demo") return { ...reportBase, status: "ALREADY_DEMO", code: "ALREADY_DEMO" };
  return { ...reportBase, status: "READY", code: "READY_FOR_DEMO_CLASSIFICATION" };
}

export async function applyRemoteDemoOrganisationClassification(
  client: RemoteD1WriteClient,
  options: Pick<DemoMaintenanceArgs, "organisationId" | "expectedName" | "reason">,
): Promise<DemoMaintenanceApplyReport> {
  const preflight = await buildRemotePreflightDemoOrganisation(client, options);
  if (preflight.status === "ALREADY_DEMO") {
    return {
      mode: "remote_apply",
      status: "ALREADY_DEMO",
      code: "ALREADY_DEMO",
      remoteWriteExecuted: false,
      remoteWriteModel: "d1_execute_file_guarded_transaction",
      auditId: null,
      preflight,
      verification: {
        organisationKind: "demo",
        auditRowsCreated: 0,
        demoOrganisationCountBefore: preflight.target?.demoOrganisationCount || 0,
        demoOrganisationCountAfter: preflight.target?.demoOrganisationCount || 0,
      },
    };
  }
  if (preflight.status !== "READY" || !preflight.target) throw new Error(`Demo Organisation apply blocked: ${preflight.code}.`);

  const audit = buildOrganisationDemoAuditValues({ source: "maintenance", reason: options.reason });
  if (!audit.ok) throw new Error(audit.message);

  const now = new Date().toISOString();
  const auditId = createOpaqueId("audit");
  const sql = buildRemoteDemoOrganisationApplySql({
    auditId,
    now,
    organisationId: options.organisationId,
    expectedName: options.expectedName,
    auditValues: audit.values,
  });
  await client.executeSqlFile(sql);

  const verificationRows = await client.execute<{
    organisation_kind: string;
    audit_rows: number;
    demo_count: number;
  }>(
    `select
       organisations.organisation_kind,
       (select count(*) from audit_logs where id = ${q(auditId)} and organisation_id = ${q(options.organisationId)} and action = ${q(audit.values.action)}) as audit_rows,
       (select count(*) from organisations where organisation_kind = 'demo') as demo_count
     from organisations
     where organisations.id = ${q(options.organisationId)}`,
  );
  const verification = verificationRows.results[0];
  if (!verification) throw new Error("Demo Organisation apply verification failed: Organisation was not found after write.");
  if (verification.organisation_kind !== "demo") throw new Error(`Demo Organisation apply verification failed: kind=${verification.organisation_kind}.`);
  if (Number(verification.audit_rows) !== 1) throw new Error(`Demo Organisation apply verification failed: audit rows=${verification.audit_rows}.`);
  if (Number(verification.demo_count) !== preflight.target.demoOrganisationCount + 1) {
    throw new Error(`Demo Organisation apply verification failed: demo count changed from ${preflight.target.demoOrganisationCount} to ${verification.demo_count}.`);
  }

  return {
    mode: "remote_apply",
    status: "APPLIED",
    code: "DEMO_CLASSIFICATION_APPLIED",
    remoteWriteExecuted: true,
    remoteWriteModel: "d1_execute_file_guarded_transaction",
    auditId,
    preflight,
    verification: {
      organisationKind: "demo",
      auditRowsCreated: Number(verification.audit_rows),
      demoOrganisationCountBefore: preflight.target.demoOrganisationCount,
      demoOrganisationCountAfter: Number(verification.demo_count),
    },
  };
}

export function buildRemoteDemoOrganisationApplySql(input: {
  auditId: string;
  now: string;
  organisationId: string;
  expectedName: string;
  auditValues: {
    action: string;
    entityType: string;
    oldValuesJson: string;
    newValuesJson: string;
    metadataJson: string;
  };
}) {
  return [
    "BEGIN TRANSACTION;",
    `UPDATE organisations SET organisation_kind = 'demo', updated_at = ${q(input.now)} WHERE id = ${q(input.organisationId)} AND name = ${q(input.expectedName)} AND status = 'active' AND organisation_kind = 'normal';`,
    `INSERT INTO audit_logs (id, organisation_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, old_values_json, new_values_json, metadata_json, created_at)
SELECT ${q(input.auditId)}, id, NULL, NULL, ${q(input.auditValues.action)}, ${q(input.auditValues.entityType)}, id, ${q(input.auditValues.oldValuesJson)}, ${q(input.auditValues.newValuesJson)}, ${q(input.auditValues.metadataJson)}, ${q(input.now)}
FROM organisations
WHERE id = ${q(input.organisationId)} AND name = ${q(input.expectedName)} AND organisation_kind = 'demo' AND changes() = 1;`,
    "COMMIT;",
    "",
  ].join("\n");
}

export class WranglerRemoteD1WriteClient extends WranglerRemoteD1Client implements RemoteD1WriteClient {
  executeSqlFile(sql: string) {
    const dir = mkdtempSync(join(tmpdir(), "samyak-demo-org-"));
    const file = join(dir, "demo-organisation-maintenance.sql");
    try {
      writeFileSync(file, sql, "utf8");
      const wranglerBin = join(this.cwd, "node_modules", "wrangler", "bin", "wrangler.js");
      execFileSync(process.execPath, [wranglerBin, "d1", "execute", this.databaseName, "--remote", "--file", file], {
        cwd: this.cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } finally {
      if (existsSync(file)) unlinkSync(file);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function loadDemoMaintenanceTarget(
  execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>,
  organisationId: string,
): Promise<DemoMaintenanceTarget | null> {
  const rows = await execute<{
    id: string;
    name: string;
    status: string;
    organisation_kind: string | null;
    centre_count: number;
    membership_count: number;
    commercial_access_state: string | null;
    demo_organisation_count: number;
  }>(
    `select
       organisations.id,
       organisations.name,
       organisations.status,
       organisations.organisation_kind,
       (select count(*) from branches where branches.organisation_id = organisations.id) as centre_count,
       (select count(*) from organisation_memberships where organisation_memberships.organisation_id = organisations.id) as membership_count,
       (select state from organisation_commercial_access where organisation_commercial_access.organisation_id = organisations.id limit 1) as commercial_access_state,
       (select count(*) from organisations where organisation_kind = 'demo') as demo_organisation_count
     from organisations
     where organisations.id = ${q(organisationId)}
     limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    organisationKind: row.organisation_kind ?? "normal",
    centreCount: Number(row.centre_count || 0),
    membershipCount: Number(row.membership_count || 0),
    commercialAccessState: row.commercial_access_state,
    demoOrganisationCount: Number(row.demo_organisation_count || 0),
  };
}

function isKnownOrganisationKind(kind: string): kind is OrganisationKind {
  return (ORGANISATION_KINDS as readonly string[]).includes(kind);
}

function q(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function createRemoteDemoMaintenanceClient(databaseName = PRODUCTION_DEMO_DATABASE) {
  return new WranglerRemoteD1WriteClient(databaseName);
}

export async function runRemoteDemoMaintenance(input: DemoMaintenanceArgs) {
  validateDemoMaintenanceRequest(input);
  const client = input.apply
    ? createRemoteDemoMaintenanceClient(input.databaseName)
    : new WranglerRemoteD1Client(input.databaseName);
  if (input.preflight) {
    return buildRemotePreflightDemoOrganisation(client, input);
  }
  return applyRemoteDemoOrganisationClassification(client as RemoteD1WriteClient, input);
}
