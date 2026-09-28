/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  applyRemoteDemoData,
  assertNoForbiddenFinancialWrites,
  buildDemoCoreV1ApplySql,
  buildDemoCoreV1Dataset,
  buildRemotePreflightDemoData,
  DEMO_CORE_V1_SEED_VERSION,
  deterministicSeedRows,
  validateDemoDataMaintenanceRequest,
} from "./demo-data-maintenance";
import { parseDemoDataMaintenanceArgs } from "./demo-data-maintenance-cli";
import { type RemoteD1QueryResult } from "./legacy-import-remote-preflight";
import { PRODUCTION_DEMO_DATABASE, type RemoteD1WriteClient } from "./organisation-demo-maintenance";

const ORG_ID = "org_88ee748d08a14eb1b5201ca88edfa07e";
const ORG_NAME = "Demo Training Institute";
const CENTRE_ID = "branch_01477474b96d4a9eb3e6bade61c7c035";
const OWNER_ACCOUNT_ID = "acct_b2c2779f27eb48bd8ed2241bdc3b38c5";
const OWNER_PERSON_ID = "person_e76887f2bcb04cef9705d3d95a09f947";
const OWNER_MEMBERSHIP_ID = "omem_2afd8d508ba54e059f7685445f06617f";
const NOW = "2026-09-28T10:00:00.000Z";

describe("demo data maintenance", () => {
  it("validates the production-only safety contract and parses CLI flags", () => {
    expect(() => validateDemoDataMaintenanceRequest(baseArgs({ remote: false }))).toThrow("--remote");
    expect(() => validateDemoDataMaintenanceRequest(baseArgs({ preflight: true, apply: true }))).toThrow("exactly one");
    expect(() => validateDemoDataMaintenanceRequest(baseArgs({ databaseName: "other" }))).toThrow(PRODUCTION_DEMO_DATABASE);
    expect(() => validateDemoDataMaintenanceRequest(baseArgs({ organisationId: "org_samyak" }))).toThrow("controlled Demo");
    expect(() => validateDemoDataMaintenanceRequest(baseArgs({ seedVersion: "demo-core-v2" }))).toThrow(DEMO_CORE_V1_SEED_VERSION);
    expect(() => validateDemoDataMaintenanceRequest(baseArgs({ preflight: false, apply: true, confirmApply: true, confirmProductionDemoData: false }))).toThrow("--confirm-production-demo-data");
    expect(() => validateDemoDataMaintenanceRequest(baseArgs({ preflight: false, apply: true, confirmApply: true, confirmProductionDemoData: true, reason: "" }))).toThrow("Missing --reason");

    expect(parseDemoDataMaintenanceArgs([
      "--remote",
      "--preflight",
      "--organisation",
      ORG_ID,
      "--expected-name",
      ORG_NAME,
      "--expected-centre",
      CENTRE_ID,
      "--seed-version",
      DEMO_CORE_V1_SEED_VERSION,
    ])).toMatchObject({
      remote: true,
      preflight: true,
      apply: false,
      organisationId: ORG_ID,
      expectedName: ORG_NAME,
      expectedCentre: CENTRE_ID,
      seedVersion: DEMO_CORE_V1_SEED_VERSION,
      databaseName: PRODUCTION_DEMO_DATABASE,
    });
  });

  it("loads the real CLI module graph under the package script execution model", () => {
    let stderr = "";
    try {
      execFileSync(process.execPath, [
        "--experimental-strip-types",
        "--experimental-specifier-resolution=node",
        join(process.cwd(), "worker", "lib", "demo-data-maintenance-cli.ts"),
        "--preflight",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : String(error);
    }
    expect(stderr).toContain("requires --remote");
    expect(stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("preflights the exact demo shell as READY with zero-write proof", async () => {
    const fixture = createFixture();
    try {
      const report = await buildRemotePreflightDemoData(fixture.client, preflightOptions());
      expect(report).toMatchObject({
        status: "READY",
        code: "READY_FOR_DEMO_CORE_V1",
        writeOperationsPerformed: false,
        target: {
          organisationId: ORG_ID,
          organisationName: ORG_NAME,
          organisationKind: "demo",
          organisationStatus: "active",
          centreId: CENTRE_ID,
          centreName: "Main Centre",
          ownerShellIntact: true,
        },
        seedState: {
          deterministicRowsPresent: 0,
          seedAuditRows: 0,
          unknownOperationalRows: 0,
        },
        zeroWriteProof: { changedDbFalse: true, rowsWritten: 0 },
      });
      expect(report.plannedCounts).toMatchObject({
        courses: 5,
        trainers: 3,
        enquiries: 12,
        students: 8,
        enrolments: 8,
        batches: 4,
        batchMemberships: 8,
        classSessions: 13,
        certificateApplications: 0,
        certificates: 0,
      });
    } finally {
      fixture.close();
    }
  });

  it("blocks normal, wrong-name, wrong-centre, inactive, and broken-owner shells", async () => {
    for (const [sql, code] of [
      ["update organisations set organisation_kind = 'normal' where id = ?", "ORGANISATION_NOT_DEMO"],
      ["update organisations set name = 'Wrong Institute' where id = ?", "EXPECTED_NAME_MISMATCH"],
      ["update branches set name = 'Annex' where id = ?", "EXPECTED_CENTRE_MISMATCH"],
      ["update organisations set status = 'inactive' where id = ?", "ORGANISATION_NOT_ACTIVE"],
      ["delete from login_account_people where login_account_id = ?", "OWNER_SHELL_BROKEN"],
    ] as const) {
      const fixture = createFixture();
      try {
        fixture.db.prepare(sql).run(sql.startsWith("delete") ? OWNER_ACCOUNT_ID : sql.includes("branches") ? CENTRE_ID : ORG_ID);
        await expect(buildRemotePreflightDemoData(fixture.client, preflightOptions())).resolves.toMatchObject({ status: "BLOCKED", code });
      } finally {
        fixture.close();
      }
    }
  });

  it("blocks partial deterministic seed and unrelated existing operational data", async () => {
    const partial = createFixture();
    try {
      partial.db.prepare("insert into course_categories (id, organisation_id, code, name, sort_order, is_active, created_at, updated_at) values ('demo_v1_cat_data', ?, 'DTI-DATA', 'Data & Analytics', 10, 1, ?, ?)").run(ORG_ID, NOW, NOW);
      await expect(buildRemotePreflightDemoData(partial.client, preflightOptions())).resolves.toMatchObject({ status: "BLOCKED", code: "BLOCKED_PARTIAL_SEED" });
    } finally {
      partial.close();
    }

    const unknown = createFixture();
    try {
      unknown.db.prepare("insert into courses (id, organisation_id, category_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at) values ('other_demo_course', ?, null, 'OTHER', 'Other Course', '1 month', 1, 1, 1, 1, 0, 'active', ?, ?)").run(ORG_ID, NOW, NOW);
      await expect(buildRemotePreflightDemoData(unknown.client, preflightOptions())).resolves.toMatchObject({ status: "BLOCKED", code: "UNRELATED_EXISTING_DATA" });
    } finally {
      unknown.close();
    }
  });

  it("generates guarded non-financial Demo-only SQL", () => {
    const sql = buildDemoCoreV1ApplySql(buildDemoCoreV1Dataset(NOW), {
      organisationId: ORG_ID,
      expectedName: ORG_NAME,
      expectedCentre: CENTRE_ID,
      seedVersion: DEMO_CORE_V1_SEED_VERSION,
      reason: "approved demo core seed",
    });
    expect(sql).not.toMatch(/\bBEGIN\s+TRANSACTION\b/i);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
    expect(sql).not.toMatch(/\bSAVEPOINT\b/i);
    expect(sql).not.toContain("org_samyak");
    expect(sql).toContain("organisations.organisation_kind = 'demo'");
    expect(sql).toContain("branches.id = 'branch_01477474b96d4a9eb3e6bade61c7c035'");
    expect(() => assertNoForbiddenFinancialWrites(sql)).not.toThrow();
    for (const forbidden of ["receipts", "receipt_reversals", "fee_agreements", "fee_agreement_instalments", "collection_followups", "admission_discount_approvals"]) {
      expect(sql).not.toMatch(new RegExp(`\\b(insert\\s+into|update|delete\\s+from)\\s+${forbidden}\\b`, "i"));
    }
  });

  it("applies locally, preserves financial counts, passes integrity checks, and is idempotent", async () => {
    const fixture = createFixture();
    try {
      const beforeFinance = financialSnapshot(fixture.db);
      const report = await applyRemoteDemoData(fixture.client, { ...preflightOptions(), reason: "approved demo core seed", now: NOW });
      expect(report).toMatchObject({ status: "APPLIED", remoteWriteExecuted: true, postflight: { status: "ALREADY_SEEDED" } });

      expect(count(fixture.db, "courses where organisation_id = '" + ORG_ID + "'")).toBe(5);
      expect(count(fixture.db, "students where organisation_id = '" + ORG_ID + "'")).toBe(8);
      expect(count(fixture.db, "enquiries where organisation_id = '" + ORG_ID + "'")).toBe(12);
      expect(count(fixture.db, "batches where organisation_id = '" + ORG_ID + "'")).toBe(4);
      expect(count(fixture.db, "class_sessions where organisation_id = '" + ORG_ID + "'")).toBe(13);
      expect(count(fixture.db, "attendance_records where organisation_id = '" + ORG_ID + "'")).toBeGreaterThan(20);
      expect(count(fixture.db, "login_accounts where id like 'demo_v1_%'")).toBe(0);
      expect(financialSnapshot(fixture.db)).toEqual(beforeFinance);
      expect(all(fixture.db, "pragma foreign_key_check")).toEqual([]);

      expect(count(fixture.db, "people where organisation_id = 'org_samyak'")).toBe(0);
      expect(all(fixture.db, "select distinct home_branch_id from students where organisation_id = ?", ORG_ID)).toEqual([{ home_branch_id: CENTRE_ID }]);
      expect(all(fixture.db, "select distinct branch_id from batches where organisation_id = ?", ORG_ID)).toEqual([{ branch_id: CENTRE_ID }]);
      expect(all(fixture.db, "select distinct branch_id from class_sessions where organisation_id = ?", ORG_ID)).toEqual([{ branch_id: CENTRE_ID }]);
      expect(all(fixture.db, "select count(*) as count from batch_memberships where status = 'active' and left_at is not null")).toEqual([{ count: 0 }]);
      expect(all(fixture.db, "select count(*) as count from batch_memberships where status <> 'active' and left_at is null")).toEqual([{ count: 0 }]);

      const audit = row(fixture.db, "select action, entity_type, entity_id, metadata_json from audit_logs where id = 'demo_v1_audit_seeded'");
      expect(audit).toMatchObject({ action: "demo_data_seeded", entity_type: "organisation", entity_id: ORG_ID });
      expect(JSON.parse(String(audit?.metadata_json))).toMatchObject({ source: "maintenance", seedVersion: DEMO_CORE_V1_SEED_VERSION });

      const auditCount = count(fixture.db, "audit_logs where action = 'demo_data_seeded'");
      const rowCount = deterministicSeedRows(buildDemoCoreV1Dataset(NOW)).length;
      await expect(applyRemoteDemoData(fixture.client, { ...preflightOptions(), reason: "approved demo core seed", now: NOW })).resolves.toMatchObject({ status: "ALREADY_SEEDED", remoteWriteExecuted: false });
      expect(count(fixture.db, "audit_logs where action = 'demo_data_seeded'")).toBe(auditCount);
      expect((await buildRemotePreflightDemoData(fixture.client, preflightOptions())).seedState.deterministicRowsPresent).toBe(rowCount);
    } finally {
      fixture.close();
    }
  });

  it("blocks apply for a partial deterministic dataset rather than repairing it", async () => {
    const fixture = createFixture();
    try {
      fixture.db.prepare("insert into roles (id, organisation_id, code, name, created_at) values ('demo_v1_role_student', ?, 'student', 'Student', ?)").run(ORG_ID, NOW);
      await expect(applyRemoteDemoData(fixture.client, { ...preflightOptions(), reason: "approved demo core seed", now: NOW })).rejects.toThrow("BLOCKED_PARTIAL_SEED");
      expect(count(fixture.db, "audit_logs where action = 'demo_data_seeded'")).toBe(0);
    } finally {
      fixture.close();
    }
  });

  it("proves local Wrangler D1 file execution rolls back prior statements when a later seed statement fails", () => {
    const persistTo = mkdtempSync(join(tmpdir(), "samyak-demo-core-atomic-"));
    const failingSql = join(persistTo, "failing-demo-core.sql");
    try {
      runLocalWranglerD1([
        "--command",
        "CREATE TABLE IF NOT EXISTS demo_core_atomicity (id TEXT PRIMARY KEY, value TEXT NOT NULL); DELETE FROM demo_core_atomicity;",
      ], persistTo);
      writeFileSync(failingSql, [
        "INSERT INTO demo_core_atomicity (id, value) VALUES ('first', 'created');",
        "INSERT INTO demo_core_atomicity (id, value) VALUES ('first', 'duplicate');",
      ].join("\n"), "utf8");

      expect(() => runLocalWranglerD1(["--file", failingSql], persistTo)).toThrow(/UNIQUE|constraint|D1_ERROR/i);
      expect(queryLocalWranglerD1<{ count: number }>("SELECT count(*) AS count FROM demo_core_atomicity;", persistTo)).toEqual([{ count: 0 }]);
    } finally {
      if (existsSync(persistTo)) rmSync(persistTo, { recursive: true, force: true });
    }
  }, 60_000);
});

function baseArgs(overrides: Partial<Parameters<typeof validateDemoDataMaintenanceRequest>[0]> = {}) {
  return {
    remote: true,
    preflight: true,
    apply: false,
    confirmApply: false,
    confirmProductionDemoData: false,
    organisationId: ORG_ID,
    expectedName: ORG_NAME,
    expectedCentre: CENTRE_ID,
    seedVersion: DEMO_CORE_V1_SEED_VERSION,
    reason: "",
    databaseName: PRODUCTION_DEMO_DATABASE,
    ...overrides,
  };
}

function preflightOptions() {
  return {
    organisationId: ORG_ID,
    expectedName: ORG_NAME,
    expectedCentre: CENTRE_ID,
    seedVersion: DEMO_CORE_V1_SEED_VERSION,
    now: NOW,
  };
}

function createFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql());
  seedShell(db);
  return {
    db,
    client: new SqliteRemoteD1WriteClient(db),
    close: () => db.close(),
  };
}

function schemaSql() {
  return `
    create table organisations (id text primary key, name text not null, status text not null, organisation_kind text not null, created_at text, updated_at text);
    create table branches (id text primary key, organisation_id text not null references organisations(id), name text not null, code text, timezone text, status text, centre_status text default 'active', created_at text, updated_at text);
    create table people (id text primary key, organisation_id text not null references organisations(id), home_branch_id text references branches(id), full_name text not null, public_name text, status text not null, created_at text, updated_at text);
    create table person_identity_details (person_id text primary key references people(id), official_full_name text not null, date_of_birth text not null, identity_verified integer, created_at text, updated_at text);
    create table person_contacts (id text primary key, person_id text not null references people(id), contact_type text not null, normalized_value text not null, display_value text, last_four text, is_primary integer, is_verified integer, created_at text, updated_at text);
    create table person_contact_details (contact_id text primary key references person_contacts(id), belongs_to text not null, is_whatsapp integer, status text, created_at text, updated_at text);
    create table login_accounts (id text primary key, organisation_id text not null references organisations(id), mobile_normalized text not null, mobile_hash text, mobile_last_four text, login_enabled integer, status text, created_at text, updated_at text);
    create table organisation_memberships (id text primary key, global_identity_id text, organisation_id text not null references organisations(id), login_account_id text not null references login_accounts(id), status text, created_at text, updated_at text);
    create table login_account_people (login_account_id text references login_accounts(id), person_id text references people(id), access_type text, is_default integer, is_available integer, created_at text);
    create table roles (id text primary key, organisation_id text not null references organisations(id), code text not null, name text not null, created_at text);
    create table login_account_roles (login_account_id text references login_accounts(id), role_id text references roles(id), branch_id text references branches(id), created_at text);
    create table person_roles (person_id text references people(id), role_id text references roles(id), branch_id text references branches(id), branch_key text, status text, created_at text);
    create table course_categories (id text primary key, organisation_id text not null references organisations(id), code text, name text, sort_order integer, is_active integer, created_at text, updated_at text);
    create table courses (id text primary key, organisation_id text not null references organisations(id), category_id text references course_categories(id), code text, name text, duration_label text, duration_months real, default_fee_paise integer, lowest_acceptable_fee_paise integer, admission_configuration_complete integer, nsdc_available integer, status text, created_at text, updated_at text);
    create table admission_option_values (id text primary key, organisation_id text not null references organisations(id), category text, code text, label text, sort_order integer, requires_custom_label integer, is_active integer, created_at text, updated_at text);
    create table payment_plan_rules (id text primary key, organisation_id text not null references organisations(id), min_duration_months integer, max_duration_months integer, plan_type text, fixed_instalments integer, is_active integer, created_at text, updated_at text);
    create table enquiries (id text primary key, organisation_id text not null references organisations(id), branch_id text not null references branches(id), person_id text references people(id), enquiry_number text, mobile_used text, course_interest_id text references courses(id), source text, source_detail text, counsellor_login_account_id text references login_accounts(id), preferred_timing text, preferred_joining_date text, status text, pipeline_stage text, next_follow_up_at text, assigned_at text, last_contacted_at text, lost_reason text, closed_reason text, converted_enrolment_id text, converted_at text, created_at text, updated_at text);
    create table enquiry_follow_up_events (id text primary key, enquiry_id text references enquiries(id), organisation_id text references organisations(id), branch_id text references branches(id), actor_login_account_id text references login_accounts(id), channel text, outcome text, note text, occurred_at text, next_follow_up_at_snapshot text, pipeline_stage_snapshot text, created_at text);
    create table students (id text primary key, organisation_id text not null references organisations(id), person_id text references people(id), home_branch_id text references branches(id), student_number text, sequence_number integer, student_since text, current_status text, portal_status text, created_at text, updated_at text);
    create table enrolments (id text primary key, student_id text references students(id), branch_id text references branches(id), course_id text references courses(id), enquiry_id text references enquiries(id), enrolment_number text, training_mode text, batch_preference text, admission_date text, joining_date text, expected_completion_date text, actual_completion_date text, status text, nsdc_preference text, created_at text, updated_at text);
    create table batches (id text primary key, organisation_id text not null references organisations(id), branch_id text references branches(id), course_id text references courses(id), name text, primary_trainer_person_id text references people(id), days_of_week_json text, start_time text, end_time text, capacity integer, status text, created_by_login_account_id text references login_accounts(id), created_at text, updated_at text);
    create table batch_courses (batch_id text references batches(id), course_id text references courses(id), organisation_id text references organisations(id), created_at text, created_by text references login_accounts(id));
    create table batch_memberships (id text primary key, organisation_id text references organisations(id), batch_id text references batches(id), enrolment_id text references enrolments(id), joined_at text, left_at text, status text, assigned_by_login_account_id text references login_accounts(id), created_at text);
    create table class_sessions (id text primary key, organisation_id text references organisations(id), branch_id text references branches(id), batch_id text references batches(id), trainer_person_id text references people(id), session_date text, scheduled_start_time text, scheduled_end_time text, actual_started_at text, actual_ended_at text, teaching_note text, status text, version integer, created_at text, updated_at text, created_by_actor_id text references login_accounts(id));
    create table attendance_records (id text primary key, organisation_id text references organisations(id), class_session_id text references class_sessions(id), batch_membership_id text references batch_memberships(id), enrolment_id text references enrolments(id), person_id text references people(id), status text, marked_by_actor_id text references login_accounts(id), marked_at text, updated_at text);
    create table audit_logs (id text primary key, organisation_id text references organisations(id), branch_id text references branches(id), actor_login_account_id text references login_accounts(id), actor_person_id text references people(id), action text, entity_type text, entity_id text, old_values_json text, new_values_json text, metadata_json text, created_at text);
    create table receipts (id text primary key, organisation_id text references organisations(id));
    create table receipt_reversals (id text primary key, organisation_id text references organisations(id));
    create table fee_agreements (id text primary key, enrolment_id text references enrolments(id));
    create table fee_agreement_instalments (id text primary key, fee_agreement_id text references fee_agreements(id));
    create table collection_followups (id text primary key, organisation_id text references organisations(id));
    create table admission_discount_approvals (id text primary key, organisation_id text references organisations(id));
  `;
}

function seedShell(db: DatabaseSync) {
  db.prepare("insert into organisations values (?, ?, 'active', 'demo', ?, ?)").run(ORG_ID, ORG_NAME, NOW, NOW);
  db.prepare("insert into organisations values ('org_samyak', 'Samyak Computer Classes', 'active', 'normal', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, centre_status, created_at, updated_at) values (?, ?, 'Main Centre', 'MAIN', 'Asia/Kolkata', 'active', 'active', ?, ?)").run(CENTRE_ID, ORG_ID, NOW, NOW);
  db.prepare("insert into people values (?, ?, ?, 'Jim Parsons', 'Jim Parsons', 'active', ?, ?)").run(OWNER_PERSON_ID, ORG_ID, CENTRE_ID, NOW, NOW);
  db.prepare("insert into login_accounts values (?, ?, 'demo-owner', 'demo-owner-hash', '0000', 1, 'active', ?, ?)").run(OWNER_ACCOUNT_ID, ORG_ID, NOW, NOW);
  db.prepare("insert into organisation_memberships values (?, 'gid_demo_owner', ?, ?, 'active', ?, ?)").run(OWNER_MEMBERSHIP_ID, ORG_ID, OWNER_ACCOUNT_ID, NOW, NOW);
  db.prepare("insert into login_account_people values (?, ?, 'staff', 1, 1, ?)").run(OWNER_ACCOUNT_ID, OWNER_PERSON_ID, NOW);
  db.prepare("insert into roles values ('role_demo_owner', ?, 'owner', 'Owner', ?)").run(ORG_ID, NOW);
  db.prepare("insert into login_account_roles values (?, 'role_demo_owner', null, ?)").run(OWNER_ACCOUNT_ID, NOW);
}

function row(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).get(...values) as Record<string, unknown> | undefined;
}

function all(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).all(...values) as Record<string, unknown>[];
}

function count(db: DatabaseSync, tableOrSql: string) {
  return Number(row(db, `select count(*) as count from ${tableOrSql}`)?.count || 0);
}

function financialSnapshot(db: DatabaseSync) {
  return {
    receipts: count(db, "receipts"),
    receiptReversals: count(db, "receipt_reversals"),
    feeAgreements: count(db, "fee_agreements"),
    feeAgreementInstalments: count(db, "fee_agreement_instalments"),
    collectionFollowups: count(db, "collection_followups"),
    admissionDiscountApprovals: count(db, "admission_discount_approvals"),
  };
}

class SqliteRemoteD1WriteClient implements RemoteD1WriteClient {
  readonly databaseName = PRODUCTION_DEMO_DATABASE;
  readonly cwd = process.cwd();
  readonly metas: Array<{ changed_db?: boolean; changes?: number; rows_written?: number }> = [];

  constructor(readonly db: DatabaseSync) {}

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
