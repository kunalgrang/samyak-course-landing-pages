/// <reference types="node" />
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildOrganisationDemoAuditValues } from "./organisation-safety";
import {
  applyRemoteDemoOrganisationClassification,
  buildRemotePreflightDemoOrganisation,
  PRODUCTION_DEMO_DATABASE,
  validateDemoMaintenanceRequest,
  type RemoteD1WriteClient,
} from "./organisation-demo-maintenance";
import { parseOrganisationDemoMaintenanceArgs } from "./organisation-demo-maintenance-cli";
import { type RemoteD1QueryResult } from "./legacy-import-remote-preflight";

const NOW = "2026-09-24T12:00:00.000Z";

describe("organisation demo maintenance command", () => {
  it("validates remote preflight/apply flags and locks the production D1 target", () => {
    expect(() => validateDemoMaintenanceRequest(baseArgs({ remote: false }))).toThrow("requires --remote");
    expect(() => validateDemoMaintenanceRequest(baseArgs({ preflight: true, apply: true }))).toThrow("exactly one");
    expect(() => validateDemoMaintenanceRequest(baseArgs({ databaseName: "other-db" }))).toThrow(PRODUCTION_DEMO_DATABASE);
    expect(() => validateDemoMaintenanceRequest(baseArgs({ preflight: false, apply: true, confirmApply: false }))).toThrow("--confirm-apply");
    expect(() => validateDemoMaintenanceRequest(baseArgs({ preflight: false, apply: true, confirmApply: true, confirmProductionDemo: true, reason: "" }))).toThrow("Missing --reason");

    expect(parseOrganisationDemoMaintenanceArgs([
      "--remote",
      "--preflight",
      "--organisation",
      "org_demo",
      "--expected-name",
      "Demo Training Institute",
    ])).toMatchObject({
      remote: true,
      preflight: true,
      apply: false,
      organisationId: "org_demo",
      expectedName: "Demo Training Institute",
      databaseName: PRODUCTION_DEMO_DATABASE,
    });
  });

  it("preflights a normal active Organisation with safe counts and zero-write proof", async () => {
    const fixture = createFixture();
    try {
      const report = await buildRemotePreflightDemoOrganisation(fixture.client, {
        organisationId: "org_demo",
        expectedName: "Demo Training Institute",
      });

      expect(report).toMatchObject({
        mode: "remote_preflight",
        status: "READY",
        code: "READY_FOR_DEMO_CLASSIFICATION",
        writeOperationsPerformed: false,
        target: {
          id: "org_demo",
          name: "Demo Training Institute",
          status: "active",
          organisationKind: "normal",
          centreCount: 2,
          membershipCount: 1,
          commercialAccessState: "trial",
          demoOrganisationCount: 0,
        },
        zeroWriteProof: { queries: 1, changedDbFalse: true, rowsWritten: 0 },
      });
      expect(row(fixture.db, "select organisation_kind from organisations where id = 'org_demo'")).toEqual({ organisation_kind: "normal" });
    } finally {
      fixture.close();
    }
  });

  it("reports already-demo Organisations without creating another audit row", async () => {
    const fixture = createFixture();
    try {
      fixture.db.prepare("update organisations set organisation_kind = 'demo' where id = 'org_demo'").run();
      const report = await applyRemoteDemoOrganisationClassification(fixture.client, {
        organisationId: "org_demo",
        expectedName: "Demo Training Institute",
        reason: "approved controlled demo",
      });

      expect(report).toMatchObject({
        status: "ALREADY_DEMO",
        code: "ALREADY_DEMO",
        remoteWriteExecuted: false,
        auditId: null,
      });
      expect(count(fixture.db, "audit_logs")).toBe(0);
    } finally {
      fixture.close();
    }
  });

  it("applies a guarded normal-to-demo transition and writes the shared audit semantics once", async () => {
    const fixture = createFixture();
    try {
      const report = await applyRemoteDemoOrganisationClassification(fixture.client, {
        organisationId: "org_demo",
        expectedName: "Demo Training Institute",
        reason: " approved controlled demo ",
      });

      expect(report).toMatchObject({
        status: "APPLIED",
        code: "DEMO_CLASSIFICATION_APPLIED",
        remoteWriteExecuted: true,
        remoteWriteModel: "d1_execute_file_guarded_transaction",
        verification: {
          organisationKind: "demo",
          auditRowsCreated: 1,
          demoOrganisationCountBefore: 0,
          demoOrganisationCountAfter: 1,
        },
      });
      expect(row(fixture.db, "select organisation_kind from organisations where id = 'org_demo'")).toEqual({ organisation_kind: "demo" });

      const expectedAudit = buildOrganisationDemoAuditValues({ source: "maintenance", reason: " approved controlled demo " });
      expect(expectedAudit.ok).toBe(true);
      expect(row(fixture.db, "select actor_login_account_id, actor_person_id, action, entity_type, entity_id, old_values_json, new_values_json, metadata_json from audit_logs")).toEqual({
        actor_login_account_id: null,
        actor_person_id: null,
        action: "organisation_marked_demo",
        entity_type: "organisation",
        entity_id: "org_demo",
        old_values_json: expectedAudit.ok ? expectedAudit.values.oldValuesJson : "",
        new_values_json: expectedAudit.ok ? expectedAudit.values.newValuesJson : "",
        metadata_json: expectedAudit.ok ? expectedAudit.values.metadataJson : "",
      });
    } finally {
      fixture.close();
    }
  });

  it("blocks apply when the Organisation name, status, or kind no longer matches the controlled target", async () => {
    const fixture = createFixture();
    try {
      await expect(applyRemoteDemoOrganisationClassification(fixture.client, {
        organisationId: "org_demo",
        expectedName: "Wrong Name",
        reason: "approved controlled demo",
      })).rejects.toThrow("EXPECTED_NAME_MISMATCH");

      fixture.db.prepare("update organisations set status = 'inactive' where id = 'org_demo'").run();
      await expect(applyRemoteDemoOrganisationClassification(fixture.client, {
        organisationId: "org_demo",
        expectedName: "Demo Training Institute",
        reason: "approved controlled demo",
      })).rejects.toThrow("ORGANISATION_NOT_ACTIVE");

      fixture.db.prepare("update organisations set status = 'active', organisation_kind = 'sandbox' where id = 'org_demo'").run();
      await expect(applyRemoteDemoOrganisationClassification(fixture.client, {
        organisationId: "org_demo",
        expectedName: "Demo Training Institute",
        reason: "approved controlled demo",
      })).rejects.toThrow("UNEXPECTED_ORGANISATION_KIND");
      expect(count(fixture.db, "audit_logs")).toBe(0);
    } finally {
      fixture.close();
    }
  });
});

function baseArgs(overrides: Partial<Parameters<typeof validateDemoMaintenanceRequest>[0]> = {}) {
  return {
    remote: true,
    preflight: true,
    apply: false,
    confirmApply: false,
    confirmProductionDemo: false,
    organisationId: "org_demo",
    expectedName: "Demo Training Institute",
    reason: "",
    databaseName: PRODUCTION_DEMO_DATABASE,
    ...overrides,
  };
}

function createFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table organisations (id text primary key, name text not null, slug text, status text not null, organisation_kind text default 'normal', created_at text, updated_at text);
    create table branches (id text primary key, organisation_id text not null, name text, code text, timezone text, status text, created_at text, updated_at text);
    create table organisation_memberships (id text primary key, organisation_id text not null, status text, created_at text, updated_at text);
    create table organisation_commercial_access (id text primary key, organisation_id text not null, state text, created_at text, updated_at text);
    create table audit_logs (id text primary key, organisation_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, old_values_json text, new_values_json text, metadata_json text, created_at text);
  `);
  db.prepare("insert into organisations (id, name, slug, status, organisation_kind, created_at, updated_at) values ('org_demo', 'Demo Training Institute', 'demo-training-institute', 'active', 'normal', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_demo_1', 'org_demo', 'Demo Main', 'DEMO', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_demo_2', 'org_demo', 'Demo Annex', 'DEMO2', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into organisation_memberships (id, organisation_id, status, created_at, updated_at) values ('membership_demo_owner', 'org_demo', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into organisation_commercial_access (id, organisation_id, state, created_at, updated_at) values ('commercial_demo', 'org_demo', 'trial', ?, ?)").run(NOW, NOW);
  return {
    db,
    client: new SqliteRemoteD1WriteClient(db),
    close: () => db.close(),
  };
}

function row(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).get(...values) as Record<string, unknown> | undefined;
}

function count(db: DatabaseSync, tableOrSql: string) {
  return Number(row(db, `select count(*) as count from ${tableOrSql}`)?.count || 0);
}

class SqliteRemoteD1WriteClient implements RemoteD1WriteClient {
  readonly databaseName = PRODUCTION_DEMO_DATABASE;
  readonly cwd = process.cwd();
  readonly metas: Array<{ changed_db?: boolean; changes?: number; rows_written?: number }> = [];

  constructor(private readonly db: DatabaseSync) {}

  async execute<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<RemoteD1QueryResult<T>> {
    const results = this.db.prepare(sql).all() as T[];
    const meta = { changed_db: false, changes: 0, rows_written: 0 };
    this.metas.push(meta);
    return { results, meta };
  }

  executeSqlFile(sql: string) {
    this.db.exec(sql);
  }
}
