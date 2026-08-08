/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyLegacyImportCsv, type LegacyApplySummary } from "./legacy-import-apply.ts";
import { analyzeLegacyImportPlan } from "./legacy-import.ts";
import {
  buildRemotePreflightLegacyImportCsv,
  type RemoteLegacyPreflightReport,
  WranglerRemoteD1Client,
} from "./legacy-import-remote-preflight.ts";

export const PRODUCTION_IMPORT_DATABASE = "samyak-student-portal";
export const PRODUCTION_IMPORT_ORGANISATION = "org_samyak";
export const PRODUCTION_IMPORT_BRANCH = "branch_sion";
export const EXPECTED_PRODUCTION_SOURCE_PEOPLE = 56;
export const EXPECTED_PRODUCTION_SOURCE_ENROLMENTS = 59;
export const EXPECTED_PRODUCTION_NEW_PEOPLE = 56;
export const EXPECTED_PRODUCTION_STUDENT_RANGE = "SYK-SION-000001 through SYK-SION-000056";

type ProductionGuardInput = {
  remote: boolean;
  apply: boolean;
  confirmApply: boolean;
  confirmProductionImport: boolean;
  organisationId: string;
  branch: string;
  databaseName: string;
};

export type ProductionApplyTargetConfirmation = {
  databaseName: string;
  organisationId: string;
  branch: string;
  sourceRows: number;
  proposedPeople: number;
  proposedEnrolments: number;
};

export type ProductionApplyResult = Omit<LegacyApplySummary, "mode"> & {
  mode: "remote_apply";
  remoteWriteExecuted: boolean;
  remoteWriteModel: "d1_execute_file_atomic_sql";
  preflight: RemoteLegacyPreflightReport;
};

export function validateProductionApplyRequest(input: ProductionGuardInput) {
  if (!input.remote || !input.apply || !input.confirmApply || !input.confirmProductionImport) {
    throw new Error("Production remote apply requires --remote --apply --confirm-apply --confirm-production-import.");
  }
  if (input.databaseName !== PRODUCTION_IMPORT_DATABASE) {
    throw new Error(`Production remote apply is locked to D1 database ${PRODUCTION_IMPORT_DATABASE}.`);
  }
  if (input.organisationId !== PRODUCTION_IMPORT_ORGANISATION) {
    throw new Error(`Production remote apply is locked to organisation ${PRODUCTION_IMPORT_ORGANISATION}.`);
  }
  if (input.branch !== PRODUCTION_IMPORT_BRANCH) {
    throw new Error(`Production remote apply is locked to branch ${PRODUCTION_IMPORT_BRANCH}.`);
  }
}

export function assertFreshProductionPreflight(report: RemoteLegacyPreflightReport) {
  const mismatches: string[] = [];
  if (report.status !== "READY") mismatches.push(`status=${report.status}`);
  if (!report.zeroWriteProof.changedDbFalse || report.zeroWriteProof.rowsWritten !== 0) mismatches.push("zero-write proof failed");
  if (report.source.people !== EXPECTED_PRODUCTION_SOURCE_PEOPLE) mismatches.push(`source people=${report.source.people}`);
  if (report.source.enrolments !== EXPECTED_PRODUCTION_SOURCE_ENROLMENTS) mismatches.push(`source enrolments=${report.source.enrolments}`);
  if (report.matching.exactExistingMatches !== 0) mismatches.push(`exact matches=${report.matching.exactExistingMatches}`);
  if (report.matching.possibleMatches !== 0) mismatches.push(`possible matches=${report.matching.possibleMatches}`);
  if (report.matching.errors !== 0) mismatches.push(`errors=${report.matching.errors}`);
  if (report.matching.newPeople !== EXPECTED_PRODUCTION_NEW_PEOPLE) mismatches.push(`new people=${report.matching.newPeople}`);
  if (report.productionCourseMaster.categories !== 14) mismatches.push(`categories=${report.productionCourseMaster.categories}`);
  if (report.productionCourseMaster.courses !== 42) mismatches.push(`courses=${report.productionCourseMaster.courses}`);
  if (report.productionCourseMaster.eligibleCourses !== 42) mismatches.push(`eligible courses=${report.productionCourseMaster.eligibleCourses}`);
  if (report.productionCourseMaster.missingOrIneligibleSourceCourses.length !== 0) mismatches.push("missing/ineligible source courses present");
  if (report.projectedProductionApply.projectedStudentIdRange !== EXPECTED_PRODUCTION_STUDENT_RANGE) {
    mismatches.push(`student ID range=${report.projectedProductionApply.projectedStudentIdRange}`);
  }
  if (mismatches.length > 0) throw new Error(`Fresh production preflight mismatch: ${mismatches.join("; ")}`);
}

export async function applyRemoteLegacyImportCsv(
  client: WranglerRemoteD1Client,
  csvText: string,
  options: {
    organisationId: string;
    branch: string;
    sourceFileName: string;
    sessionPepper: string;
    onBeforeWrite?: (target: ProductionApplyTargetConfirmation) => void;
  },
): Promise<ProductionApplyResult> {
  validateProductionApplyRequest({
    remote: true,
    apply: true,
    confirmApply: true,
    confirmProductionImport: true,
    organisationId: options.organisationId,
    branch: options.branch,
    databaseName: client.databaseName,
  });
  if (!options.sessionPepper.trim()) throw new Error("SESSION_PEPPER is required for production contact HMAC/encryption.");

  const plan = analyzeLegacyImportPlan(csvText, {
    organisationId: options.organisationId,
    branchCode: options.branch,
    sourceFileName: options.sourceFileName,
  });
  const existing = await client.execute<{ id: string }>(
    `select id from legacy_import_batches where organisation_id = '${escapeSql(options.organisationId)}' and source_system = 'legacy_student_workbook' and source_checksum = '${escapeSql(plan.batch.sourceChecksum)}' and status = 'applied' limit 1`,
  );

  const preflight = await buildRemotePreflightLegacyImportCsv(client, csvText, {
    sourceFileName: options.sourceFileName,
    branch: options.branch,
    organisationId: options.organisationId,
    sessionPepper: options.sessionPepper,
  });

  if (existing.results.length > 0) {
    return {
      mode: "remote_apply",
      status: "ALREADY_IMPORTED",
      batchId: existing.results[0].id,
      checksumShort: plan.batch.sourceChecksum.slice(0, 12),
      rows: plan.rows.length,
      peopleCreated: 0,
      peopleMatched: preflight.source.people,
      studentsCreated: 0,
      enrolmentsCreated: 0,
      rolesAdded: 0,
      referrerProfilesCreated: 0,
      referrerProfilesReused: preflight.source.people,
      warnings: 0,
      errors: 0,
      durationMs: 0,
      writeOperationsPerformed: false,
      remoteWriteExecuted: false,
      remoteWriteModel: "d1_execute_file_atomic_sql",
      preflight,
    };
  }

  assertFreshProductionPreflight(preflight);
  options.onBeforeWrite?.({
    databaseName: client.databaseName,
    organisationId: options.organisationId,
    branch: options.branch,
    sourceRows: preflight.source.enrolments,
    proposedPeople: preflight.projectedProductionApply.peopleCreated,
    proposedEnrolments: preflight.projectedProductionApply.enrolmentsCreated,
  });

  const generated = await buildProductionApplySql(csvText, {
    sourceFileName: options.sourceFileName,
    branch: options.branch,
    organisationId: options.organisationId,
    sessionPepper: options.sessionPepper,
  });
  executeRemoteSqlFile(client, generated.sql);

  return {
    ...generated.summary,
    mode: "remote_apply",
    remoteWriteExecuted: true,
    remoteWriteModel: "d1_execute_file_atomic_sql",
    preflight,
  };
}

export async function buildProductionApplySql(
  csvText: string,
  options: { organisationId: string; branch: string; sourceFileName: string; sessionPepper: string },
) {
  const db = new DatabaseSync(":memory:");
  try {
    applyMigrations(db);
    applySeed(db);
    const summary = await applyLegacyImportCsv(db, csvText, {
      organisationId: options.organisationId,
      branch: options.branch,
      sourceFileName: options.sourceFileName,
      sessionPepper: options.sessionPepper,
    });
    if (summary.status !== "APPLIED" || !summary.batchId) throw new Error(`Local production SQL staging did not apply cleanly: ${summary.status}`);
    return { summary, sql: dumpImportSql(db, summary.batchId) };
  } finally {
    db.close();
  }
}

function executeRemoteSqlFile(client: WranglerRemoteD1Client, sql: string) {
  const dir = mkdtempSync(join(tmpdir(), "samyak-legacy-import-"));
  const file = join(dir, "production-import.sql");
  try {
    writeFileSync(file, sql, "utf8");
    const wranglerBin = join(client.cwd, "node_modules", "wrangler", "bin", "wrangler.js");
    execFileSync(process.execPath, [wranglerBin, "d1", "execute", client.databaseName, "--remote", "--file", file], {
      cwd: client.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    if (existsSync(file)) unlinkSync(file);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

function dumpImportSql(db: DatabaseSync, batchId: string) {
  const ids = {
    people: all<{ id: string }>(db, `select distinct result_person_id as id from legacy_import_rows where batch_id = ${q(batchId)} order by id`).map((row) => row.id),
    students: all<{ id: string }>(db, `select distinct result_student_id as id from legacy_import_rows where batch_id = ${q(batchId)} order by id`).map((row) => row.id),
    enrolments: all<{ id: string }>(db, `select distinct result_enrolment_id as id from legacy_import_rows where batch_id = ${q(batchId)} order by id`).map((row) => row.id),
  };
  const contactIds = ids.people.length
    ? all<{ id: string }>(db, `select id from person_contacts where person_id in (${ids.people.map(q).join(", ")}) order by id`).map((row) => row.id)
    : [];
  const statements = [
    ...dumpWhere(db, "number_sequences", "organisation_id = 'org_samyak' and branch_id = 'branch_sion' and (sequence_key = 'student' or sequence_key like 'enrolment:%')"),
    ...dumpWhere(db, "legacy_import_batches", `id = ${q(batchId)}`),
    ...dumpIds(db, "people", "id", ids.people),
    ...dumpIds(db, "person_contacts", "id", contactIds),
    ...dumpIds(db, "person_contact_details", "contact_id", contactIds),
    ...dumpIds(db, "person_contact_secrets", "contact_id", contactIds),
    ...dumpIds(db, "students", "id", ids.students),
    ...dumpWhere(db, "person_roles", ids.people.length ? `person_id in (${ids.people.map(q).join(", ")})` : "1 = 0"),
    ...dumpIds(db, "referrer_profiles", "person_id", ids.people),
    ...dumpIds(db, "enrolments", "id", ids.enrolments),
    ...dumpWhere(db, "legacy_import_entity_mappings", `batch_id = ${q(batchId)}`),
    ...dumpWhere(db, "legacy_import_rows", `batch_id = ${q(batchId)}`),
  ];
  return `${statements.join("\n")}\n`;
}

function dumpIds(db: DatabaseSync, table: string, column: string, ids: string[]) {
  if (ids.length === 0) return [];
  return dumpWhere(db, table, `${column} in (${ids.map(q).join(", ")})`);
}

function dumpWhere(db: DatabaseSync, table: string, where: string) {
  const rows = all<Record<string, unknown>>(db, `select * from ${table} where ${where}`);
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  return rows.map((row) => `insert into ${table} (${columns.map(quoteIdent).join(", ")}) values (${columns.map((column) => sqlValue(row[column])).join(", ")});`);
}

function applyMigrations(db: DatabaseSync) {
  for (const file of readdirSync(join(process.cwd(), "migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    if (file === "0012_d1_referral_foundation.sql") seedBase(db);
    applySql(db, readFileSync(join(process.cwd(), "migrations", file), "utf8"));
  }
}

function applySeed(db: DatabaseSync) {
  applySql(db, readFileSync(join(process.cwd(), "seed.sql"), "utf8"));
}

function applySql(db: DatabaseSync, sql: string) {
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
}

function seedBase(db: DatabaseSync) {
  db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
}

function all<T extends Record<string, unknown>>(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as T[];
}

function q(value: string) {
  return `'${escapeSql(value)}'`;
}

function escapeSql(value: string) {
  return value.replace(/'/g, "''");
}

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "bigint") return String(value);
  return q(String(value));
}
