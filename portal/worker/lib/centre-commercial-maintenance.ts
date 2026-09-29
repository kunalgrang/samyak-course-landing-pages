/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpaqueId } from "./crypto.ts";
import { PRODUCTION_DEMO_DATABASE } from "./organisation-demo-maintenance.ts";
import { type RemoteD1Client, WranglerRemoteD1Client } from "./legacy-import-remote-preflight.ts";
import { CENTRE_PAYMENT_EVIDENCE_SOURCES, type CentrePaymentEvidenceSource } from "./centre-commercial-access.ts";

export const PRODUCTION_CENTRE_COMMERCIAL_DATABASE = PRODUCTION_DEMO_DATABASE;

export type CentreCommercialMaintenanceArgs = {
  remote: boolean;
  preflight: boolean;
  apply: boolean;
  confirmApply: boolean;
  confirmCentreCommercial: boolean;
  organisationId: string;
  expectedOrganisationName: string;
  centreId: string;
  expectedCentreCode: string;
  expectedCentreName: string;
  paymentEvidenceSource: CentrePaymentEvidenceSource | "";
  paymentReference: string;
  reason: string;
  databaseName: string;
};

export type CentreCommercialTarget = {
  organisationId: string;
  organisationName: string;
  organisationStatus: string;
  centreId: string;
  centreCode: string;
  centreName: string;
  branchStatus: string;
  centreStatus: string;
  commercialAccessId: string | null;
  commercialState: string | null;
  paymentEvidenceSource: string | null;
  paymentEvidenceReference: string | null;
  activatedAt: string | null;
};

export type CentreCommercialPreflightReport = {
  mode: "remote_preflight";
  status: "READY" | "ALREADY_ACTIVE" | "BLOCKED";
  code: string;
  writeOperationsPerformed: false;
  target: CentreCommercialTarget | null;
  zeroWriteProof: {
    queries: number;
    changedDbFalse: boolean;
    rowsWritten: number;
  };
};

export type CentreCommercialApplyReport = {
  mode: "remote_apply";
  status: "APPLIED" | "ALREADY_ACTIVE";
  code: string;
  remoteWriteExecuted: boolean;
  remoteWriteModel: "wrangler_d1_execute_file_transaction";
  auditId: string | null;
  preflight: CentreCommercialPreflightReport;
  verification: {
    branchStatus: string;
    centreStatus: string;
    commercialState: string;
    auditRowsCreated: number;
  };
};

export type RemoteD1WriteClient = RemoteD1Client & {
  databaseName: string;
  cwd: string;
  metas?: Array<{ changed_db?: boolean; changes?: number; rows_written?: number }>;
  executeSqlFile(sql: string): Promise<void> | void;
};

const PAYMENT_REFERENCE_MAX_LENGTH = 180;
const ACTIVATION_REASON_MAX_LENGTH = 500;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

export function validateCentreCommercialMaintenanceRequest(input: CentreCommercialMaintenanceArgs) {
  if (!input.remote) throw new Error("Centre commercial maintenance requires --remote.");
  if (input.preflight === input.apply) throw new Error("Use exactly one of --preflight or --apply.");
  if (input.databaseName !== PRODUCTION_CENTRE_COMMERCIAL_DATABASE) throw new Error(`Centre commercial maintenance is locked to D1 database ${PRODUCTION_CENTRE_COMMERCIAL_DATABASE}.`);
  validateCentreCommercialActivationInput(input);
  if (input.apply && (!input.confirmApply || !input.confirmCentreCommercial)) {
    throw new Error("Remote Centre commercial apply requires --remote --apply --confirm-apply --confirm-centre-commercial.");
  }
}

export function validateCentreCommercialActivationInput(
  input: Pick<CentreCommercialMaintenanceArgs, "organisationId" | "expectedOrganisationName" | "centreId" | "expectedCentreCode" | "expectedCentreName" | "paymentEvidenceSource" | "paymentReference" | "reason">,
) {
  if (!input.organisationId.trim()) throw new Error("Missing --organisation.");
  if (!input.expectedOrganisationName.trim()) throw new Error("Missing --expected-organisation-name.");
  if (!input.centreId.trim()) throw new Error("Missing --centre.");
  if (!input.expectedCentreCode.trim()) throw new Error("Missing --expected-centre-code.");
  if (!input.expectedCentreName.trim()) throw new Error("Missing --expected-centre-name.");
  if (!isPaymentEvidenceSource(input.paymentEvidenceSource)) throw new Error("Missing or invalid --payment-evidence-source.");
  validateSafeText("payment-reference", input.paymentReference, PAYMENT_REFERENCE_MAX_LENGTH);
  validateSafeText("reason", input.reason, ACTIVATION_REASON_MAX_LENGTH);
}

export async function buildRemotePreflightCentreCommercialActivation(
  client: RemoteD1Client,
  options: Pick<CentreCommercialMaintenanceArgs, "organisationId" | "expectedOrganisationName" | "centreId" | "expectedCentreCode" | "expectedCentreName" | "paymentEvidenceSource" | "paymentReference" | "reason">,
): Promise<CentreCommercialPreflightReport> {
  validateCentreCommercialActivationInput(options);
  const queryMetas: Array<{ changed_db?: boolean; changes?: number; rows_written?: number }> = [];
  const execute = async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string) => {
    const result = await client.execute<T>(sql);
    queryMetas.push(result.meta);
    return result.results;
  };
  const target = await loadCentreCommercialTarget(execute, options.organisationId, options.centreId);
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

  if (!target) return { ...reportBase, status: "BLOCKED", code: "CENTRE_NOT_FOUND" };
  if (target.organisationName !== options.expectedOrganisationName) return { ...reportBase, status: "BLOCKED", code: "EXPECTED_ORGANISATION_NAME_MISMATCH" };
  if (target.organisationStatus !== "active") return { ...reportBase, status: "BLOCKED", code: "ORGANISATION_NOT_ACTIVE" };
  if (target.centreCode !== options.expectedCentreCode) return { ...reportBase, status: "BLOCKED", code: "EXPECTED_CENTRE_CODE_MISMATCH" };
  if (target.centreName !== options.expectedCentreName) return { ...reportBase, status: "BLOCKED", code: "EXPECTED_CENTRE_NAME_MISMATCH" };
  if (!target.commercialAccessId) return { ...reportBase, status: "BLOCKED", code: "CENTRE_COMMERCIAL_ACCESS_MISSING" };

  const sameEvidence = target.paymentEvidenceSource === options.paymentEvidenceSource && target.paymentEvidenceReference === options.paymentReference;
  if (target.branchStatus === "active" && target.centreStatus === "active" && target.commercialState === "active") {
    return {
      ...reportBase,
      status: sameEvidence ? "ALREADY_ACTIVE" : "BLOCKED",
      code: sameEvidence ? "ALREADY_ACTIVE" : "ACTIVE_EVIDENCE_CONFLICT",
    };
  }
  if (target.branchStatus !== "inactive" || target.centreStatus !== "pending_subscription") return { ...reportBase, status: "BLOCKED", code: "CENTRE_OPERATIONAL_STATE_NOT_PENDING" };
  if (target.commercialState !== "pending_payment") return { ...reportBase, status: "BLOCKED", code: "CENTRE_COMMERCIAL_STATE_NOT_PENDING_PAYMENT" };
  if (target.paymentEvidenceSource || target.paymentEvidenceReference || target.activatedAt) return { ...reportBase, status: "BLOCKED", code: "PAYMENT_EVIDENCE_ALREADY_PRESENT" };
  return { ...reportBase, status: "READY", code: "READY_FOR_ACTIVATION" };
}

export async function applyRemoteCentreCommercialActivation(
  client: RemoteD1WriteClient,
  options: Pick<CentreCommercialMaintenanceArgs, "organisationId" | "expectedOrganisationName" | "centreId" | "expectedCentreCode" | "expectedCentreName" | "paymentEvidenceSource" | "paymentReference" | "reason">,
): Promise<CentreCommercialApplyReport> {
  const preflight = await buildRemotePreflightCentreCommercialActivation(client, options);
  if (preflight.status === "ALREADY_ACTIVE") {
    return {
      mode: "remote_apply",
      status: "ALREADY_ACTIVE",
      code: "ALREADY_ACTIVE",
      remoteWriteExecuted: false,
      remoteWriteModel: "wrangler_d1_execute_file_transaction",
      auditId: null,
      preflight,
      verification: {
        branchStatus: preflight.target?.branchStatus || "active",
        centreStatus: preflight.target?.centreStatus || "active",
        commercialState: preflight.target?.commercialState || "active",
        auditRowsCreated: 0,
      },
    };
  }
  if (preflight.status !== "READY" || !preflight.target?.commercialAccessId) throw new Error(`Centre commercial activation blocked: ${preflight.code}.`);

  const now = new Date().toISOString();
  const auditId = createOpaqueId("audit");
  const sql = buildRemoteCentreCommercialActivationSql({
    auditId,
    now,
    organisationId: options.organisationId,
    expectedOrganisationName: options.expectedOrganisationName,
    centreId: options.centreId,
    expectedCentreCode: options.expectedCentreCode,
    expectedCentreName: options.expectedCentreName,
    commercialAccessId: preflight.target.commercialAccessId,
    paymentEvidenceSource: options.paymentEvidenceSource,
    paymentReference: options.paymentReference,
    reason: options.reason,
  });
  await client.executeSqlFile(sql);

  const verificationRows = await client.execute<{
    branch_status: string;
    centre_status: string;
    commercial_state: string;
    audit_rows: number;
  }>(
    `select branches.status as branch_status, branches.centre_status,
       centre_commercial_access.state as commercial_state,
       (select count(*) from audit_logs where id = ${q(auditId)} and organisation_id = ${q(options.organisationId)} and branch_id = ${q(options.centreId)} and action = 'centre_commercial_access_activated') as audit_rows
     from branches
     join centre_commercial_access on centre_commercial_access.branch_id = branches.id
     where branches.id = ${q(options.centreId)} and branches.organisation_id = ${q(options.organisationId)}`,
  );
  const verification = verificationRows.results[0];
  if (!verification) throw new Error("Centre commercial activation verification failed: Centre was not found after write.");
  if (verification.branch_status !== "active" || verification.centre_status !== "active" || verification.commercial_state !== "active") {
    throw new Error(`Centre commercial activation verification failed: branch=${verification.branch_status}/${verification.centre_status}, commercial=${verification.commercial_state}.`);
  }
  if (Number(verification.audit_rows) !== 1) throw new Error(`Centre commercial activation verification failed: audit rows=${verification.audit_rows}.`);

  return {
    mode: "remote_apply",
    status: "APPLIED",
    code: "CENTRE_COMMERCIAL_ACCESS_ACTIVATED",
    remoteWriteExecuted: true,
    remoteWriteModel: "wrangler_d1_execute_file_transaction",
    auditId,
    preflight,
    verification: {
      branchStatus: verification.branch_status,
      centreStatus: verification.centre_status,
      commercialState: verification.commercial_state,
      auditRowsCreated: Number(verification.audit_rows),
    },
  };
}

export function buildRemoteCentreCommercialActivationSql(input: {
  auditId: string;
  now: string;
  organisationId: string;
  expectedOrganisationName: string;
  centreId: string;
  expectedCentreCode: string;
  expectedCentreName: string;
  commercialAccessId: string;
  paymentEvidenceSource: CentrePaymentEvidenceSource | "";
  paymentReference: string;
  reason: string;
}) {
  const metadata = JSON.stringify({
    source: "maintenance_cli",
    previousCommercialState: "pending_payment",
    newCommercialState: "active",
    paymentEvidenceSource: input.paymentEvidenceSource,
    paymentEvidenceReference: input.paymentReference,
    reason: input.reason.trim(),
  });
  return [
    `UPDATE centre_commercial_access
SET state = 'active',
    source = 'maintenance_activation',
    payment_evidence_source = ${q(input.paymentEvidenceSource)},
    payment_evidence_reference = ${q(input.paymentReference)},
    activated_at = ${q(input.now)},
    updated_at = ${q(input.now)}
WHERE id = ${q(input.commercialAccessId)}
  AND organisation_id = ${q(input.organisationId)}
  AND branch_id = ${q(input.centreId)}
  AND state = 'pending_payment'
  AND payment_evidence_source IS NULL
  AND payment_evidence_reference IS NULL
  AND activated_at IS NULL
  AND EXISTS (
    SELECT 1 FROM organisations
    JOIN branches ON branches.organisation_id = organisations.id
    WHERE organisations.id = ${q(input.organisationId)}
      AND organisations.name = ${q(input.expectedOrganisationName)}
      AND organisations.status = 'active'
      AND branches.id = ${q(input.centreId)}
      AND branches.code = ${q(input.expectedCentreCode)}
      AND branches.name = ${q(input.expectedCentreName)}
      AND branches.status = 'inactive'
      AND branches.centre_status = 'pending_subscription'
  );`,
    `UPDATE branches
SET status = 'active',
    centre_status = 'active',
    updated_at = ${q(input.now)}
WHERE id = ${q(input.centreId)}
  AND organisation_id = ${q(input.organisationId)}
  AND code = ${q(input.expectedCentreCode)}
  AND name = ${q(input.expectedCentreName)}
  AND status = 'inactive'
  AND centre_status = 'pending_subscription'
  AND EXISTS (
    SELECT 1 FROM centre_commercial_access
    WHERE centre_commercial_access.id = ${q(input.commercialAccessId)}
      AND centre_commercial_access.branch_id = branches.id
      AND centre_commercial_access.organisation_id = branches.organisation_id
      AND centre_commercial_access.state = 'active'
      AND centre_commercial_access.payment_evidence_source = ${q(input.paymentEvidenceSource)}
      AND centre_commercial_access.payment_evidence_reference = ${q(input.paymentReference)}
  );`,
    `INSERT INTO audit_logs
  (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, old_values_json, new_values_json, metadata_json, created_at)
SELECT ${q(input.auditId)}, ${q(input.organisationId)}, ${q(input.centreId)}, NULL, NULL,
       'centre_commercial_access_activated', 'centre_commercial_access', ${q(input.commercialAccessId)},
       ${q(JSON.stringify({ state: "pending_payment" }))},
       ${q(JSON.stringify({ state: "active" }))},
       ${q(metadata)},
       ${q(input.now)}
WHERE EXISTS (
  SELECT 1 FROM branches
  JOIN centre_commercial_access ON centre_commercial_access.branch_id = branches.id
  WHERE branches.id = ${q(input.centreId)}
    AND branches.organisation_id = ${q(input.organisationId)}
    AND branches.status = 'active'
    AND branches.centre_status = 'active'
    AND centre_commercial_access.id = ${q(input.commercialAccessId)}
    AND centre_commercial_access.state = 'active'
);`,
    `INSERT INTO centre_commercial_access
  (id, organisation_id, branch_id, state, source, created_at, updated_at)
SELECT ${q(input.commercialAccessId)}, ${q(input.organisationId)}, ${q(input.centreId)}, 'pending_payment', 'centre_created', ${q(input.now)}, ${q(input.now)}
FROM centre_commercial_access existing_guard
WHERE existing_guard.id = ${q(input.commercialAccessId)}
  AND NOT EXISTS (
  SELECT 1 FROM branches
  JOIN centre_commercial_access ON centre_commercial_access.branch_id = branches.id
  JOIN audit_logs ON audit_logs.id = ${q(input.auditId)}
  WHERE branches.id = ${q(input.centreId)}
    AND branches.organisation_id = ${q(input.organisationId)}
    AND branches.status = 'active'
    AND branches.centre_status = 'active'
    AND centre_commercial_access.id = ${q(input.commercialAccessId)}
    AND centre_commercial_access.state = 'active'
    AND audit_logs.action = 'centre_commercial_access_activated'
);`,
    "",
  ].join("\n");
}

export class WranglerRemoteCentreCommercialWriteClient extends WranglerRemoteD1Client implements RemoteD1WriteClient {
  executeSqlFile(sql: string) {
    const dir = mkdtempSync(join(tmpdir(), "samyak-centre-commercial-"));
    const file = join(dir, "centre-commercial-activation.sql");
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

export function createRemoteCentreCommercialMaintenanceClient(databaseName = PRODUCTION_CENTRE_COMMERCIAL_DATABASE) {
  return new WranglerRemoteCentreCommercialWriteClient(databaseName);
}

export async function runRemoteCentreCommercialMaintenance(input: CentreCommercialMaintenanceArgs) {
  validateCentreCommercialMaintenanceRequest(input);
  const client = input.apply
    ? createRemoteCentreCommercialMaintenanceClient(input.databaseName)
    : new WranglerRemoteD1Client(input.databaseName);
  if (input.preflight) return buildRemotePreflightCentreCommercialActivation(client, input);
  return applyRemoteCentreCommercialActivation(client as RemoteD1WriteClient, input);
}

async function loadCentreCommercialTarget(
  execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>,
  organisationId: string,
  centreId: string,
): Promise<CentreCommercialTarget | null> {
  const rows = await execute<{
    organisation_id: string;
    organisation_name: string;
    organisation_status: string;
    centre_id: string;
    centre_code: string;
    centre_name: string;
    branch_status: string;
    centre_status: string;
    commercial_access_id: string | null;
    commercial_state: string | null;
    payment_evidence_source: string | null;
    payment_evidence_reference: string | null;
    activated_at: string | null;
  }>(
    `select organisations.id as organisation_id,
            organisations.name as organisation_name,
            organisations.status as organisation_status,
            branches.id as centre_id,
            branches.code as centre_code,
            branches.name as centre_name,
            branches.status as branch_status,
            branches.centre_status,
            centre_commercial_access.id as commercial_access_id,
            centre_commercial_access.state as commercial_state,
            centre_commercial_access.payment_evidence_source,
            centre_commercial_access.payment_evidence_reference,
            centre_commercial_access.activated_at
     from organisations
     join branches on branches.organisation_id = organisations.id
     left join centre_commercial_access on centre_commercial_access.branch_id = branches.id
       and centre_commercial_access.organisation_id = organisations.id
     where organisations.id = ${q(organisationId)}
       and branches.id = ${q(centreId)}
     limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    organisationStatus: row.organisation_status,
    centreId: row.centre_id,
    centreCode: row.centre_code,
    centreName: row.centre_name,
    branchStatus: row.branch_status,
    centreStatus: row.centre_status,
    commercialAccessId: row.commercial_access_id,
    commercialState: row.commercial_state,
    paymentEvidenceSource: row.payment_evidence_source,
    paymentEvidenceReference: row.payment_evidence_reference,
    activatedAt: row.activated_at,
  };
}

function isPaymentEvidenceSource(value: string): value is CentrePaymentEvidenceSource {
  return (CENTRE_PAYMENT_EVIDENCE_SOURCES as readonly string[]).includes(value);
}

function validateSafeText(label: string, value: string, maxLength: number) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Missing --${label}.`);
  if (trimmed.length > maxLength) throw new Error(`--${label} must be ${maxLength} characters or fewer.`);
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) throw new Error(`--${label} contains unsupported control characters.`);
}

function q(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
