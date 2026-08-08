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
import { applyLegacyImportCsv as applyLegacyImportToDb, buildPreflightLegacyImportCsv } from "./legacy-import-apply";
import {
  assertFreshProductionPreflight,
  buildProductionApplySql,
  PRODUCTION_IMPORT_DATABASE,
  validateProductionApplyRequest,
} from "./legacy-import-remote-apply";
import { buildRemotePreflightLegacyImportCsv, type RemoteD1Client } from "./legacy-import-remote-preflight";
import { hmacHex } from "./crypto";

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

  it("reports row-level errors for unresolved data and requires explicit apply confirmation", () => {
    const csv = `STUDENT FULL NAME,PRIMARY MOBILE NUMBER,COURSE ENROLLMENT,ADMISSION DATE,COURSE STATUS
,12345,Unknown,31/02/2024,Left
`;
    const result = analyzeLegacyImportCsv(csv);
    expect(result.summary).toMatchObject({ totalRows: 1, validRows: 0, errorRows: 1 });
    expect(result.rows[0].validationCodes).toEqual(expect.arrayContaining(["INVALID_NAME", "INVALID_MOBILE", "UNRESOLVED_COURSE", "INVALID_ADMISSION_DATE", "UNRESOLVED_STATUS"]));

    const file = join(tmpdir(), `legacy-import-${Date.now()}.csv`);
    writeFileSync(file, SAMPLE_CSV, "utf8");
    const cli = ["--experimental-strip-types", "--experimental-specifier-resolution=node", "./worker/lib/legacy-import-cli.ts"];
    expect(() => execFileSync("node", [...cli, "--apply", "--file", file], { cwd: process.cwd(), encoding: "utf8" })).toThrow(/Local apply requires --confirm-apply/);
    expect(() => execFileSync("node", [...cli, "--apply", "--dry-run", "--file", file], { cwd: process.cwd(), encoding: "utf8" })).toThrow(/either --dry-run or --apply/);
    expect(() => execFileSync("node", [...cli, "--remote", "--apply", "--file", file], { cwd: process.cwd(), encoding: "utf8" })).toThrow(/Production remote apply requires/);
    expect(() => execFileSync("node", [...cli, "--remote", "--apply", "--confirm-apply", "--file", file], { cwd: process.cwd(), encoding: "utf8" })).toThrow(/confirm-production-import/);
  }, 15000);

  it("requires every production apply flag and locks the production target", () => {
    const base = {
      remote: true,
      apply: true,
      confirmApply: true,
      confirmProductionImport: true,
      organisationId: "org_samyak",
      branch: "branch_sion",
      databaseName: PRODUCTION_IMPORT_DATABASE,
    };

    expect(() => validateProductionApplyRequest(base)).not.toThrow();
    expect(() => validateProductionApplyRequest({ ...base, confirmApply: false })).toThrow(/confirm-apply/);
    expect(() => validateProductionApplyRequest({ ...base, confirmProductionImport: false })).toThrow(/confirm-production-import/);
    expect(() => validateProductionApplyRequest({ ...base, apply: false })).toThrow(/--apply/);
    expect(() => validateProductionApplyRequest({ ...base, remote: false })).toThrow(/--remote/);
    expect(() => validateProductionApplyRequest({ ...base, organisationId: "other_org" })).toThrow(/organisation org_samyak/);
    expect(() => validateProductionApplyRequest({ ...base, branch: "branch_other" })).toThrow(/branch branch_sion/);
    expect(() => validateProductionApplyRequest({ ...base, databaseName: "other-d1" })).toThrow(/samyak-student-portal/);
  });

  it("blocks production apply when the mandatory fresh preflight drifts", () => {
    expect(() => assertFreshProductionPreflight(productionPreflight())).not.toThrow();
    expect(() => assertFreshProductionPreflight(productionPreflight({ matching: { ...productionPreflight().matching, possibleMatches: 1 } }))).toThrow(/possible matches=1/);
    expect(() => assertFreshProductionPreflight(productionPreflight({ matching: { ...productionPreflight().matching, errors: 1 } }))).toThrow(/errors=1/);
    expect(() => assertFreshProductionPreflight(productionPreflight({ productionCourseMaster: { ...productionPreflight().productionCourseMaster, courses: 41 } }))).toThrow(/courses=41/);
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

  it("applies a synthetic legacy import transactionally without logins, referral links, referrals, or rewards", async () => {
    const db = migratedSeededDb();
    const summary = await applyLegacyImportToDb(db, SAMPLE_CSV, applyOptions());

    expect(summary).toMatchObject({
      status: "APPLIED",
      rows: 3,
      peopleCreated: 2,
      studentsCreated: 2,
      enrolmentsCreated: 3,
      referrerProfilesCreated: 2,
      writeOperationsPerformed: true,
    });
    expect(count(db, "people")).toBe(2);
    expect(count(db, "students")).toBe(2);
    expect(count(db, "person_contacts")).toBe(2);
    expect(count(db, "person_contact_details")).toBe(2);
    expect(count(db, "person_contact_secrets")).toBe(2);
    expect(count(db, "legacy_import_rows where matched_person_id is not null")).toBe(0);
    expect(count(db, "legacy_import_rows where result_person_id is not null and result_student_id is not null and result_enrolment_id is not null")).toBe(3);
    expect(count(db, "login_accounts")).toBe(0);
    expect(count(db, "login_account_people")).toBe(0);
    expect(count(db, "enrolments")).toBe(3);
    expect(count(db, "referrer_profiles")).toBe(2);
    expect(count(db, "referral_links")).toBe(0);
    expect(count(db, "referrals")).toBe(0);
    expect(count(db, "referral_reward_snapshots")).toBe(0);
    expect(row(db, "select student_number, student_since, current_status from students order by sequence_number limit 1")).toMatchObject({
      student_number: "SYK-SION-000001",
      student_since: "2024-02-01",
      current_status: "on_hold",
    });
    expect(all(db, "select status, admission_date, joining_date from enrolments order by admission_date")).toEqual([
      { status: "active", admission_date: "2024-02-01", joining_date: "2024-02-01" },
      { status: "on_hold", admission_date: "2024-03-15", joining_date: "2024-03-15" },
      { status: "completed", admission_date: "2024-07-27", joining_date: "2024-07-27" },
    ]);
    db.close();
  });

  it("applies a 56-person and 59-enrolment synthetic fixture with expected current/alumni roles", async () => {
    const db = migratedSeededDb();
    const summary = await applyLegacyImportToDb(db, syntheticScaleCsv(), applyOptions({ sourceFileName: "scale.csv" }));

    expect(summary).toMatchObject({ status: "APPLIED", rows: 59, peopleCreated: 56, studentsCreated: 56, enrolmentsCreated: 59, referrerProfilesCreated: 56 });
    expect(count(db, "people")).toBe(56);
    expect(count(db, "students")).toBe(56);
    expect(count(db, "enrolments")).toBe(59);
    expect(count(db, "referrer_profiles")).toBe(56);
    expect(count(db, "referral_links")).toBe(0);
    expect(count(db, "referrals")).toBe(0);
    expect(count(db, "referral_reward_snapshots")).toBe(0);
    expect(count(db, "person_roles join roles on roles.id = person_roles.role_id where roles.code = 'student'")).toBe(20);
    expect(count(db, "person_roles join roles on roles.id = person_roles.role_id where roles.code = 'alumni'")).toBe(36);
    expect(row(db, "select student_number from students order by sequence_number limit 1")).toMatchObject({ student_number: "SYK-SION-000001" });
    expect(row(db, "select student_number from students order by sequence_number desc limit 1")).toMatchObject({ student_number: "SYK-SION-000056" });
    db.close();
  });

  it("keeps the same file idempotent on second apply using batch and source mappings", async () => {
    const db = migratedSeededDb();
    await applyLegacyImportToDb(db, SAMPLE_CSV, applyOptions());
    const second = await applyLegacyImportToDb(db, SAMPLE_CSV, applyOptions());

    expect(second).toMatchObject({ status: "ALREADY_IMPORTED", peopleCreated: 0, studentsCreated: 0, enrolmentsCreated: 0, referrerProfilesCreated: 0, writeOperationsPerformed: false });
    expect(count(db, "people")).toBe(2);
    expect(count(db, "students")).toBe(2);
    expect(count(db, "enrolments")).toBe(3);
    expect(count(db, "legacy_import_entity_mappings")).toBe(7);
    db.close();
  });

  it("blocks row errors before creating a batch or business rows", async () => {
    const db = migratedSeededDb();
    const invalid = `STUDENT FULL NAME,PRIMARY MOBILE NUMBER,COURSE ENROLLMENT,ADMISSION DATE,COURSE STATUS
Bad Row,9876543210,UNKNOWN COURSE,2024-01-01,IN PROGRESS
`;
    await expect(applyLegacyImportToDb(db, invalid, applyOptions({ sourceFileName: "invalid.csv" }))).rejects.toThrow(/row errors/);
    expect(count(db, "legacy_import_batches")).toBe(0);
    expect(count(db, "people")).toBe(0);
    expect(count(db, "students")).toBe(0);
    expect(count(db, "enrolments")).toBe(0);
    db.close();
  });

  it("does not duplicate entities when a corrected source file keeps the same stable refs", async () => {
    const db = migratedSeededDb();
    await applyLegacyImportToDb(db, SAMPLE_CSV, applyOptions());
    const corrected = SAMPLE_CSV.replace("ON HOLD", "IN PROGRESS");
    const second = await applyLegacyImportToDb(db, corrected, applyOptions({ sourceFileName: "corrected.csv" }));

    expect(second).toMatchObject({ status: "APPLIED", peopleCreated: 0, studentsCreated: 0, enrolmentsCreated: 0 });
    expect(count(db, "people")).toBe(2);
    expect(count(db, "students")).toBe(2);
    expect(count(db, "enrolments")).toBe(3);
    expect(count(db, "legacy_import_batches")).toBe(2);
    db.close();
  });

  it("reuses exact existing person, student, and referrer profile by contact hash and compatible name", async () => {
    const db = migratedSeededDb();
    const mobile = "+919876543210";
    const mobileHash = await hmacHex("test-pepper", "mobile", mobile);
    db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_existing', 'org_samyak', 'branch_sion', 'Ajay Test', 'Ajay Test', 'active', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
    db.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values ('contact_existing', 'person_existing', 'mobile', ?, '3210', 1, 1, ?, ?)").run(mobileHash, "2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
    db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values ('student_existing', 'org_samyak', 'person_existing', 'branch_sion', 'SYK-SION-000099', 99, '2023-01-01', 'active', 'not_invited', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
    db.prepare("insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values ('ref_existing', 'org_samyak', 'person_existing', 'legacy-existing', 'legacy-token-existing', 'legacy-link-existing', 1, ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");

    const summary = await applyLegacyImportToDb(db, SAMPLE_CSV, applyOptions());

    expect(summary.peopleMatched).toBe(1);
    expect(summary.peopleCreated).toBe(1);
    expect(summary.studentsCreated).toBe(1);
    expect(summary.referrerProfilesReused).toBe(1);
    expect(count(db, "people")).toBe(2);
    expect(row(db, "select student_number from students where id = 'student_existing'")).toMatchObject({ student_number: "SYK-SION-000099" });
    db.close();
  });

  it("blocks ambiguous same-contact different-name matches before writes", async () => {
    const db = migratedSeededDb();
    const mobileHash = await hmacHex("test-pepper", "mobile", "+919876543210");
    db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_existing', 'org_samyak', 'branch_sion', 'Different Name', 'Different Name', 'active', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
    db.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values ('contact_existing', 'person_existing', 'mobile', ?, '3210', 1, 1, ?, ?)").run(mobileHash, "2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");

    await expect(applyLegacyImportToDb(db, SAMPLE_CSV, applyOptions())).rejects.toThrow(/possible existing-person matches/);
    expect(count(db, "legacy_import_batches")).toBe(0);
    expect(count(db, "students")).toBe(0);
    expect(count(db, "enrolments")).toBe(0);
    db.close();
  });

  it("keeps shared-mobile source people separate and stores no raw mobile in staging or audit", async () => {
    const db = migratedSeededDb();
    const csv = `STUDENT FULL NAME,PRIMARY MOBILE NUMBER,COURSE ENROLLMENT,ADMISSION DATE,COURSE STATUS
Rachit Rajak,9876543211,CCC,2024-01-01,IN PROGRESS
Varsha,9876543211,CCC,2024-01-02,COMPLETED
`;
    await applyLegacyImportToDb(db, csv, applyOptions());

    expect(count(db, "people")).toBe(2);
    expect(count(db, "students")).toBe(2);
    expect(count(db, "person_contacts")).toBe(2);
    expect(count(db, "person_contacts where contact_type = 'mobile' and last_four = '3211'")).toBe(2);
    const sensitiveJson = JSON.stringify(all(db, "select * from legacy_import_batches")) + JSON.stringify(all(db, "select * from legacy_import_rows")) + JSON.stringify(all(db, "select * from legacy_import_entity_mappings")) + JSON.stringify(all(db, "select metadata_json from audit_logs"));
    expect(sensitiveJson).not.toContain("9876543211");
    expect(sensitiveJson).not.toContain("+919876543211");
    db.close();
  });

  it("builds production apply SQL from the local apply path without excluded write targets or raw contacts", async () => {
    const generated = await buildProductionApplySql(SAMPLE_CSV, applyOptions());
    const sql = generated.sql;

    expect(generated.summary).toMatchObject({ status: "APPLIED", peopleCreated: 2, studentsCreated: 2, enrolmentsCreated: 3 });
    for (const table of [
      "legacy_import_batches",
      "legacy_import_rows",
      "legacy_import_entity_mappings",
      "people",
      "person_contacts",
      "person_contact_details",
      "person_contact_secrets",
      "students",
      "person_roles",
      "enrolments",
      "referrer_profiles",
      "number_sequences",
    ]) {
      expect(sql).toContain(`insert into ${table}`);
    }
    for (const table of [
      "login_accounts",
      "login_account_people",
      "referral_links",
      "referrals",
      "referral_status_events",
      "referral_reward_snapshots",
      "audit_logs",
    ]) {
      expect(sql).not.toContain(`insert into ${table}`);
    }
    expect(sql).not.toContain("9876543210");
    expect(sql).not.toContain("+919876543210");
  });

  it("preflights without writes", async () => {
    const db = migratedSeededDb();
    const summary = await buildPreflightLegacyImportCsv(db, SAMPLE_CSV, applyOptions());

    expect(summary).toMatchObject({ status: "READY", writeOperationsPerformed: false, rows: 3, peopleCreated: 2 });
    expect(count(db, "people")).toBe(0);
    expect(count(db, "legacy_import_batches")).toBe(0);
    db.close();
  });

  it("remote-preflights a production-shaped 0014 database without import tables or writes", async () => {
    const db = remoteProductionDbThrough0014();
    const mobileHash = await hmacHex("test-pepper", "mobile", "+919876543210");
    seedExistingProductionPerson(db, { fullName: "Ajay Test", mobileHash, withStudent: true, withReferrerProfile: true, withStudentRole: true });
    db.prepare("insert into number_sequences (id, organisation_id, branch_id, sequence_key, next_sequence, created_at, updated_at) values ('seq_student', 'org_samyak', 'branch_sion', 'student', 2, ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
    const client = sqliteRemoteClient(db);

    const report = await buildRemotePreflightLegacyImportCsv(client, SAMPLE_CSV, remoteOptions());

    expect(report.status).toBe("READY");
    expect(report.writeOperationsPerformed).toBe(false);
    expect(report.zeroWriteProof.rowsWritten).toBe(0);
    expect(report.productionCountsBefore).toEqual(report.productionCountsAfter);
    expect(report.source).toMatchObject({ people: 2, enrolments: 3, current: 1, alumni: 1 });
    expect(report.matching).toMatchObject({ exactExistingMatches: 1, possibleMatches: 0, sharedContactNewPeople: 0, newPeople: 1, errors: 0 });
    expect(report.projectedProductionApply).toMatchObject({
      peopleCreated: 1,
      peopleReused: 1,
      studentsCreated: 1,
      studentsReused: 1,
      enrolmentsCreated: 3,
      studentRolesReused: 1,
      alumniRolesCreated: 1,
      referrerProfilesCreated: 1,
      referrerProfilesReused: 1,
      projectedStudentIdRange: "SYK-SION-000002 through SYK-SION-000002",
    });
    expect(report.productionCourseMaster).toMatchObject({ categories: 13, courses: 41, eligibleCourses: 41 });
    expect(report.productionCourseMaster.missingOrIneligibleSourceCourses).toEqual([
      { code: "SYK-SFT-001", name: "SPOKEN ENGLISH", status: "PRODUCTION_COURSE_MIGRATION_REQUIRED" },
    ]);
    expect(JSON.stringify(report)).not.toContain("9876543210");
    expect(JSON.stringify(report)).not.toContain("+919876543210");
    expect(JSON.stringify(report)).not.toContain(mobileHash);
    expect(JSON.stringify(report)).not.toContain("v1:");
    expect(client.statements.every((statement) => /^\s*select\b/i.test(statement))).toBe(true);
    expect(count(db, "sqlite_master where type = 'table' and name like 'legacy_import_%'")).toBe(0);
    db.close();
  });

  it("remote preflight classifies no match, possible match, and shared-contact source people conservatively", async () => {
    const possibleDb = remoteProductionDbThrough0014();
    seedExistingProductionPerson(possibleDb, {
      fullName: "Different Name",
      mobileHash: await hmacHex("test-pepper", "mobile", "+919876543210"),
      withStudent: false,
      withReferrerProfile: false,
      withStudentRole: false,
    });
    const possible = await buildRemotePreflightLegacyImportCsv(sqliteRemoteClient(possibleDb), SAMPLE_CSV, remoteOptions());
    expect(possible.status).toBe("OWNER_MATCH_RESOLUTION_REQUIRED");
    expect(possible.matching).toMatchObject({ possibleMatches: 1, exactExistingMatches: 0, newPeople: 1 });
    expect(possible.matching.exactAndReviewRows[0]).toMatchObject({ contactEvidence: true, nameEvidence: false, ownerReviewNeeded: true });
    possibleDb.close();

    const sharedDb = remoteProductionDbThrough0014();
    const sharedCsv = `STUDENT FULL NAME,PRIMARY MOBILE NUMBER,COURSE ENROLLMENT,ADMISSION DATE,COURSE STATUS
Rachit Rajak,9876543211,CCC,2024-01-01,IN PROGRESS
Varsha,9876543211,CCC,2024-01-02,COMPLETED
`;
    const shared = await buildRemotePreflightLegacyImportCsv(sqliteRemoteClient(sharedDb), sharedCsv, remoteOptions({ sourceFileName: "shared.csv" }));
    expect(shared.matching).toMatchObject({ newPeople: 2, sharedContactNewPeople: 0, possibleMatches: 0 });
    expect(shared.sharedMobileVerification).toEqual({ maskedMobile: "******3211", proposedPeople: 2, collapsed: false });
    sharedDb.close();
  });

  it("retries Student ID allocation when a stale counter collides with an existing student", async () => {
    const db = migratedSeededDb();
    db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_seed', 'org_samyak', 'branch_sion', 'Seed Student', 'Seed Student', 'active', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
    db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values ('student_seed', 'org_samyak', 'person_seed', 'branch_sion', 'SYK-SION-000001', 1, '2023-01-01', 'active', 'not_invited', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
    db.prepare("insert into number_sequences (id, organisation_id, branch_id, sequence_key, next_sequence, created_at, updated_at) values ('seq_stale', 'org_samyak', 'branch_sion', 'student', 1, ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");

    await applyLegacyImportToDb(db, `STUDENT FULL NAME,PRIMARY MOBILE NUMBER,COURSE ENROLLMENT,ADMISSION DATE,COURSE STATUS
New Student,9876543210,CCC,2024-01-01,IN PROGRESS
`, applyOptions({ sourceFileName: "collision.csv" }));

    expect(row(db, "select student_number, sequence_number from students where person_id != 'person_seed'")).toMatchObject({ student_number: "SYK-SION-000002", sequence_number: 2 });
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

function all(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Array<Record<string, unknown>>;
}

function migratedSeededDb() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  applySeed(db);
  return db;
}

function remoteProductionDbThrough0014() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db, "0014_course_master_and_referral_courses.sql");
  db.exec("create table d1_migrations (id integer primary key, name text, applied_at timestamp not null default current_timestamp)");
  readdirSync(join(process.cwd(), "migrations"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name <= "0014_course_master_and_referral_courses.sql")
    .sort()
    .forEach((name, index) => {
      db.prepare("insert into d1_migrations (id, name, applied_at) values (?, ?, ?)").run(index + 1, name, "2026-08-08 00:00:00");
    });
  db.prepare("insert into roles (id, organisation_id, code, name, created_at) values ('role_student', 'org_samyak', 'student', 'Student', ?)").run("2026-08-08T00:00:00.000Z");
  db.prepare("insert into roles (id, organisation_id, code, name, created_at) values ('role_alumni', 'org_samyak', 'alumni', 'Alumni', ?)").run("2026-08-08T00:00:00.000Z");
  return db;
}

function sqliteRemoteClient(db: DatabaseSync): RemoteD1Client & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async execute<T extends Record<string, unknown> = Record<string, unknown>>(sql: string) {
      if (!/^\s*select\b/i.test(sql)) throw new Error(`non-select statement: ${sql}`);
      statements.push(sql);
      return {
        results: all(db, sql) as T[],
        meta: { changed_db: false, changes: 0, rows_written: 0 },
      };
    },
  };
}

function seedExistingProductionPerson(
  db: DatabaseSync,
  options: { fullName: string; mobileHash: string; withStudent: boolean; withReferrerProfile: boolean; withStudentRole: boolean },
) {
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_existing', 'org_samyak', 'branch_sion', ?, ?, 'active', ?, ?)").run(options.fullName, options.fullName, "2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
  db.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values ('contact_existing', 'person_existing', 'mobile', ?, '3210', 1, 1, ?, ?)").run(options.mobileHash, "2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
  if (options.withStudent) {
    db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values ('student_existing', 'org_samyak', 'person_existing', 'branch_sion', 'SYK-SION-000001', 1, '2023-01-01', 'active', 'active', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
  }
  if (options.withReferrerProfile) {
    db.prepare("insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values ('ref_existing', 'org_samyak', 'person_existing', 'existing-ref', 'existing-token', 'existing-link', 1, ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
  }
  if (options.withStudentRole) {
    db.prepare("insert into person_roles (person_id, role_id, branch_id, branch_key, created_at) values ('person_existing', 'role_student', 'branch_sion', 'branch_sion', ?)").run("2026-08-08T00:00:00.000Z");
  }
}

function applyOptions(overrides: Partial<Parameters<typeof applyLegacyImportToDb>[2]> = {}) {
  return {
    organisationId: "org_samyak",
    branch: "branch_sion",
    sourceFileName: "synthetic.csv",
    sessionPepper: "test-pepper",
    now: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function remoteOptions(overrides: Partial<Parameters<typeof buildRemotePreflightLegacyImportCsv>[2]> = {}) {
  return {
    organisationId: "org_samyak",
    branch: "branch_sion",
    sourceFileName: "synthetic.csv",
    sessionPepper: "test-pepper",
    ...overrides,
  };
}

function productionPreflight(overrides: Partial<ReturnType<typeof baseProductionPreflight>> = {}) {
  return { ...baseProductionPreflight(), ...overrides };
}

function baseProductionPreflight() {
  return {
    mode: "remote_preflight" as const,
    status: "READY" as const,
    sourceChecksumShort: "5f366307cb6a",
    writeOperationsPerformed: false as const,
    zeroWriteProof: { queries: 26, changedDbFalse: true, rowsWritten: 0 },
    productionCountsBefore: {},
    productionCountsAfter: {},
    productionMigrationState: { latestApplied: "0016_legacy_student_import_foundation.sql", appliedThrough: "0016", has0015: true, has0016: true },
    requiredFutureMigrations: [],
    source: { people: 56, enrolments: 59, current: 20, alumni: 36 },
    matching: { exactExistingMatches: 0, possibleMatches: 0, sharedContactNewPeople: 0, newPeople: 56, errors: 0, exactAndReviewRows: [] },
    existingProductionPeople: [],
    projectedProductionApply: {
      peopleCreated: 56,
      peopleReused: 0,
      studentsCreated: 56,
      studentsReused: 0,
      enrolmentsCreated: 59,
      enrolmentsReused: 0,
      studentRolesCreated: 20,
      studentRolesReused: 0,
      alumniRolesCreated: 36,
      alumniRolesReused: 0,
      referrerProfilesCreated: 56,
      referrerProfilesReused: 0,
      referralLinksCreated: 0 as const,
      referralsCreated: 0 as const,
      rewardSnapshotsCreated: 0 as const,
      projectedStudentIdRange: "SYK-SION-000001 through SYK-SION-000056",
      projectedNewStudentIdsNeeded: 56,
    },
    productionCourseMaster: { categories: 14, courses: 42, eligibleCourses: 42, missingOrIneligibleSourceCourses: [] },
    sharedMobileVerification: { maskedMobile: "******3211", proposedPeople: 2, collapsed: false },
  };
}

function syntheticScaleCsv() {
  const rows = ["STUDENT FULL NAME,PRIMARY MOBILE NUMBER,COURSE ENROLLMENT,ADMISSION DATE,COURSE STATUS"];
  for (let index = 1; index <= 56; index += 1) {
    const mobile = `98765${String(index).padStart(5, "0")}`;
    const status = index <= 20 ? "IN PROGRESS" : "COMPLETED";
    const date = `2024-01-${String(Math.min(index, 28)).padStart(2, "0")}`;
    rows.push(`Synthetic ${index},${mobile},CCC,${date},${status}`);
  }
  rows.push("Synthetic 4,9876500004,SPOKEN ENGLISH,2024-02-04,COMPLETED");
  rows.push("Synthetic 5,9876500005,MS OFFICE,2024-02-05,COMPLETED");
  rows.push("Synthetic 6,9876500006,ADVANCE EXCEL,2024-02-06,COMPLETED");
  return `${rows.join("\n")}\n`;
}
