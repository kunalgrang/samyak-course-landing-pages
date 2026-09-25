/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOrganisationSafetyProfile,
  isPlatformAuthenticationOtpAllowed,
  markOrganisationDemoForControlledSetup,
  parseOrganisationKind,
  shouldExcludeFromBusinessMetrics,
  tenantOperationalMessagingPolicy,
} from "./organisation-safety";

const NOW = "2026-09-24T12:00:00.000Z";

describe("organisation demo safety controls", () => {
  it("defaults existing and newly inserted Organisations to normal through the migration", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("pragma foreign_keys = on");
      applyMigrationsThrough(db, "0034_organisation_signup_trial_onboarding.sql");
      db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_existing', 'Existing', 'existing', 'active', ?, ?)").run(NOW, NOW);

      applyMigrationFile(db, "0035_demo_organisation_safety_controls.sql");

      expect(row(db, "select organisation_kind from organisations where id = 'org_existing'")).toEqual({ organisation_kind: "normal" });
      db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_new', 'New', 'new', 'active', ?, ?)").run(NOW, NOW);
      expect(rows(db, "select id, organisation_kind from organisations order by id")).toEqual([
        { id: "org_existing", organisation_kind: "normal" },
        { id: "org_new", organisation_kind: "normal" },
      ]);
      expect(() =>
        db.prepare("insert into organisations (id, name, slug, status, organisation_kind, created_at, updated_at) values ('org_invalid', 'Invalid', 'invalid', 'active', 'sandbox', ?, ?)")
          .run(NOW, NOW),
      ).toThrow();
      expect(indexNames(db)).toContain("organisations_kind_idx");
    } finally {
      db.close();
    }
  });

  it("loads safety profiles and keeps parser fallback defensive for unknown values", async () => {
    const fixture = createFixture();
    try {
      await markOrganisationDemoForControlledSetup(fixture.context, {
        organisationId: "org_demo",
        source: "maintenance",
        reason: "internal sales demo setup",
        now: NOW,
      });
      await expect(getOrganisationSafetyProfile(fixture.context, "org_normal")).resolves.toMatchObject({
        organisationKind: "normal",
        isDemo: false,
        excludeFromBusinessMetrics: false,
        billableCustomer: true,
      });
      await expect(getOrganisationSafetyProfile(fixture.context, "org_demo")).resolves.toMatchObject({
        organisationKind: "demo",
        isDemo: true,
        excludeFromBusinessMetrics: true,
        billableCustomer: false,
      });
      expect(parseOrganisationKind("unexpected")).toBe("normal");
    } finally {
      fixture.close();
    }
  }, 10_000);

  it("marks a normal Organisation as demo only through the controlled helper and writes an audit row", async () => {
    const fixture = createFixture();
    try {
      const marked = await markOrganisationDemoForControlledSetup(fixture.context, {
        organisationId: "org_normal",
        source: "platform_admin",
        reason: "approved internal demo tenant",
        now: NOW,
      });
      expect(marked).toEqual({ ok: true, organisationId: "org_normal", organisationKind: "demo", changed: true });
      expect(row(fixture.sqlite, "select organisation_kind from organisations where id = 'org_normal'")).toEqual({ organisation_kind: "demo" });
      expect(row(fixture.sqlite, "select action, old_values_json, new_values_json, metadata_json from audit_logs where organisation_id = 'org_normal'")).toMatchObject({
        action: "organisation_marked_demo",
        old_values_json: JSON.stringify({ organisationKind: "normal" }),
        new_values_json: JSON.stringify({ organisationKind: "demo" }),
        metadata_json: JSON.stringify({ source: "platform_admin", reason: "approved internal demo tenant" }),
      });

      await expect(markOrganisationDemoForControlledSetup(fixture.context, {
        organisationId: "org_normal",
        source: "maintenance",
        reason: "repeat",
        now: NOW,
      })).resolves.toEqual({ ok: true, organisationId: "org_normal", organisationKind: "demo", changed: false });
      expect(count(fixture.sqlite, "audit_logs where organisation_id = 'org_normal' and action = 'organisation_marked_demo'")).toBe(1);
    } finally {
      fixture.close();
    }
  }, 10_000);

  it("keeps platform OTP allowed while blocking tenant operational messaging for demo Organisations", () => {
    expect(isPlatformAuthenticationOtpAllowed("demo")).toBe(true);
    expect(isPlatformAuthenticationOtpAllowed("normal")).toBe(true);
    expect(tenantOperationalMessagingPolicy("normal", "sms")).toEqual({ allowed: true, mode: "live" });
    expect(tenantOperationalMessagingPolicy("demo", "sms")).toEqual({
      allowed: false,
      mode: "blocked",
      reason: "demo_organisation_operational_messaging_blocked",
    });
    expect(tenantOperationalMessagingPolicy("demo", "whatsapp").allowed).toBe(false);
    expect(tenantOperationalMessagingPolicy("demo", "email").allowed).toBe(false);
  }, 10_000);

  it("exposes one classification for future billing and business KPI exclusion", () => {
    expect(shouldExcludeFromBusinessMetrics("normal")).toBe(false);
    expect(shouldExcludeFromBusinessMetrics("demo")).toBe(true);
    expect(parseOrganisationKind("demo")).toBe("demo");
    expect(parseOrganisationKind("normal")).toBe("normal");
    expect(parseOrganisationKind("anything_else")).toBe("normal");
  }, 10_000);
});

function createFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("pragma foreign_keys = on");
  applyAllMigrations(sqlite);
  sqlite.exec(`
    insert into organisations (id, name, slug, status, created_at, updated_at)
      values ('org_normal', 'Normal Institute', 'normal-institute', 'active', '${NOW}', '${NOW}');
    insert into organisations (id, name, slug, status, organisation_kind, created_at, updated_at)
      values ('org_demo', 'Demo Institute', 'demo-institute', 'active', 'normal', '${NOW}', '${NOW}');
    insert into organisations (id, name, slug, status, organisation_kind, created_at, updated_at)
      values ('org_legacy', 'Legacy Institute', 'legacy-institute', 'active', 'normal', '${NOW}', '${NOW}');
  `);
  return {
    sqlite,
    context: { env: { DB: new SqliteD1(sqlite) as unknown as D1Database } },
    close: () => sqlite.close(),
  };
}

function applyAllMigrations(db: DatabaseSync) {
  for (const file of migrationFiles()) applyMigrationFile(db, file);
}

function applyMigrationsThrough(db: DatabaseSync, throughFile: string) {
  for (const file of migrationFiles()) {
    if (file > throughFile) break;
    applyMigrationFile(db, file);
  }
}

function migrationFiles() {
  return readdirSync(join(process.cwd(), "migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
}

function applyMigrationFile(db: DatabaseSync, file: string) {
  const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
}

function row(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).get(...values) as Record<string, unknown> | undefined;
}

function rows(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).all(...values) as Record<string, unknown>[];
}

function count(db: DatabaseSync, tableOrSql: string) {
  return Number(row(db, `select count(*) as count from ${tableOrSql}`)?.count || 0);
}

function indexNames(db: DatabaseSync) {
  return rows(db, "select name from sqlite_master where type = 'index'").map((item) => String(item.name));
}

class SqliteD1 {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql, []);
  }

  async batch(statements: SqliteD1Statement[]) {
    const results = [];
    this.db.exec("begin");
    try {
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return results;
  }
}

class SqliteD1Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly params: SQLInputValue[]) {}

  bind(...params: SQLInputValue[]) {
    return new SqliteD1Statement(this.db, this.sql, params);
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) ?? null) as T | null;
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), rows_written: Number(result.changes) } };
  }
}

afterEach(() => {
  vi.useRealTimers();
});
