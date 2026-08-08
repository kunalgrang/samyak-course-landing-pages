/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { hmacHex } from "./crypto.ts";
import {
  analyzeLegacyImportCsv,
  analyzeLegacyImportPlan,
  normalizePersonName,
  sha256,
  type InternalLegacyImportRow,
  type LegacyImportResult,
} from "./legacy-import.ts";

type RemoteMeta = {
  changed_db?: boolean;
  changes?: number;
  rows_written?: number;
};

export type RemoteD1QueryResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  results: T[];
  meta: RemoteMeta;
};

export type RemoteD1Client = {
  execute<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<RemoteD1QueryResult<T>>;
};

export type RemotePreflightOptions = {
  organisationId: string;
  branch: string;
  sourceFileName?: string;
  sessionPepper: string;
  databaseName?: string;
};

type RemoteImportGroup = {
  legacyStudentRef: string;
  displayName: string;
  normalizedName: string;
  mobileHash: string;
  maskedMobile: string;
  proposedOrder: number;
  earliestAdmissionDate: string;
  roleCode: "student" | "alumni";
  rows: InternalLegacyImportRow[];
  matchStatus: "new_person" | "exact_existing_match" | "shared_contact_new_person" | "possible_match_review";
  matchedPersonId: string | null;
  contactEvidence: boolean;
  nameEvidence: boolean;
};

type ExistingCandidate = {
  person_id: string;
  full_name: string;
  person_status: string;
  mobile_hash: string;
  student_id: string | null;
  student_number: string | null;
  referrer_profile_id: string | null;
};

type ExistingPersonSafe = {
  personId: string;
  activeState: string;
  studentRecordExists: boolean;
  studentNumber: string | null;
  referrerProfileExists: boolean;
  roles: string[];
  contactMatch: boolean;
  normalizedNameMatch: boolean;
};

export type RemoteLegacyPreflightReport = {
  mode: "remote_preflight";
  status: "READY" | "OWNER_MATCH_RESOLUTION_REQUIRED" | "BLOCKED";
  sourceChecksumShort: string;
  writeOperationsPerformed: false;
  zeroWriteProof: {
    queries: number;
    changedDbFalse: boolean;
    rowsWritten: number;
  };
  productionCountsBefore: Record<string, number>;
  productionCountsAfter: Record<string, number>;
  productionMigrationState: {
    latestApplied: string | null;
    appliedThrough: string | null;
    has0015: boolean;
    has0016: boolean;
  };
  requiredFutureMigrations: string[];
  source: {
    people: number;
    enrolments: number;
    current: number;
    alumni: number;
  };
  matching: {
    exactExistingMatches: number;
    possibleMatches: number;
    sharedContactNewPeople: number;
    newPeople: number;
    errors: number;
    exactAndReviewRows: Array<{
      sourceLegacyRef: string;
      displayName: string;
      maskedMobile: string;
      matchClassification: string;
      personId: string | null;
      contactEvidence: boolean;
      nameEvidence: boolean;
      ownerReviewNeeded: boolean;
    }>;
  };
  existingProductionPeople: ExistingPersonSafe[];
  projectedProductionApply: {
    peopleCreated: number;
    peopleReused: number;
    studentsCreated: number;
    studentsReused: number;
    enrolmentsCreated: number;
    enrolmentsReused: number;
    studentRolesCreated: number;
    studentRolesReused: number;
    alumniRolesCreated: number;
    alumniRolesReused: number;
    referrerProfilesCreated: number;
    referrerProfilesReused: number;
    referralLinksCreated: 0;
    referralsCreated: 0;
    rewardSnapshotsCreated: 0;
    projectedStudentIdRange: string | null;
    projectedNewStudentIdsNeeded: number;
  };
  productionCourseMaster: {
    categories: number;
    courses: number;
    eligibleCourses: number;
    missingOrIneligibleSourceCourses: Array<{ code: string; name: string; status: "PRODUCTION_COURSE_MIGRATION_REQUIRED" | "PRODUCTION_COURSE_NOT_ELIGIBLE" }>;
  };
  sharedMobileVerification: {
    maskedMobile: string;
    proposedPeople: number;
    collapsed: boolean;
  };
};

export class WranglerRemoteD1Client implements RemoteD1Client {
  readonly databaseName: string;
  readonly cwd: string;
  readonly metas: RemoteMeta[] = [];

  constructor(databaseName = "samyak-student-portal", cwd = process.cwd()) {
    this.databaseName = databaseName;
    this.cwd = cwd;
  }

  async execute<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<RemoteD1QueryResult<T>> {
    const commandSql = normalizeSqlForCommand(sql);
    assertReadOnlySql(commandSql);
    const wranglerBin = join(this.cwd, "node_modules", "wrangler", "bin", "wrangler.js");
    const output = execFileSync(process.execPath, [wranglerBin, "d1", "execute", this.databaseName, "--remote", "--json", "--command", commandSql], {
      cwd: this.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = parseWranglerJson<T>(output);
    assertZeroWriteMeta(parsed.meta);
    this.metas.push(parsed.meta);
    return parsed;
  }
}

export async function buildRemotePreflightLegacyImportCsv(
  client: RemoteD1Client,
  csvText: string,
  options: RemotePreflightOptions,
): Promise<RemoteLegacyPreflightReport> {
  if (!options.organisationId) throw new Error("Missing --organisation.");
  if (!options.branch) throw new Error("Missing --branch.");
  const queryMetas: RemoteMeta[] = [];
  const execute = async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string) => {
    assertReadOnlySql(sql);
    const result = await client.execute<T>(sql);
    assertZeroWriteMeta(result.meta);
    queryMetas.push(result.meta);
    return result.results;
  };

  const before = await loadProductionCounts(execute);
  const migrations = await execute<{ name: string }>("select name from d1_migrations order by id");
  const branch = await loadBranch(execute, options);
  await assertOrganisationExists(execute, options.organisationId);
  const plan = analyzeLegacyImportPlan(csvText, {
    organisationId: options.organisationId,
    branchCode: branch.id,
    sourceFileName: options.sourceFileName || "legacy-students.csv",
  });
  const result = analyzeLegacyImportCsv(csvText, {
    organisationId: options.organisationId,
    branchCode: branch.id,
    sourceFileName: options.sourceFileName || "legacy-students.csv",
  });
  const courseMaster = await loadCourseMasterState(execute, options.organisationId, plan.rows);
  const groups = await buildRemoteGroups(plan.rows, options);
  const candidates = await loadCandidates(execute, options.organisationId, groups);
  classifyGroups(groups, candidates);
  const existingPeople = await loadExistingPeople(execute, options.organisationId, groups, candidates);
  const projection = await projectApply(execute, options.organisationId, branch.id, branch.code, groups, candidates);
  const after = await loadProductionCounts(execute);

  const possibleMatches = groups.filter((group) => group.matchStatus === "possible_match_review").length;
  const errors = result.summary.errorRows;
  const status = errors > 0 ? "BLOCKED" : possibleMatches > 0 ? "OWNER_MATCH_RESOLUTION_REQUIRED" : "READY";
  return {
    mode: "remote_preflight",
    status,
    sourceChecksumShort: plan.batch.sourceChecksum.slice(0, 12),
    writeOperationsPerformed: false,
    zeroWriteProof: {
      queries: queryMetas.length,
      changedDbFalse: queryMetas.every((meta) => meta.changed_db === false),
      rowsWritten: queryMetas.reduce((sum, meta) => sum + Number(meta.rows_written || meta.changes || 0), 0),
    },
    productionCountsBefore: before,
    productionCountsAfter: after,
    productionMigrationState: migrationState(migrations),
    requiredFutureMigrations: requiredMigrations(migrations),
    source: {
      people: groups.length,
      enrolments: result.summary.proposedEnrolmentCount,
      current: result.summary.currentStudentCount,
      alumni: result.summary.alumniStudentCount,
    },
    matching: {
      exactExistingMatches: groups.filter((group) => group.matchStatus === "exact_existing_match").length,
      possibleMatches,
      sharedContactNewPeople: groups.filter((group) => group.matchStatus === "shared_contact_new_person").length,
      newPeople: groups.filter((group) => group.matchStatus === "new_person").length,
      errors,
      exactAndReviewRows: groups
        .filter((group) => group.matchStatus === "exact_existing_match" || group.matchStatus === "possible_match_review")
        .map((group) => ({
          sourceLegacyRef: group.legacyStudentRef,
          displayName: group.displayName,
          maskedMobile: group.maskedMobile,
          matchClassification: group.matchStatus,
          personId: group.matchedPersonId,
          contactEvidence: group.contactEvidence,
          nameEvidence: group.nameEvidence,
          ownerReviewNeeded: group.matchStatus === "possible_match_review",
        })),
    },
    existingProductionPeople: existingPeople,
    projectedProductionApply: projection,
    productionCourseMaster: courseMaster,
    sharedMobileVerification: sharedMobileState(groups),
  };
}

async function loadProductionCounts(execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>) {
  const tables = [
    "people",
    "students",
    "person_contacts",
    "login_accounts",
    "enrolments",
    "referrer_profiles",
    "referral_links",
    "referrals",
    "referral_reward_snapshots",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    counts[table] = Number((await execute<{ count: number }>(`select count(*) as count from ${table}`))[0].count);
  }
  return counts;
}

async function assertOrganisationExists(execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>, organisationId: string) {
  const rows = await execute<{ id: string }>(`select id from organisations where id = ${q(organisationId)} and status = 'active' limit 1`);
  if (rows.length === 0) throw new Error(`Organisation not found or inactive: ${organisationId}`);
}

async function loadBranch(execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>, options: RemotePreflightOptions) {
  const rows = await execute<{ id: string; code: string }>(
    `select id, code from branches where organisation_id = ${q(options.organisationId)} and status = 'active' and (id = ${q(options.branch)} or code = ${q(options.branch.toUpperCase())}) limit 1`,
  );
  if (rows.length === 0) throw new Error(`Branch not found or inactive: ${options.branch}`);
  return rows[0];
}

async function loadCourseMasterState(
  execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>,
  organisationId: string,
  rows: InternalLegacyImportRow[],
): Promise<RemoteLegacyPreflightReport["productionCourseMaster"]> {
  const counts = (await execute<{ categories: number; courses: number; eligible: number }>(
    `select
      (select count(*) from course_categories where organisation_id = ${q(organisationId)} and is_active = 1) as categories,
      (select count(*) from courses where organisation_id = ${q(organisationId)} and status = 'active' and admission_configuration_complete = 1) as courses,
      (select count(*) from referral_programme_courses
       join referral_programmes on referral_programmes.id = referral_programme_courses.referral_programme_id
       where referral_programmes.organisation_id = ${q(organisationId)}
         and referral_programmes.code = 'samyak_skill_circle'
         and referral_programme_courses.is_active = 1) as eligible`,
  ))[0];
  const sourceCourses = uniqueBy(
    rows.filter((row) => row.resolvedCourse).map((row) => row.resolvedCourse!),
    (course) => course.code,
  );
  const courseRows = sourceCourses.length
    ? await execute<{ id: string; code: string; name: string; eligible: number }>(
      `select courses.id, courses.code, courses.name,
         case when referral_programme_courses.course_id is null then 0 else 1 end as eligible
       from courses
       left join referral_programmes on referral_programmes.organisation_id = courses.organisation_id
         and referral_programmes.code = 'samyak_skill_circle'
       left join referral_programme_courses on referral_programme_courses.referral_programme_id = referral_programmes.id
         and referral_programme_courses.course_id = courses.id
         and referral_programme_courses.is_active = 1
       where courses.organisation_id = ${q(organisationId)}
         and courses.status = 'active'
         and courses.admission_configuration_complete = 1
         and courses.code in (${sourceCourses.map((course) => q(course.code)).join(", ")})`,
    )
    : [];
  const byCode = new Map(courseRows.map((row) => [row.code, row]));
  return {
    categories: Number(counts.categories),
    courses: Number(counts.courses),
    eligibleCourses: Number(counts.eligible),
    missingOrIneligibleSourceCourses: sourceCourses
      .filter((course) => !byCode.has(course.code) || Number(byCode.get(course.code)!.eligible) !== 1)
      .map((course) => ({
        code: course.code,
        name: course.name,
        status: !byCode.has(course.code) ? "PRODUCTION_COURSE_MIGRATION_REQUIRED" : "PRODUCTION_COURSE_NOT_ELIGIBLE",
      })),
  };
}

async function buildRemoteGroups(rows: InternalLegacyImportRow[], options: RemotePreflightOptions): Promise<RemoteImportGroup[]> {
  const grouped = new Map<string, RemoteImportGroup>();
  for (const row of rows) {
    if (row.validationStatus === "error" || !row.normalizedName || !row.normalizedMobile || !row.admissionDate) continue;
    const existing = grouped.get(row.legacyStudentRef);
    const group = existing || {
      legacyStudentRef: row.legacyStudentRef,
      displayName: displayNameFromNormalized(row.normalizedName),
      normalizedName: row.normalizedName,
      mobileHash: await hmacHex(options.sessionPepper, "mobile", row.normalizedMobile),
      maskedMobile: row.maskedMobile || "******",
      proposedOrder: row.proposedStudentOrder || 999999,
      earliestAdmissionDate: row.admissionDate,
      roleCode: "alumni" as const,
      rows: [],
      matchStatus: "new_person" as const,
      matchedPersonId: null,
      contactEvidence: false,
      nameEvidence: false,
    };
    group.rows.push(row);
    group.earliestAdmissionDate = [group.earliestAdmissionDate, row.admissionDate].sort()[0];
    if (row.studentClassification === "CURRENT") group.roleCode = "student";
    grouped.set(row.legacyStudentRef, group);
  }
  return [...grouped.values()].sort((left, right) => left.proposedOrder - right.proposedOrder);
}

async function loadCandidates(
  execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>,
  organisationId: string,
  groups: RemoteImportGroup[],
) {
  const hashes = [...new Set(groups.map((group) => group.mobileHash))];
  if (hashes.length === 0) return new Map<string, ExistingCandidate[]>();
  const rows = await execute<ExistingCandidate>(
    `select people.id as person_id, people.full_name, people.status as person_status,
       person_contacts.normalized_value as mobile_hash,
       students.id as student_id, students.student_number,
       referrer_profiles.id as referrer_profile_id
     from person_contacts
     join people on people.id = person_contacts.person_id
     left join students on students.organisation_id = people.organisation_id and students.person_id = people.id
     left join referrer_profiles on referrer_profiles.person_id = people.id
     where people.organisation_id = ${q(organisationId)}
       and person_contacts.contact_type = 'mobile'
       and person_contacts.normalized_value in (${hashes.map(q).join(", ")})`,
  );
  const byHash = new Map<string, ExistingCandidate[]>();
  for (const row of rows) {
    const list = byHash.get(row.mobile_hash) || [];
    list.push(row);
    byHash.set(row.mobile_hash, list);
  }
  return byHash;
}

function classifyGroups(groups: RemoteImportGroup[], candidatesByHash: Map<string, ExistingCandidate[]>) {
  const sourceNamesByHash = new Map<string, Set<string>>();
  for (const group of groups) {
    if (!sourceNamesByHash.has(group.mobileHash)) sourceNamesByHash.set(group.mobileHash, new Set());
    sourceNamesByHash.get(group.mobileHash)!.add(group.normalizedName);
  }
  for (const group of groups) {
    const candidates = candidatesByHash.get(group.mobileHash) || [];
    const exact = candidates.find((candidate) => normalizePersonName(candidate.full_name) === group.normalizedName);
    group.contactEvidence = candidates.length > 0;
    group.nameEvidence = Boolean(exact);
    if (exact) {
      group.matchStatus = "exact_existing_match";
      group.matchedPersonId = exact.person_id;
    } else if (candidates.length === 0) {
      group.matchStatus = "new_person";
    } else {
      const hasExactForAnotherSourceName = [...(sourceNamesByHash.get(group.mobileHash) || [])].some((sourceName) =>
        candidates.some((candidate) => normalizePersonName(candidate.full_name) === sourceName),
      );
      group.matchStatus = hasExactForAnotherSourceName ? "shared_contact_new_person" : "possible_match_review";
      group.matchedPersonId = candidates[0]?.person_id || null;
    }
  }
}

async function loadExistingPeople(
  execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>,
  organisationId: string,
  groups: RemoteImportGroup[],
  candidatesByHash: Map<string, ExistingCandidate[]>,
): Promise<ExistingPersonSafe[]> {
  const sourceHashes = new Set(groups.map((group) => group.mobileHash));
  const sourceNamesByHash = new Map<string, Set<string>>();
  for (const group of groups) {
    const names = sourceNamesByHash.get(group.mobileHash) || new Set<string>();
    names.add(group.normalizedName);
    sourceNamesByHash.set(group.mobileHash, names);
  }
  const personRows = await execute<{ person_id: string; status: string; student_number: string | null; referrer_profile_id: string | null; roles: string | null }>(
    `select people.id as person_id, people.status,
       students.student_number,
       referrer_profiles.id as referrer_profile_id,
       group_concat(distinct roles.code) as roles
     from people
     left join students on students.organisation_id = people.organisation_id and students.person_id = people.id
     left join referrer_profiles on referrer_profiles.person_id = people.id
     left join person_roles on person_roles.person_id = people.id
     left join roles on roles.id = person_roles.role_id
     where people.organisation_id = ${q(organisationId)}
     group by people.id, people.status, students.student_number, referrer_profiles.id
     order by people.created_at`,
  );
  const contactRows = [...candidatesByHash.entries()].flatMap(([hash, candidates]) => candidates.map((candidate) => ({ hash, candidate })));
  return personRows.map((person) => {
    const matchedContacts = contactRows.filter((row) => row.candidate.person_id === person.person_id);
    const contactMatch = matchedContacts.some((row) => sourceHashes.has(row.hash));
    const normalizedNameMatch = matchedContacts.some((row) => {
      const names = sourceNamesByHash.get(row.hash);
      return names ? names.has(normalizePersonName(row.candidate.full_name) || row.candidate.full_name) : false;
    });
    return {
      personId: person.person_id,
      activeState: person.status,
      studentRecordExists: Boolean(person.student_number),
      studentNumber: person.student_number,
      referrerProfileExists: Boolean(person.referrer_profile_id),
      roles: person.roles ? person.roles.split(",").filter(Boolean).sort() : [],
      contactMatch,
      normalizedNameMatch,
    };
  });
}

async function projectApply(
  execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>,
  organisationId: string,
  branchId: string,
  branchCode: string,
  groups: RemoteImportGroup[],
  candidatesByHash: Map<string, ExistingCandidate[]>,
): Promise<RemoteLegacyPreflightReport["projectedProductionApply"]> {
  const matchedPersonIds = groups.map((group) => group.matchedPersonId).filter((id): id is string => Boolean(id));
  const matchedStudentIds = [...candidatesByHash.values()].flat()
    .filter((candidate) => matchedPersonIds.includes(candidate.person_id) && candidate.student_id)
    .map((candidate) => candidate.student_id!);
  const existingRoles = matchedPersonIds.length
    ? await execute<{ person_id: string; code: string }>(
      `select person_roles.person_id, roles.code
       from person_roles
       join roles on roles.id = person_roles.role_id
       where person_roles.person_id in (${matchedPersonIds.map(q).join(", ")})
         and roles.organisation_id = ${q(organisationId)}
         and roles.code in ('student', 'alumni')`,
    )
    : [];
  const existingEnrolments = matchedStudentIds.length
    ? await execute<{ student_id: string; course_id: string; admission_date: string }>(
      `select student_id, course_id, admission_date
       from enrolments
       where student_id in (${matchedStudentIds.map(q).join(", ")})`,
    )
    : [];
  const sequence = (await execute<{ next_sequence: number | null; max_sequence: number | null }>(
    `select
       (select next_sequence from number_sequences where organisation_id = ${q(organisationId)} and branch_id = ${q(branchId)} and sequence_key = 'student') as next_sequence,
       (select max(sequence_number) from students where organisation_id = ${q(organisationId)} and home_branch_id = ${q(branchId)}) as max_sequence`,
  ))[0];
  const roleKeys = new Set(existingRoles.map((role) => `${role.person_id}:${role.code}`));
  const existingEnrolmentKeys = new Set(existingEnrolments.map((enrolment) => `${enrolment.student_id}:${enrolment.course_id}:${enrolment.admission_date}`));
  let studentsCreated = 0;
  let studentsReused = 0;
  let enrolmentsCreated = 0;
  let enrolmentsReused = 0;
  let studentRolesCreated = 0;
  let studentRolesReused = 0;
  let alumniRolesCreated = 0;
  let alumniRolesReused = 0;
  let referrerProfilesCreated = 0;
  let referrerProfilesReused = 0;

  for (const group of groups) {
    const exact = group.matchStatus === "exact_existing_match" && group.matchedPersonId
      ? (candidatesByHash.get(group.mobileHash) || []).find((candidate) => candidate.person_id === group.matchedPersonId)
      : undefined;
    const studentId = exact?.student_id || null;
    if (studentId) studentsReused += 1;
    else studentsCreated += 1;
    const roleKey = exact ? `${exact.person_id}:${group.roleCode}` : null;
    if (group.roleCode === "student") {
      if (roleKey && roleKeys.has(roleKey)) studentRolesReused += 1;
      else studentRolesCreated += 1;
    } else if (roleKey && roleKeys.has(roleKey)) {
      alumniRolesReused += 1;
    } else {
      alumniRolesCreated += 1;
    }
    if (exact?.referrer_profile_id) referrerProfilesReused += 1;
    else referrerProfilesCreated += 1;
    for (const row of group.rows) {
      const key = studentId && row.resolvedCourse && row.admissionDate ? `${studentId}:${row.resolvedCourse.id}:${row.admissionDate}` : null;
      if (key && existingEnrolmentKeys.has(key)) enrolmentsReused += 1;
      else enrolmentsCreated += 1;
    }
  }

  const firstNewSequence = Math.max(Number(sequence.next_sequence || 1), Number(sequence.max_sequence || 0) + 1);
  const lastNewSequence = firstNewSequence + studentsCreated - 1;
  return {
    peopleCreated: groups.filter((group) => group.matchStatus !== "exact_existing_match").length,
    peopleReused: groups.filter((group) => group.matchStatus === "exact_existing_match").length,
    studentsCreated,
    studentsReused,
    enrolmentsCreated,
    enrolmentsReused,
    studentRolesCreated,
    studentRolesReused,
    alumniRolesCreated,
    alumniRolesReused,
    referrerProfilesCreated,
    referrerProfilesReused,
    referralLinksCreated: 0,
    referralsCreated: 0,
    rewardSnapshotsCreated: 0,
    projectedStudentIdRange: studentsCreated > 0 ? `SYK-${branchCode.toUpperCase()}-${formatSequence(firstNewSequence)} through SYK-${branchCode.toUpperCase()}-${formatSequence(lastNewSequence)}` : null,
    projectedNewStudentIdsNeeded: studentsCreated,
  };
}

function migrationState(rows: Array<{ name: string }>): RemoteLegacyPreflightReport["productionMigrationState"] {
  const names = rows.map((row) => row.name);
  const latestApplied = names.at(-1) || null;
  return {
    latestApplied,
    appliedThrough: latestApplied ? latestApplied.slice(0, 4) : null,
    has0015: names.includes("0015_add_spoken_english_course.sql"),
    has0016: names.includes("0016_legacy_student_import_foundation.sql"),
  };
}

function requiredMigrations(rows: Array<{ name: string }>) {
  const names = new Set(rows.map((row) => row.name));
  return [
    ["0015_add_spoken_english_course.sql", "0015"],
    ["0016_legacy_student_import_foundation.sql", "0016"],
  ].filter(([file]) => !names.has(file)).map(([, label]) => label);
}

function sharedMobileState(groups: RemoteImportGroup[]) {
  const shared = groups.filter((group) => group.maskedMobile === "******3211");
  return {
    maskedMobile: "******3211",
    proposedPeople: shared.length,
    collapsed: new Set(shared.map((group) => group.legacyStudentRef)).size !== shared.length,
  };
}

function parseWranglerJson<T extends Record<string, unknown>>(output: string): RemoteD1QueryResult<T> {
  const start = Math.min(...["[", "{"].map((token) => output.indexOf(token)).filter((index) => index >= 0));
  if (!Number.isFinite(start)) throw new Error("Wrangler did not return JSON.");
  const parsed = JSON.parse(output.slice(start));
  const envelope = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!envelope?.success) throw new Error("Remote D1 query failed.");
  return { results: (envelope.results || []) as T[], meta: envelope.meta || {} };
}

function assertReadOnlySql(sql: string) {
  const normalized = sql.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\b/i.test(normalized)) throw new Error("Remote preflight only permits SELECT statements.");
  if (/\b(insert|update|delete|create|alter|drop|replace|attach|detach|vacuum|begin|commit|rollback|pragma)\b/i.test(normalized)) {
    throw new Error("Remote preflight SQL contains a non-read operation.");
  }
}

function normalizeSqlForCommand(sql: string) {
  return sql.trim().replace(/\s+/g, " ");
}

function assertZeroWriteMeta(meta: RemoteMeta) {
  if (meta.changed_db !== false || Number(meta.rows_written || 0) !== 0 || Number(meta.changes || 0) !== 0) {
    throw new Error("Remote preflight query reported a database change.");
  }
}

function displayNameFromNormalized(name: string) {
  return name.split(" ").map((part) => part.slice(0, 1) + part.slice(1).toLowerCase()).join(" ");
}

function formatSequence(sequence: number) {
  return String(sequence).padStart(6, "0");
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const marker = key(value);
    if (seen.has(marker)) return false;
    seen.add(marker);
    return true;
  });
}

function q(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}
