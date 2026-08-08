/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createOpaqueId, encryptText, hmacHex } from "./crypto.ts";
import {
  analyzeLegacyImportCsv,
  analyzeLegacyImportPlan,
  normalizePersonName,
  sha256,
  type InternalLegacyImportRow,
  type LegacyImportResult,
} from "./legacy-import.ts";

type SqliteDb = DatabaseSync;

export type LegacyApplyOptions = {
  organisationId: string;
  branch: string;
  sourceFileName?: string;
  sessionPepper: string;
  now?: string;
};

export type LegacyApplySummary = {
  mode: "preflight" | "apply";
  status: "READY" | "APPLIED" | "ALREADY_IMPORTED" | "BLOCKED";
  batchId: string | null;
  checksumShort: string;
  rows: number;
  peopleCreated: number;
  peopleMatched: number;
  studentsCreated: number;
  enrolmentsCreated: number;
  rolesAdded: number;
  referrerProfilesCreated: number;
  referrerProfilesReused: number;
  warnings: number;
  errors: number;
  durationMs: number;
  writeOperationsPerformed: boolean;
};

type ImportGroup = {
  legacyStudentRef: string;
  displayName: string;
  normalizedName: string;
  normalizedMobile: string;
  mobileHash: string;
  mobileLastFour: string;
  proposedOrder: number;
  earliestAdmissionDate: string;
  studentStatus: "active" | "on_hold" | "alumni";
  roleCode: "student" | "alumni";
  rows: InternalLegacyImportRow[];
  matchStatus: "new_person" | "exact_existing_match" | "shared_contact_new_person" | "possible_match_review";
  matchedPersonId: string | null;
};

type PreparedImport = {
  plan: ReturnType<typeof analyzeLegacyImportPlan>;
  result: LegacyImportResult;
  organisation: { id: string };
  branch: { id: string; code: string };
  groups: ImportGroup[];
};

export function openLegacyImportDatabase(databasePath?: string) {
  const path = databasePath || findLocalD1DatabasePath();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function findLocalD1DatabasePath(root = process.cwd()) {
  const d1Root = join(root, ".wrangler", "state", "v3", "d1");
  if (!existsSync(d1Root)) throw new Error("Local D1 state not found. Run local migrations first.");
  const candidates = listFiles(d1Root).filter((file) => file.endsWith(".sqlite") && !file.endsWith("metadata.sqlite"));
  for (const candidate of candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)) {
    try {
      const db = new DatabaseSync(candidate, { readOnly: true });
      const ok = db.prepare("select count(*) as count from sqlite_master where type = 'table' and name in ('organisations', 'courses', 'legacy_import_batches')").get() as { count: number };
      db.close();
      if (ok.count === 3) return candidate;
    } catch {
      // Try the next sqlite file.
    }
  }
  throw new Error("Could not identify the local D1 SQLite database.");
}

export async function buildPreflightLegacyImportCsv(db: SqliteDb, csvText: string, options: LegacyApplyOptions): Promise<LegacyApplySummary> {
  const started = Date.now();
  const prepared = await prepareImport(db, csvText, options);
  const blocked = prepared.result.summary.errorRows > 0 || prepared.groups.some((group) => group.matchStatus === "possible_match_review");
  return {
    mode: "preflight",
    status: blocked ? "BLOCKED" : "READY",
    batchId: null,
    checksumShort: prepared.plan.batch.sourceChecksum.slice(0, 12),
    rows: prepared.result.summary.totalRows,
    peopleCreated: prepared.groups.filter((group) => group.matchStatus !== "exact_existing_match").length,
    peopleMatched: prepared.groups.filter((group) => group.matchStatus === "exact_existing_match").length,
    studentsCreated: 0,
    enrolmentsCreated: 0,
    rolesAdded: 0,
    referrerProfilesCreated: 0,
    referrerProfilesReused: 0,
    warnings: prepared.result.summary.reviewRows,
    errors: prepared.result.summary.errorRows + prepared.groups.filter((group) => group.matchStatus === "possible_match_review").length,
    durationMs: Date.now() - started,
    writeOperationsPerformed: false,
  };
}

export async function applyLegacyImportCsv(db: SqliteDb, csvText: string, options: LegacyApplyOptions): Promise<LegacyApplySummary> {
  const started = Date.now();
  const now = options.now || new Date().toISOString();
  const prepared = await prepareImport(db, csvText, options);
  if (prepared.result.summary.errorRows > 0) throw new Error("Cannot apply legacy import with row errors.");
  if (prepared.groups.some((group) => group.matchStatus === "possible_match_review")) throw new Error("Cannot apply legacy import with possible existing-person matches.");

  const existingBatch = db.prepare(
    "select id from legacy_import_batches where organisation_id = ? and source_system = 'legacy_student_workbook' and source_checksum = ? and status = 'applied' limit 1",
  ).get(options.organisationId, prepared.plan.batch.sourceChecksum) as { id: string } | undefined;
  if (existingBatch) {
    return {
      mode: "apply",
      status: "ALREADY_IMPORTED",
      batchId: existingBatch.id,
      checksumShort: prepared.plan.batch.sourceChecksum.slice(0, 12),
      rows: prepared.result.summary.totalRows,
      peopleCreated: 0,
      peopleMatched: prepared.groups.length,
      studentsCreated: 0,
      enrolmentsCreated: 0,
      rolesAdded: 0,
      referrerProfilesCreated: 0,
      referrerProfilesReused: prepared.groups.length,
      warnings: prepared.result.summary.reviewRows,
      errors: 0,
      durationMs: Date.now() - started,
      writeOperationsPerformed: false,
    };
  }

  const batchId = `libatch_${sha256(`${options.organisationId}:${prepared.branch.id}:${prepared.plan.batch.sourceChecksum}`).slice(0, 24)}`;
  const summary: LegacyApplySummary = {
    mode: "apply",
    status: "APPLIED",
    batchId,
    checksumShort: prepared.plan.batch.sourceChecksum.slice(0, 12),
    rows: prepared.result.summary.totalRows,
    peopleCreated: 0,
    peopleMatched: 0,
    studentsCreated: 0,
    enrolmentsCreated: 0,
    rolesAdded: 0,
    referrerProfilesCreated: 0,
    referrerProfilesReused: 0,
    warnings: prepared.result.summary.reviewRows,
    errors: 0,
    durationMs: 0,
    writeOperationsPerformed: true,
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `insert into legacy_import_batches
        (id, organisation_id, branch_id, source_system, source_file_name, source_checksum, mode, status,
         total_rows, valid_rows, error_rows, new_person_count, existing_person_match_count, review_required_count,
         started_at, created_at, updated_at)
       values (?, ?, ?, 'legacy_student_workbook', ?, ?, 'apply', 'draft', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    ).run(
      batchId,
      options.organisationId,
      prepared.branch.id,
      options.sourceFileName || prepared.plan.batch.sourceFileName,
      prepared.plan.batch.sourceChecksum,
      prepared.result.summary.totalRows,
      prepared.result.summary.validRows,
      prepared.groups.filter((group) => group.matchStatus !== "exact_existing_match").length,
      prepared.groups.filter((group) => group.matchStatus === "exact_existing_match").length,
      prepared.groups.filter((group) => group.matchStatus === "possible_match_review").length,
      now,
      now,
      now,
    );

    const roleIds = loadRoleIds(db, options.organisationId);
    for (const group of prepared.groups.sort((a, b) => a.proposedOrder - b.proposedOrder)) {
      const personId = reconcilePerson(db, group, prepared, summary, now);
      const studentId = reconcileStudent(db, group, prepared, personId, summary, now);
      const roleAdded = reconcilePersonRole(db, personId, roleIds[group.roleCode], prepared.branch.id, now);
      if (roleAdded) summary.rolesAdded += 1;
      await reconcileMobileContact(db, group, personId, options.sessionPepper, now);
      reconcileReferrerProfile(db, group, personId, prepared, summary, now);
      upsertEntityMapping(db, options.organisationId, batchId, "person", group.legacyStudentRef, "person", personId, now);
      upsertEntityMapping(db, options.organisationId, batchId, "student", group.legacyStudentRef, "student", studentId, now);
      for (const sourceRow of group.rows) {
        const enrolmentId = reconcileEnrolment(db, group, sourceRow, studentId, prepared, summary, now);
        upsertEntityMapping(db, options.organisationId, batchId, "enrolment", sourceRow.legacyEnrolmentRef, "enrolment", enrolmentId, now);
        insertImportRow(db, batchId, group, sourceRow, personId, studentId, enrolmentId, now);
      }
    }

    db.prepare(
      `update legacy_import_batches
       set status = 'applied', completed_at = ?, new_person_count = ?, existing_person_match_count = ?,
           valid_rows = ?, error_rows = 0, review_required_count = ?, updated_at = ?
       where id = ?`,
    ).run(now, summary.peopleCreated, summary.peopleMatched, prepared.result.summary.validRows, prepared.result.summary.reviewRows, now, batchId);
    db.prepare(
      `insert into audit_logs
        (id, organisation_id, branch_id, action, entity_type, entity_id, metadata_json, created_at)
       values (?, ?, ?, 'legacy_import_applied', 'legacy_import_batch', ?, ?, ?)`,
    ).run(
      `audit_${batchId}`,
      options.organisationId,
      prepared.branch.id,
      batchId,
      JSON.stringify({
        checksumShort: prepared.plan.batch.sourceChecksum.slice(0, 12),
        rows: prepared.result.summary.totalRows,
        peopleCreated: summary.peopleCreated,
        studentsCreated: summary.studentsCreated,
        enrolmentsCreated: summary.enrolmentsCreated,
        referrerProfilesCreated: summary.referrerProfilesCreated,
      }),
      now,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  summary.durationMs = Date.now() - started;
  return summary;
}

export function loadSessionPepper(explicit?: string) {
  if (explicit) return explicit;
  if (process.env.SESSION_PEPPER) return process.env.SESSION_PEPPER;
  const devVarsPath = resolve(process.cwd(), ".dev.vars");
  if (existsSync(devVarsPath)) {
    const value = readFileSync(devVarsPath, "utf8").split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("SESSION_PEPPER="));
    const pepper = value?.slice("SESSION_PEPPER=".length).trim();
    if (pepper) return pepper;
  }
  throw new Error("SESSION_PEPPER is required for contact HMAC/encryption.");
}

async function prepareImport(db: SqliteDb, csvText: string, options: LegacyApplyOptions): Promise<PreparedImport> {
  if (!options.organisationId) throw new Error("Missing --organisation.");
  if (!options.branch) throw new Error("Missing --branch.");
  const organisation = db.prepare("select id from organisations where id = ? and status = 'active'").get(options.organisationId) as { id: string } | undefined;
  if (!organisation) throw new Error(`Organisation not found or inactive: ${options.organisationId}`);
  const branch = db.prepare("select id, code from branches where organisation_id = ? and status = 'active' and (id = ? or code = ?)").get(options.organisationId, options.branch, options.branch.toUpperCase()) as { id: string; code: string } | undefined;
  if (!branch) throw new Error(`Branch not found or inactive: ${options.branch}`);
  const result = analyzeLegacyImportCsv(csvText, { organisationId: options.organisationId, branchCode: branch.id, sourceFileName: options.sourceFileName || "legacy-students.csv" });
  const plan = analyzeLegacyImportPlan(csvText, { organisationId: options.organisationId, branchCode: branch.id, sourceFileName: options.sourceFileName || "legacy-students.csv" });
  assertCanonicalCourseState(db, options.organisationId, plan.rows);
  const groups = await buildGroups(db, plan.rows, options, branch);
  return { plan, result, organisation, branch, groups };
}

function assertCanonicalCourseState(db: SqliteDb, organisationId: string, rows: InternalLegacyImportRow[]) {
  const counts = db.prepare(
    `select
      (select count(*) from course_categories where organisation_id = ?) as categories,
      (select count(*) from courses where organisation_id = ? and status = 'active' and admission_configuration_complete = 1) as courses,
      (select count(*) from referral_programme_courses
       join referral_programmes on referral_programmes.id = referral_programme_courses.referral_programme_id
       where referral_programmes.organisation_id = ? and referral_programmes.code = 'samyak_skill_circle' and referral_programme_courses.is_active = 1) as eligible`,
  ).get(organisationId, organisationId, organisationId) as { categories: number; courses: number; eligible: number };
  if (counts.categories !== 14 || counts.courses !== 42 || counts.eligible !== 42) {
    throw new Error(`Local Course Master is not canonical: categories=${counts.categories}, courses=${counts.courses}, eligible=${counts.eligible}`);
  }
  for (const row of rows) {
    if (!row.resolvedCourse) continue;
    const ok = db.prepare(
      `select courses.id
       from courses
       join referral_programme_courses on referral_programme_courses.course_id = courses.id and referral_programme_courses.is_active = 1
       join referral_programmes on referral_programmes.id = referral_programme_courses.referral_programme_id and referral_programmes.code = 'samyak_skill_circle'
       where courses.organisation_id = ? and courses.id = ? and courses.status = 'active' and courses.admission_configuration_complete = 1`,
    ).get(organisationId, row.resolvedCourse.id);
    if (!ok) throw new Error(`Resolved course is not active/eligible: ${row.resolvedCourse.code}`);
  }
}

async function buildGroups(db: SqliteDb, rows: InternalLegacyImportRow[], options: LegacyApplyOptions, branch: { id: string; code: string }) {
  const grouped = new Map<string, ImportGroup>();
  for (const row of rows) {
    if (row.validationStatus === "error" || !row.normalizedName || !row.normalizedMobile || !row.admissionDate) continue;
    const group = grouped.get(row.legacyStudentRef) || {
      legacyStudentRef: row.legacyStudentRef,
      displayName: displayNameFromNormalized(row.normalizedName),
      normalizedName: row.normalizedName,
      normalizedMobile: row.normalizedMobile,
      mobileHash: await hmacHex(options.sessionPepper, "mobile", row.normalizedMobile),
      mobileLastFour: row.normalizedMobile.slice(-4),
      proposedOrder: row.proposedStudentOrder || 999999,
      earliestAdmissionDate: row.admissionDate,
      studentStatus: "alumni" as const,
      roleCode: "alumni" as const,
      rows: [],
      matchStatus: "new_person" as const,
      matchedPersonId: null,
    };
    group.rows.push(row);
    group.earliestAdmissionDate = [group.earliestAdmissionDate, row.admissionDate].sort()[0];
    if (row.studentClassification === "CURRENT") {
      group.studentStatus = row.mappedStudentStatus === "on_hold" ? "on_hold" : "active";
      group.roleCode = "student";
    }
    grouped.set(row.legacyStudentRef, group);
  }

  const groups = [...grouped.values()];
  const sourceNamesByHash = new Map<string, Set<string>>();
  for (const group of groups) {
    if (!sourceNamesByHash.has(group.mobileHash)) sourceNamesByHash.set(group.mobileHash, new Set());
    sourceNamesByHash.get(group.mobileHash)!.add(group.normalizedName);
  }

  for (const group of groups) {
    const mapped = db.prepare(
      `select target_entity_id from legacy_import_entity_mappings
       where organisation_id = ? and source_system = 'legacy_student_workbook' and source_entity_type = 'person' and source_entity_ref = ?`,
    ).get(options.organisationId, group.legacyStudentRef) as { target_entity_id: string } | undefined;
    if (mapped && db.prepare("select id from people where id = ? and organisation_id = ?").get(mapped.target_entity_id, options.organisationId)) {
      group.matchStatus = "exact_existing_match";
      group.matchedPersonId = mapped.target_entity_id;
      continue;
    }

    const candidates = db.prepare(
      `select people.id, people.full_name
       from person_contacts
       join people on people.id = person_contacts.person_id
       where people.organisation_id = ? and person_contacts.contact_type = 'mobile' and person_contacts.normalized_value = ?`,
    ).all(options.organisationId, group.mobileHash) as Array<{ id: string; full_name: string }>;
    const exact = candidates.find((candidate) => normalizePersonName(candidate.full_name) === group.normalizedName);
    if (exact) {
      group.matchStatus = "exact_existing_match";
      group.matchedPersonId = exact.id;
    } else if (candidates.length === 0) {
      group.matchStatus = "new_person";
    } else {
      const hasExactForAnotherSourceName = [...(sourceNamesByHash.get(group.mobileHash) || [])].some((sourceName) =>
        candidates.some((candidate) => normalizePersonName(candidate.full_name) === sourceName),
      );
      group.matchStatus = hasExactForAnotherSourceName ? "shared_contact_new_person" : "possible_match_review";
    }
  }
  return groups.sort((a, b) => a.proposedOrder - b.proposedOrder);
}

function reconcilePerson(db: SqliteDb, group: ImportGroup, prepared: PreparedImport, summary: LegacyApplySummary, now: string) {
  if (group.matchStatus === "exact_existing_match" && group.matchedPersonId) {
    summary.peopleMatched += 1;
    return group.matchedPersonId;
  }
  const personId = createOpaqueId("person");
  db.prepare(
    `insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at)
     values (?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(personId, prepared.organisation.id, prepared.branch.id, group.displayName, group.displayName, now, now);
  summary.peopleCreated += 1;
  return personId;
}

function reconcileStudent(db: SqliteDb, group: ImportGroup, prepared: PreparedImport, personId: string, summary: LegacyApplySummary, now: string) {
  const mapped = db.prepare(
    `select target_entity_id from legacy_import_entity_mappings
     where organisation_id = ? and source_system = 'legacy_student_workbook' and source_entity_type = 'student' and source_entity_ref = ?`,
  ).get(prepared.organisation.id, group.legacyStudentRef) as { target_entity_id: string } | undefined;
  if (mapped && db.prepare("select id from students where id = ?").get(mapped.target_entity_id)) return mapped.target_entity_id;

  const existing = db.prepare("select id from students where organisation_id = ? and person_id = ?").get(prepared.organisation.id, personId) as { id: string } | undefined;
  if (existing) {
    db.prepare("update students set current_status = ?, updated_at = ? where id = ?").run(group.studentStatus, now, existing.id);
    return existing.id;
  }
  const sequence = allocateSequence(db, prepared.organisation.id, prepared.branch.id, "student", now);
  const studentId = insertStudentWithSequenceRetry(db, {
    organisationId: prepared.organisation.id,
    personId,
    branchId: prepared.branch.id,
    branchCode: prepared.branch.code,
    firstSequence: sequence,
    studentSince: group.earliestAdmissionDate,
    studentStatus: group.studentStatus,
    now,
  });
  summary.studentsCreated += 1;
  return studentId;
}

function insertStudentWithSequenceRetry(
  db: SqliteDb,
  input: { organisationId: string; personId: string; branchId: string; branchCode: string; firstSequence: number; studentSince: string; studentStatus: string; now: string },
) {
  let sequence = input.firstSequence;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const studentId = createOpaqueId("student");
    const studentNumber = `SYK-${input.branchCode.toUpperCase()}-${formatSequence(sequence)}`;
    try {
      db.prepare(
        `insert into students
          (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, 'not_invited', ?, ?)`,
      ).run(studentId, input.organisationId, input.personId, input.branchId, studentNumber, sequence, input.studentSince, input.studentStatus, input.now, input.now);
      return studentId;
    } catch (error) {
      if (!String(error).includes("UNIQUE constraint failed")) throw error;
      sequence = allocateSequence(db, input.organisationId, input.branchId, "student", input.now);
    }
  }
  throw new Error("Could not allocate a unique student number after retries.");
}

async function reconcileMobileContact(db: SqliteDb, group: ImportGroup, personId: string, sessionPepper: string, now: string) {
  const existing = db.prepare("select id from person_contacts where person_id = ? and contact_type = 'mobile' and normalized_value = ?").get(personId, group.mobileHash) as { id: string } | undefined;
  const contactId = existing?.id || `contact_${sha256(`${personId}:${group.mobileHash}`).slice(0, 24)}`;
  const ciphertext = await encryptText(sessionPepper, `contact:${contactId}`, group.normalizedMobile);
  db.prepare("update person_contacts set is_primary = 0, updated_at = ? where person_id = ? and contact_type = 'mobile' and is_primary = 1 and id != ?").run(now, personId, contactId);
  db.prepare(
    `insert into person_contacts
      (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, created_at, updated_at)
     values (?, ?, 'mobile', ?, null, ?, 1, 0, ?, ?)
     on conflict(person_id, contact_type, normalized_value) do update set is_primary = 1, last_four = excluded.last_four, updated_at = excluded.updated_at`,
  ).run(contactId, personId, group.mobileHash, group.mobileLastFour, now, now);
  db.prepare(
    `insert into person_contact_details (contact_id, belongs_to, is_whatsapp, status, created_at, updated_at)
     values (?, 'student', 0, 'active', ?, ?)
     on conflict(contact_id) do update set belongs_to = excluded.belongs_to, updated_at = excluded.updated_at`,
  ).run(contactId, now, now);
  db.prepare(
    `insert into person_contact_secrets (contact_id, value_ciphertext, encryption_version, created_at, updated_at)
     values (?, ?, 'v1', ?, ?)
     on conflict(contact_id) do update set value_ciphertext = excluded.value_ciphertext, updated_at = excluded.updated_at`,
  ).run(contactId, ciphertext, now, now);
}

function reconcileEnrolment(db: SqliteDb, group: ImportGroup, sourceRow: InternalLegacyImportRow, studentId: string, prepared: PreparedImport, summary: LegacyApplySummary, now: string) {
  const mapped = db.prepare(
    `select target_entity_id from legacy_import_entity_mappings
     where organisation_id = ? and source_system = 'legacy_student_workbook' and source_entity_type = 'enrolment' and source_entity_ref = ?`,
  ).get(prepared.organisation.id, sourceRow.legacyEnrolmentRef) as { target_entity_id: string } | undefined;
  if (mapped && db.prepare("select id from enrolments where id = ?").get(mapped.target_entity_id)) return mapped.target_entity_id;

  const admissionDate = sourceRow.admissionDate!;
  const year = admissionDate.slice(0, 4);
  const sequence = allocateSequence(db, prepared.organisation.id, prepared.branch.id, `enrolment:${year}`, now);
  const enrolmentId = createOpaqueId("enrol");
  const enrolmentNumber = `ENR-${prepared.branch.code.toUpperCase()}-${year}-${formatSequence(sequence)}`;
  db.prepare(
    `insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference, batch_id,
       admission_date, joining_date, expected_completion_date, actual_completion_date, status, nsdc_preference,
       referrer_profile_id, referral_id, created_at, updated_at)
     values (?, ?, ?, ?, null, ?, 'classroom', null, null, ?, ?, null, null, ?, 'decide_later', null, null, ?, ?)`,
  ).run(enrolmentId, studentId, prepared.branch.id, sourceRow.resolvedCourse!.id, enrolmentNumber, admissionDate, admissionDate, sourceRow.mappedEnrolmentStatus, now, now);
  summary.enrolmentsCreated += 1;
  return enrolmentId;
}

function reconcilePersonRole(db: SqliteDb, personId: string, roleId: string, branchId: string, now: string) {
  const before = db.prepare("select count(*) as count from person_roles where person_id = ? and role_id = ? and branch_key = ?").get(personId, roleId, branchId) as { count: number };
  db.prepare(
    `insert into person_roles (person_id, role_id, branch_id, branch_key, created_at)
     values (?, ?, ?, ?, ?)
     on conflict(person_id, role_id, branch_key) do nothing`,
  ).run(personId, roleId, branchId, branchId, now);
  return before.count === 0;
}

function reconcileReferrerProfile(db: SqliteDb, group: ImportGroup, personId: string, prepared: PreparedImport, summary: LegacyApplySummary, now: string) {
  const existing = db.prepare("select id from referrer_profiles where person_id = ?").get(personId) as { id: string } | undefined;
  if (existing) {
    summary.referrerProfilesReused += 1;
    return existing.id;
  }
  const referrerId = createOpaqueId("ref");
  const suffix = sha256(group.legacyStudentRef).slice(0, 16);
  db.prepare(
    `insert into referrer_profiles
      (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, last_synced_at, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(referrerId, prepared.organisation.id, personId, `legacy-import:${group.legacyStudentRef}`, `legacy-import-disabled:${suffix}`, "legacy-import-disabled", now, now, now);
  summary.referrerProfilesCreated += 1;
  return referrerId;
}

function insertImportRow(db: SqliteDb, batchId: string, group: ImportGroup, sourceRow: InternalLegacyImportRow, personId: string, studentId: string, enrolmentId: string, now: string) {
  db.prepare(
    `insert into legacy_import_rows
      (id, batch_id, source_row_number, row_checksum, legacy_student_ref, legacy_enrolment_ref, normalised_name,
       mobile_last_four, course_input, resolved_course_id, admission_date, legacy_status_input,
       mapped_student_status, mapped_enrolment_status, person_match_status, matched_person_id,
       proposed_student_number, validation_status, validation_severity, validation_codes_json,
       result_person_id, result_student_id, result_enrolment_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, 'applied', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `lirow_${sha256(`${batchId}:${sourceRow.sourceRowNumber}`).slice(0, 24)}`,
    batchId,
    sourceRow.sourceRowNumber,
    sha256(`${sourceRow.legacyEnrolmentRef}:${sourceRow.resolvedCourse?.code}:${sourceRow.admissionDate}:${sourceRow.mappedEnrolmentStatus}`),
    group.legacyStudentRef,
    sourceRow.legacyEnrolmentRef,
    group.normalizedName,
    group.mobileLastFour,
    sourceRow.courseInput,
    sourceRow.resolvedCourse?.id || null,
    sourceRow.admissionDate,
    sourceRow.legacyStatusInput,
    sourceRow.mappedStudentStatus,
    sourceRow.mappedEnrolmentStatus,
    group.matchStatus,
    personId,
    sourceRow.validationSeverity,
    JSON.stringify(sourceRow.validationCodes),
    group.matchedPersonId,
    studentId,
    enrolmentId,
    now,
    now,
  );
}

function upsertEntityMapping(db: SqliteDb, organisationId: string, batchId: string, sourceEntityType: "person" | "student" | "enrolment", sourceEntityRef: string, targetEntityType: "person" | "student" | "enrolment", targetEntityId: string, now: string) {
  const id = `limap_${sha256(`${organisationId}:${sourceEntityType}:${sourceEntityRef}:${targetEntityType}`).slice(0, 24)}`;
  db.prepare(
    `insert into legacy_import_entity_mappings
      (id, organisation_id, source_system, source_entity_type, source_entity_ref, target_entity_type, target_entity_id, batch_id, created_at)
     values (?, ?, 'legacy_student_workbook', ?, ?, ?, ?, ?, ?)
     on conflict(organisation_id, source_system, source_entity_type, source_entity_ref) do nothing`,
  ).run(id, organisationId, sourceEntityType, sourceEntityRef, targetEntityType, targetEntityId, batchId, now);
}

function allocateSequence(db: SqliteDb, organisationId: string, branchId: string, sequenceKey: string, now: string) {
  const id = `seq_${organisationId}_${branchId}_${sequenceKey}`.replace(/[^a-zA-Z0-9_:-]/g, "_");
  db.prepare(
    `insert or ignore into number_sequences (id, organisation_id, branch_id, sequence_key, next_sequence, created_at, updated_at)
     values (?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, organisationId, branchId, sequenceKey, now, now);
  const row = db.prepare(
    `update number_sequences
     set next_sequence = next_sequence + 1, updated_at = ?
     where organisation_id = ? and branch_id = ? and sequence_key = ?
     returning next_sequence - 1 as sequence`,
  ).get(now, organisationId, branchId, sequenceKey) as { sequence: number } | undefined;
  if (!row) throw new Error("Could not allocate sequence");
  return Number(row.sequence);
}

function loadRoleIds(db: SqliteDb, organisationId: string) {
  const rows = db.prepare("select code, id from roles where organisation_id = ? and code in ('student', 'alumni')").all(organisationId) as Array<{ code: "student" | "alumni"; id: string }>;
  const roleIds = Object.fromEntries(rows.map((row) => [row.code, row.id])) as Record<"student" | "alumni", string>;
  if (!roleIds.student || !roleIds.alumni) throw new Error("Required student/alumni roles are missing.");
  return roleIds;
}

function listFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function displayNameFromNormalized(name: string) {
  return name.split(" ").map((part) => part.slice(0, 1) + part.slice(1).toLowerCase()).join(" ");
}

function formatSequence(sequence: number) {
  return String(sequence).padStart(6, "0");
}
