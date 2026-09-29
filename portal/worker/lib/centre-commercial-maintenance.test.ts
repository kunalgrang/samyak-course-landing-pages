import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  applyRemoteCentreCommercialActivation,
  buildRemoteCentreCommercialActivationSql,
  buildRemotePreflightCentreCommercialActivation,
  validateCentreCommercialMaintenanceRequest,
  type CentreCommercialMaintenanceArgs,
  type CentreCommercialTarget,
  type RemoteD1WriteClient,
} from "./centre-commercial-maintenance";
import type { RemoteD1QueryResult } from "./legacy-import-remote-preflight";

vi.mock("./crypto.ts", () => ({
  createOpaqueId: (prefix: string) => `${prefix}_test`,
}));

const baseArgs: CentreCommercialMaintenanceArgs = {
  remote: true,
  preflight: true,
  apply: false,
  confirmApply: false,
  confirmCentreCommercial: false,
  organisationId: "org_samyak",
  expectedOrganisationName: "Samyak",
  centreId: "branch_pending",
  expectedCentreCode: "CTR-002",
  expectedCentreName: "Pending Centre",
  paymentEvidenceSource: "external_manual_verification",
  paymentReference: "bank-utr-123",
  reason: "Owner verified bank receipt.",
  databaseName: "samyak-student-portal",
};

describe("centre commercial maintenance", () => {
  it("validates remote-only preflight and double-confirmed apply requests", () => {
    expect(() => validateCentreCommercialMaintenanceRequest(baseArgs)).not.toThrow();
    expect(() => validateCentreCommercialMaintenanceRequest({ ...baseArgs, remote: false })).toThrow(/requires --remote/);
    expect(() => validateCentreCommercialMaintenanceRequest({ ...baseArgs, preflight: true, apply: true })).toThrow(/exactly one/);
    expect(() => validateCentreCommercialMaintenanceRequest({ ...baseArgs, databaseName: "other-db" })).toThrow(/locked to D1 database/);
    expect(() => validateCentreCommercialMaintenanceRequest({ ...baseArgs, paymentEvidenceSource: "" })).toThrow(/payment-evidence-source/);
    expect(() => validateCentreCommercialMaintenanceRequest({ ...baseArgs, paymentReference: "  " })).toThrow(/payment-reference/);
    expect(() => validateCentreCommercialMaintenanceRequest({ ...baseArgs, paymentReference: "x".repeat(181) })).toThrow(/180 characters/);
    expect(() => validateCentreCommercialMaintenanceRequest({ ...baseArgs, reason: "bad\u0001reason" })).toThrow(/control characters/);
    expect(() => validateCentreCommercialMaintenanceRequest({ ...baseArgs, preflight: false, apply: true })).toThrow(/confirm-apply/);
    expect(() => validateCentreCommercialMaintenanceRequest({ ...baseArgs, preflight: false, apply: true, confirmApply: true, confirmCentreCommercial: true })).not.toThrow();
  });

  it("validates activation identity, evidence, and reason at the direct domain boundary before remote work", async () => {
    await expect(buildRemotePreflightCentreCommercialActivation(new FakeCentreClient(pendingTarget()), { ...baseArgs, expectedOrganisationName: "Wrong Name" })).resolves.toMatchObject({ status: "BLOCKED", code: "EXPECTED_ORGANISATION_NAME_MISMATCH" });
    await expect(buildRemotePreflightCentreCommercialActivation(new FakeCentreClient(pendingTarget()), { ...baseArgs, expectedCentreCode: "WRONG" })).resolves.toMatchObject({ status: "BLOCKED", code: "EXPECTED_CENTRE_CODE_MISMATCH" });
    await expect(buildRemotePreflightCentreCommercialActivation(new FakeCentreClient(pendingTarget()), { ...baseArgs, expectedCentreName: "Wrong Centre" })).resolves.toMatchObject({ status: "BLOCKED", code: "EXPECTED_CENTRE_NAME_MISMATCH" });

    for (const invalid of [
      { reason: "" },
      { paymentEvidenceSource: "" },
      { paymentReference: "" },
      { paymentReference: "x".repeat(181) },
    ] as Array<Partial<CentreCommercialMaintenanceArgs>>) {
      const preflightClient = new FakeCentreClient(pendingTarget());
      await expect(buildRemotePreflightCentreCommercialActivation(preflightClient, { ...baseArgs, ...invalid })).rejects.toThrow();
      expect(preflightClient.metas).toHaveLength(0);
      expect(preflightClient.writes).toHaveLength(0);

      const applyClient = new FakeCentreClient(pendingTarget());
      await expect(applyRemoteCentreCommercialActivation(applyClient, { ...baseArgs, ...invalid })).rejects.toThrow();
      expect(applyClient.metas).toHaveLength(0);
      expect(applyClient.writes).toHaveLength(0);
    }
  });

  it("reports ready preflight without write metadata", async () => {
    const client = new FakeCentreClient(pendingTarget());

    const report = await buildRemotePreflightCentreCommercialActivation(client, baseArgs);

    expect(report).toMatchObject({
      status: "READY",
      code: "READY_FOR_ACTIVATION",
      writeOperationsPerformed: false,
      zeroWriteProof: { queries: 1, changedDbFalse: true, rowsWritten: 0 },
      target: {
        centreId: "branch_pending",
        branchStatus: "inactive",
        centreStatus: "pending_subscription",
        commercialState: "pending_payment",
      },
    });
  });

  it("blocks preflight when an active Centre already has different payment evidence", async () => {
    const client = new FakeCentreClient({
      ...pendingTarget(),
      branchStatus: "active",
      centreStatus: "active",
      commercialState: "active",
      paymentEvidenceSource: "payment_provider",
      paymentEvidenceReference: "provider-ref-1",
      activatedAt: "2026-09-29T10:00:00.000Z",
    });

    const report = await buildRemotePreflightCentreCommercialActivation(client, baseArgs);

    expect(report.status).toBe("BLOCKED");
    expect(report.code).toBe("ACTIVE_EVIDENCE_CONFLICT");
    expect(client.writes).toHaveLength(0);
  });

  it("applies guarded activation and verifies branch, commercial state, and audit row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T10:30:00.000Z"));
    const client = new FakeCentreClient(pendingTarget());

    const report = await applyRemoteCentreCommercialActivation(client, baseArgs);

    expect(report).toMatchObject({
      status: "APPLIED",
      code: "CENTRE_COMMERCIAL_ACCESS_ACTIVATED",
      remoteWriteExecuted: true,
      remoteWriteModel: "wrangler_d1_execute_file_transaction",
      auditId: "audit_test",
      verification: {
        branchStatus: "active",
        centreStatus: "active",
        commercialState: "active",
        auditRowsCreated: 1,
      },
    });
    expect(client.target).toMatchObject({
      branchStatus: "active",
      centreStatus: "active",
      commercialState: "active",
      paymentEvidenceSource: "external_manual_verification",
      paymentEvidenceReference: "bank-utr-123",
      activatedAt: "2026-09-29T10:30:00.000Z",
    });
    expect(client.writes).toHaveLength(1);
    expect(client.writes[0]).toContain("centre_commercial_access_activated");
    expect(client.writes[0]).toContain("maintenance_activation");
    expect(client.writes[0]).toContain("Owner verified bank receipt.");
    vi.useRealTimers();
  });

  it("treats already-active matching evidence as idempotent without remote writes", async () => {
    const client = new FakeCentreClient({
      ...pendingTarget(),
      branchStatus: "active",
      centreStatus: "active",
      commercialState: "active",
      paymentEvidenceSource: "external_manual_verification",
      paymentEvidenceReference: "bank-utr-123",
      activatedAt: "2026-09-29T10:00:00.000Z",
    });

    const report = await applyRemoteCentreCommercialActivation(client, baseArgs);

    expect(report.status).toBe("ALREADY_ACTIVE");
    expect(report.remoteWriteExecuted).toBe(false);
    expect(client.writes).toHaveLength(0);
  });

  it("rolls back all activation writes when a late guard fails inside the D1 execute-file transaction", async () => {
    const { db, client, close } = setupTransactionalDb({
      beforeExecuteSqlFile: (database) => {
        database.prepare("update organisations set name = 'Changed Name' where id = 'org_samyak'").run();
      },
    });
    try {
      await expect(applyRemoteCentreCommercialActivation(client, baseArgs)).rejects.toThrow();
      expect(snapshot(db)).toEqual(pendingSnapshot());
    } finally {
      close();
    }
  });

  it("rolls back entitlement and branch updates when the audit insert fails inside the D1 execute-file transaction", async () => {
    const { db, client, close } = setupTransactionalDb({
      beforeExecuteSqlFile: (database) => {
        database.exec(`
          create trigger fail_activation_audit
          before insert on audit_logs
          when NEW.action = 'centre_commercial_access_activated'
          begin
            select raise(abort, 'forced audit failure');
          end;
        `);
      },
    });
    try {
      await expect(applyRemoteCentreCommercialActivation(client, baseArgs)).rejects.toThrow(/forced audit failure/);
      expect(snapshot(db)).toEqual(pendingSnapshot());
    } finally {
      close();
    }
  });

  it("builds stale-state guarded SQL that fails when final activation invariants are missing", () => {
    const { db, close } = setupTransactionalDb();
    try {
      const sql = buildRemoteCentreCommercialActivationSql({
        auditId: "audit_test",
        now: "2026-09-29T10:30:00.000Z",
        organisationId: baseArgs.organisationId,
        expectedOrganisationName: baseArgs.expectedOrganisationName,
        centreId: baseArgs.centreId,
        expectedCentreCode: "STALE",
        expectedCentreName: baseArgs.expectedCentreName,
        commercialAccessId: "cca_pending",
        paymentEvidenceSource: baseArgs.paymentEvidenceSource,
        paymentReference: baseArgs.paymentReference,
        reason: baseArgs.reason,
      });

      expect(() => execTransactional(db, sql)).toThrow();
      expect(snapshot(db)).toEqual(pendingSnapshot());
    } finally {
      close();
    }
  });
});

function pendingTarget(): CentreCommercialTarget {
  return {
    organisationId: "org_samyak",
    organisationName: "Samyak",
    organisationStatus: "active",
    centreId: "branch_pending",
    centreCode: "CTR-002",
    centreName: "Pending Centre",
    branchStatus: "inactive",
    centreStatus: "pending_subscription",
    commercialAccessId: "cca_pending",
    commercialState: "pending_payment",
    paymentEvidenceSource: null,
    paymentEvidenceReference: null,
    activatedAt: null,
  };
}

class FakeCentreClient implements RemoteD1WriteClient {
  readonly databaseName = "samyak-student-portal";
  readonly cwd = process.cwd();
  readonly metas: Array<{ changed_db?: boolean; changes?: number; rows_written?: number }> = [];
  readonly writes: string[] = [];
  auditRows = 0;

  constructor(public target: CentreCommercialTarget | null) {}

  async execute<T extends Record<string, unknown>>(sql: string) {
    const isVerification = sql.includes("audit_rows");
    const results = isVerification && this.target
      ? [{
          branch_status: this.target.branchStatus,
          centre_status: this.target.centreStatus,
          commercial_state: this.target.commercialState,
          audit_rows: this.auditRows,
        }]
      : this.target
        ? [targetRow(this.target)]
        : [];
    const meta = { changed_db: false, changes: 0, rows_written: 0 };
    this.metas.push(meta);
    return { results: results as unknown as T[], meta };
  }

  executeSqlFile(sql: string) {
    this.writes.push(sql);
    if (!this.target) return;
    this.target = {
      ...this.target,
      branchStatus: "active",
      centreStatus: "active",
      commercialState: "active",
      paymentEvidenceSource: "external_manual_verification",
      paymentEvidenceReference: "bank-utr-123",
      activatedAt: "2026-09-29T10:30:00.000Z",
    };
    this.auditRows = 1;
  }
}

class SqliteTransactionalCentreClient implements RemoteD1WriteClient {
  readonly databaseName = "samyak-student-portal";
  readonly cwd = process.cwd();
  readonly metas: Array<{ changed_db?: boolean; changes?: number; rows_written?: number }> = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly beforeExecuteSqlFile?: (db: DatabaseSync) => void,
  ) {}

  async execute<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<RemoteD1QueryResult<T>> {
    const results = this.db.prepare(sql).all() as T[];
    const meta = { changed_db: false, changes: 0, rows_written: 0 };
    this.metas.push(meta);
    return { results, meta };
  }

  executeSqlFile(sql: string) {
    this.beforeExecuteSqlFile?.(this.db);
    execTransactional(this.db, sql);
  }
}

function setupTransactionalDb(options: { beforeExecuteSqlFile?: (db: DatabaseSync) => void } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table organisations (id text primary key not null, name text not null, status text not null);
    create table branches (id text primary key not null, organisation_id text not null, name text not null, code text not null, status text not null, centre_status text not null, updated_at text not null);
    create table centre_commercial_access (
      id text primary key not null,
      organisation_id text not null,
      branch_id text not null unique,
      state text not null,
      source text not null,
      payment_evidence_source text,
      payment_evidence_reference text,
      activated_at text,
      created_at text not null,
      updated_at text not null
    );
    create table audit_logs (
      id text primary key not null,
      organisation_id text,
      branch_id text,
      actor_login_account_id text,
      actor_person_id text,
      action text not null,
      entity_type text not null,
      entity_id text,
      old_values_json text,
      new_values_json text,
      metadata_json text,
      created_at text not null
    );
  `);
  db.prepare("insert into organisations values ('org_samyak', 'Samyak', 'active')").run();
  db.prepare("insert into branches values ('branch_pending', 'org_samyak', 'Pending Centre', 'CTR-002', 'inactive', 'pending_subscription', ?)").run("2026-09-29T09:00:00.000Z");
  db.prepare("insert into centre_commercial_access values ('cca_pending', 'org_samyak', 'branch_pending', 'pending_payment', 'centre_created', null, null, null, ?, ?)").run("2026-09-29T09:00:00.000Z", "2026-09-29T09:00:00.000Z");
  return {
    db,
    client: new SqliteTransactionalCentreClient(db, options.beforeExecuteSqlFile),
    close: () => db.close(),
  };
}

function execTransactional(db: DatabaseSync, sql: string) {
  db.exec("BEGIN TRANSACTION;");
  try {
    db.exec(sql);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function pendingSnapshot() {
  return {
    branchStatus: "inactive",
    centreStatus: "pending_subscription",
    commercialState: "pending_payment",
    paymentEvidenceSource: null,
    paymentEvidenceReference: null,
    activatedAt: null,
    auditRows: 0,
  };
}

function snapshot(db: DatabaseSync) {
  const row = db.prepare(
    `select branches.status as branchStatus,
            branches.centre_status as centreStatus,
            centre_commercial_access.state as commercialState,
            centre_commercial_access.payment_evidence_source as paymentEvidenceSource,
            centre_commercial_access.payment_evidence_reference as paymentEvidenceReference,
            centre_commercial_access.activated_at as activatedAt,
            (select count(*) from audit_logs where action = 'centre_commercial_access_activated') as auditRows
     from branches
     join centre_commercial_access on centre_commercial_access.branch_id = branches.id
     where branches.id = 'branch_pending'`,
  ).get() as Record<string, SQLInputValue>;
  return {
    branchStatus: row.branchStatus,
    centreStatus: row.centreStatus,
    commercialState: row.commercialState,
    paymentEvidenceSource: row.paymentEvidenceSource,
    paymentEvidenceReference: row.paymentEvidenceReference,
    activatedAt: row.activatedAt,
    auditRows: Number(row.auditRows),
  };
}

function targetRow(target: CentreCommercialTarget) {
  return {
    organisation_id: target.organisationId,
    organisation_name: target.organisationName,
    organisation_status: target.organisationStatus,
    centre_id: target.centreId,
    centre_code: target.centreCode,
    centre_name: target.centreName,
    branch_status: target.branchStatus,
    centre_status: target.centreStatus,
    commercial_access_id: target.commercialAccessId,
    commercial_state: target.commercialState,
    payment_evidence_source: target.paymentEvidenceSource,
    payment_evidence_reference: target.paymentEvidenceReference,
    activated_at: target.activatedAt,
  };
}
