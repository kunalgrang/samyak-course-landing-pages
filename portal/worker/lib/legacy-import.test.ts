/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  analyzeLegacyImportCsv,
  buildPrivacySafeReport,
  mapLegacyStatus,
  normalizeIndianMobile,
  resolveLegacyCourse,
} from "./legacy-import";

const SAMPLE_CSV = `STUDENT FULL NAME,PRIMARY MOBILE NUMBER,COURSE ENROLLMENT,ADMISSION DATE,COURSE STATUS
Ajay Test,9876543210,ADVANCE EXCEL,01/02/2024,IN PROGRESS
Ajay   Test,+91 98765 43210,SPOKEN ENGLISH,2024-03-15,ON HOLD
Priya Sample,9123456789,SYK-SFT-001,45500,COMPLETED
`;

describe("legacy student import foundation", () => {
  it("maps approved legacy statuses to current/alumni student and enrolment states", () => {
    expect(mapLegacyStatus("IN PROGRESS")).toMatchObject({ studentStatus: "active", enrolmentStatus: "active", classification: "CURRENT" });
    expect(mapLegacyStatus("ON HOLD")).toMatchObject({ studentStatus: "on_hold", enrolmentStatus: "on_hold", classification: "CURRENT" });
    expect(mapLegacyStatus("COMPLETED")).toMatchObject({ studentStatus: "alumni", enrolmentStatus: "completed", classification: "ALUMNI" });
    expect(mapLegacyStatus("unknown")).toBeNull();
  });

  it("resolves course aliases including ADVANCE EXCEL and SPOKEN ENGLISH", () => {
    expect(resolveLegacyCourse("ADVANCE EXCEL")).toMatchObject({ id: "course_syk_aex_001", code: "SYK-AEX-001", name: "ADVANCED EXCEL" });
    expect(resolveLegacyCourse("SPOKEN ENGLISH")).toMatchObject({ id: "course_syk_sft_001", code: "SYK-SFT-001", name: "SPOKEN ENGLISH" });
    expect(resolveLegacyCourse("SYK-SFT-001")).toMatchObject({ id: "course_syk_sft_001", code: "SYK-SFT-001" });
    expect(resolveLegacyCourse("mystery course")).toBeNull();
  });

  it("normalizes Indian mobiles without exposing contact values in reports", () => {
    expect(normalizeIndianMobile("98765 43210")).toBe("+919876543210");
    expect(normalizeIndianMobile("09876543210")).toBe("+919876543210");
    expect(normalizeIndianMobile("12345")).toBeNull();

    const report = buildPrivacySafeReport(analyzeLegacyImportCsv(SAMPLE_CSV));
    const printed = JSON.stringify(report);
    expect(printed).not.toContain("9876543210");
    expect(printed).not.toContain("+919876543210");
    expect(printed).toContain("******3210");
    expect(report.writeOperationsPerformed).toBe(false);
  });

  it("groups multi-course rows into one proposed student and orders students by earliest admission date", () => {
    const result = analyzeLegacyImportCsv(SAMPLE_CSV);
    expect(result.summary).toMatchObject({
      totalRows: 3,
      validRows: 3,
      errorRows: 0,
      proposedPersonCount: 2,
      proposedEnrolmentCount: 3,
      newPersonCount: 2,
      currentStudentCount: 1,
      alumniStudentCount: 1,
    });
    expect(result.rows[0].legacyStudentRef).toBe(result.rows[1].legacyStudentRef);
    expect(result.rows[0].legacyEnrolmentRef).not.toBe(result.rows[1].legacyEnrolmentRef);
    expect(result.rows.map((row) => row.proposedStudentOrder)).toEqual([1, 1, 2]);
  });

  it("distinguishes existing matches, shared-contact new people, and review-required ambiguous matches", () => {
    const csv = `STUDENT FULL NAME,PRIMARY MOBILE NUMBER,COURSE ENROLLMENT,ADMISSION DATE,COURSE STATUS
Exact Match,9876543210,ADVANCED EXCEL,2024-01-01,IN PROGRESS
Child Match,9876543210,SPOKEN ENGLISH,2024-02-01,IN PROGRESS
Maybe Match,9123456789,SPOKEN ENGLISH,2024-03-01,COMPLETED
`;
    const result = analyzeLegacyImportCsv(csv, {
      existingPeople: [
        { personId: "person_existing", fullName: "Exact Match", mobileNormalized: "+919876543210" },
        { personId: "person_review", fullName: "Different Name", mobileNormalized: "+919123456789" },
      ],
    });

    expect(result.rows[0]).toMatchObject({ personMatchStatus: "exact_existing_match", matchedPersonId: "person_existing", validationStatus: "valid" });
    expect(result.rows[1]).toMatchObject({ personMatchStatus: "shared_contact_new_person", matchedPersonId: null, validationStatus: "valid" });
    expect(result.rows[2]).toMatchObject({ personMatchStatus: "possible_match_review", validationStatus: "review", validationSeverity: "warning" });
    expect(result.rows[2].validationCodes).toContain("POSSIBLE_EXISTING_PERSON_MATCH");
  });

  it("reports row-level errors for unresolved data and blocks apply mode", () => {
    const csv = `STUDENT FULL NAME,PRIMARY MOBILE NUMBER,COURSE ENROLLMENT,ADMISSION DATE,COURSE STATUS
,12345,Unknown,31/02/2024,Left
`;
    const result = analyzeLegacyImportCsv(csv);
    expect(result.summary).toMatchObject({ totalRows: 1, validRows: 0, errorRows: 1 });
    expect(result.rows[0].validationCodes).toEqual(expect.arrayContaining(["INVALID_NAME", "INVALID_MOBILE", "UNRESOLVED_COURSE", "INVALID_ADMISSION_DATE", "UNRESOLVED_STATUS"]));

    const file = join(tmpdir(), `legacy-import-${Date.now()}.csv`);
    writeFileSync(file, SAMPLE_CSV, "utf8");
    expect(() => execFileSync("node", ["--experimental-strip-types", "./worker/lib/legacy-import.ts", "--apply", "--file", file], { cwd: process.cwd(), encoding: "utf8" })).toThrow(/Apply mode is intentionally disabled/);
  });

  it("applies fresh migrations and seed.sql twice with the 42-course master and import tables intact", () => {
    const db = new DatabaseSync(":memory:");
    applyMigrations(db);
    applySeed(db);
    applySeed(db);

    expect(count(db, "course_categories where organisation_id = 'org_samyak'")).toBe(14);
    expect(count(db, "courses where organisation_id = 'org_samyak'")).toBe(42);
    expect(count(db, "referral_programme_courses where referral_programme_id = 'rprog_samyak_skill_circle' and is_active = 1")).toBe(42);
    expect(row(db, "select id, name, duration_months, default_fee_paise, lowest_acceptable_fee_paise from courses where code = 'SYK-SFT-001'")).toMatchObject({
      id: "course_syk_sft_001",
      name: "SPOKEN ENGLISH",
      duration_months: 1.5,
      default_fee_paise: 700000,
      lowest_acceptable_fee_paise: 630000,
    });
    expect(count(db, "sqlite_master where type = 'table' and name in ('legacy_import_batches', 'legacy_import_rows', 'legacy_import_entity_mappings')")).toBe(3);
    db.close();
  });

  it("upgrades a 41-course local database to the 42-course import foundation state", () => {
    const db = new DatabaseSync(":memory:");
    applyMigrations(db, "0014_course_master_and_referral_courses.sql");
    expect(count(db, "courses where organisation_id = 'org_samyak'")).toBe(41);

    applyMigrationFile(db, "0015_add_spoken_english_course.sql");
    applyMigrationFile(db, "0016_legacy_student_import_foundation.sql");
    applySeed(db);
    applySeed(db);

    expect(count(db, "course_categories where organisation_id = 'org_samyak'")).toBe(14);
    expect(count(db, "courses where organisation_id = 'org_samyak'")).toBe(42);
    expect(count(db, "referral_programme_courses where referral_programme_id = 'rprog_samyak_skill_circle' and is_active = 1")).toBe(42);
    expect(count(db, "sqlite_master where type = 'table' and name in ('legacy_import_batches', 'legacy_import_rows', 'legacy_import_entity_mappings')")).toBe(3);
    db.close();
  });
});

function applyMigrations(db: DatabaseSync, throughFile?: string) {
  for (const file of readdirSync(join(process.cwd(), "migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    if (throughFile && file > throughFile) continue;
    if (file === "0012_d1_referral_foundation.sql") seedBase(db);
    applyMigrationFile(db, file);
  }
}

function applyMigrationFile(db: DatabaseSync, file: string) {
  applySql(db, readFileSync(join(process.cwd(), "migrations", file), "utf8"));
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

function count(db: DatabaseSync, fromAndWhere: string) {
  return (db.prepare(`select count(*) as count from ${fromAndWhere}`).get() as { count: number }).count;
}

function row(db: DatabaseSync, sql: string) {
  return db.prepare(sql).get() as Record<string, unknown> | undefined;
}
