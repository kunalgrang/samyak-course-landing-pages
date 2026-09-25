/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildOrganisationDemoAuditValues } from "./organisation-safety";
import {
  applyRemoteDemoOrganisationClassification,
  buildRemoteDemoOrganisationApplySql,
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

  it("loads the real CLI module graph under the package script Node execution model", () => {
    let stderr = "";
    try {
      execFileSync(process.execPath, [
        "--experimental-strip-types",
        "--experimental-specifier-resolution=node",
        join(process.cwd(), "worker", "lib", "organisation-demo-maintenance-cli.ts"),
        "--preflight",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : String(error);
    }

    expect(stderr).toContain("Demo Organisation maintenance requires --remote.");
    expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("generates a guarded D1 batch without explicit transaction-control statements", () => {
    const audit = buildOrganisationDemoAuditValues({ source: "maintenance", reason: "approved controlled demo" });
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;

    const sql = buildRemoteDemoOrganisationApplySql({
      auditId: "audit_demo",
      now: NOW,
      organisationId: "org_demo",
      expectedName: "Demo Training Institute",
      auditValues: audit.values,
    });

    expect(sql).not.toMatch(/\bBEGIN\s+TRANSACTION\b/i);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
    expect(sql).not.toMatch(/\bSAVEPOINT\b/i);

    const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^UPDATE organisations SET organisation_kind = 'demo'/);
    expect(statements[0]).toContain("AND name = 'Demo Training Institute'");
    expect(statements[0]).toContain("AND status = 'active'");
    expect(statements[0]).toContain("AND organisation_kind = 'normal'");
    expect(statements[1]).toMatch(/^INSERT INTO audit_logs/);
    expect(statements[1]).toContain("WHERE id = 'org_demo'");
    expect(statements[1]).toContain("AND organisation_kind = 'demo'");
    expect(statements[1]).toContain("AND changes() = 1");
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

  it("blocks preflight when the controlled Organisation is missing or has the wrong expected name", async () => {
    const fixture = createFixture();
    try {
      await expect(buildRemotePreflightDemoOrganisation(fixture.client, {
        organisationId: "org_missing",
        expectedName: "Demo Training Institute",
      })).resolves.toMatchObject({
        status: "BLOCKED",
        code: "ORGANISATION_NOT_FOUND",
        writeOperationsPerformed: false,
      });

      await expect(buildRemotePreflightDemoOrganisation(fixture.client, {
        organisationId: "org_demo",
        expectedName: "Wrong Name",
      })).resolves.toMatchObject({
        status: "BLOCKED",
        code: "EXPECTED_NAME_MISMATCH",
        writeOperationsPerformed: false,
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
        remoteWriteModel: "d1_execute_file_guarded_batch",
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
        remoteWriteModel: "d1_execute_file_guarded_batch",
        verification: {
          organisationKind: "demo",
          auditRowsCreated: 1,
          demoOrganisationCountBefore: 0,
          demoOrganisationCountAfter: 1,
        },
      });
      expect(row(fixture.db, "select organisation_kind from organisations where id = 'org_demo'")).toEqual({ organisation_kind: "demo" });
      expect(row(fixture.db, "select organisation_kind from organisations where id = 'org_other'")).toEqual({ organisation_kind: "normal" });

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

  it("does not create a false audit row when the target changes after preflight", async () => {
    const fixture = createFixture({
      beforeExecuteSqlFile: (db) => {
        db.prepare("update organisations set name = 'Renamed Demo Institute' where id = 'org_demo'").run();
      },
    });
    try {
      await expect(applyRemoteDemoOrganisationClassification(fixture.client, {
        organisationId: "org_demo",
        expectedName: "Demo Training Institute",
        reason: "approved controlled demo",
      })).rejects.toThrow("kind=normal");

      expect(row(fixture.db, "select name, organisation_kind from organisations where id = 'org_demo'")).toEqual({
        name: "Renamed Demo Institute",
        organisation_kind: "normal",
      });
      expect(count(fixture.db, "audit_logs")).toBe(0);
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

  it("proves local Wrangler D1 batch execution rolls back all statements when one statement fails", () => {
    const persistTo = mkdtempSync(join(tmpdir(), "samyak-d1-batch-"));
    const failingSql = join(persistTo, "failing-batch.sql");
    const passingSql = join(persistTo, "passing-batch.sql");
    try {
      runLocalWranglerD1([
        "--command",
        [
          "CREATE TABLE IF NOT EXISTS demo_batch_atomicity (id TEXT PRIMARY KEY, value TEXT NOT NULL);",
          "DELETE FROM demo_batch_atomicity;",
          "INSERT INTO demo_batch_atomicity (id, value) VALUES ('target', 'normal');",
        ].join("\n"),
      ], persistTo);

      writeFileSync(failingSql, [
        "UPDATE demo_batch_atomicity SET value = 'demo' WHERE id = 'target';",
        "INSERT INTO demo_batch_atomicity (id, value) VALUES ('target', 'duplicate');",
      ].join("\n"), "utf8");

      expect(() => runLocalWranglerD1(["--file", failingSql], persistTo)).toThrow(/UNIQUE|constraint|D1_ERROR/i);
      expect(queryLocalWranglerD1<{ value: string }>("SELECT value FROM demo_batch_atomicity WHERE id = 'target';", persistTo)[0]).toEqual({ value: "normal" });

      writeFileSync(passingSql, [
        "UPDATE demo_batch_atomicity SET value = 'demo' WHERE id = 'target';",
        "INSERT INTO demo_batch_atomicity (id, value) VALUES ('audit', 'created');",
      ].join("\n"), "utf8");

      runLocalWranglerD1(["--file", passingSql], persistTo);
      expect(queryLocalWranglerD1<{ value: string }>("SELECT value FROM demo_batch_atomicity WHERE id = 'target';", persistTo)[0]).toEqual({ value: "demo" });
      expect(queryLocalWranglerD1<{ count: number }>("SELECT count(*) AS count FROM demo_batch_atomicity;", persistTo)[0]).toEqual({ count: 2 });
    } finally {
      if (existsSync(persistTo)) rmSync(persistTo, { recursive: true, force: true });
    }
  }, 60_000);
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

function createFixture(options: { beforeExecuteSqlFile?: (db: DatabaseSync) => void } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table organisations (id text primary key, name text not null, slug text, status text not null, organisation_kind text default 'normal', created_at text, updated_at text);
    create table branches (id text primary key, organisation_id text not null, name text, code text, timezone text, status text, created_at text, updated_at text);
    create table organisation_memberships (id text primary key, organisation_id text not null, status text, created_at text, updated_at text);
    create table organisation_commercial_access (id text primary key, organisation_id text not null, state text, created_at text, updated_at text);
    create table audit_logs (id text primary key, organisation_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, old_values_json text, new_values_json text, metadata_json text, created_at text);
  `);
  db.prepare("insert into organisations (id, name, slug, status, organisation_kind, created_at, updated_at) values ('org_demo', 'Demo Training Institute', 'demo-training-institute', 'active', 'normal', ?, ?)").run(NOW, NOW);
  db.prepare("insert into organisations (id, name, slug, status, organisation_kind, created_at, updated_at) values ('org_other', 'Other Institute', 'other-institute', 'active', 'normal', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_demo_1', 'org_demo', 'Demo Main', 'DEMO', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_demo_2', 'org_demo', 'Demo Annex', 'DEMO2', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into organisation_memberships (id, organisation_id, status, created_at, updated_at) values ('membership_demo_owner', 'org_demo', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into organisation_commercial_access (id, organisation_id, state, created_at, updated_at) values ('commercial_demo', 'org_demo', 'trial', ?, ?)").run(NOW, NOW);
  return {
    db,
    client: new SqliteRemoteD1WriteClient(db, options.beforeExecuteSqlFile),
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
    this.db.exec(sql);
  }
}

function runLocalWranglerD1(args: string[], persistTo: string) {
  try {
    return execFileSync(process.execPath, [
      join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js"),
      "d1",
      "execute",
      PRODUCTION_DEMO_DATABASE,
      "--local",
      "--json",
      "--persist-to",
      persistTo,
      ...args,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(persistTo, "wrangler-logs"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error && typeof error === "object") {
      const stderr = "stderr" in error ? String(error.stderr) : "";
      const stdout = "stdout" in error ? String(error.stdout) : "";
      throw new Error([stderr, stdout].filter(Boolean).join("\n") || String(error));
    }
    throw error;
  }
}

function queryLocalWranglerD1<T extends Record<string, unknown>>(sql: string, persistTo: string) {
  const output = runLocalWranglerD1(["--command", sql], persistTo);
  const parsed = JSON.parse(output) as Array<{ results: T[] }>;
  return parsed[0]?.results || [];
}
