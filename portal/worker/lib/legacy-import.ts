import { createHash } from "node:crypto";

export const REQUIRED_LEGACY_HEADERS = [
  "STUDENT FULL NAME",
  "PRIMARY MOBILE NUMBER",
  "COURSE ENROLLMENT",
  "ADMISSION DATE",
  "COURSE STATUS",
] as const;

export type LegacyCourse = {
  id: string;
  code: string;
  name: string;
  categoryCode: string;
  durationMonths: number;
};

export type ExistingPersonCandidate = {
  personId: string;
  fullName: string;
  mobileNormalized?: string;
  mobileHash?: string;
};

export type LegacyImportOptions = {
  organisationId?: string;
  branchCode?: string;
  sourceFileName?: string;
  courseCatalog?: LegacyCourse[];
  existingPeople?: ExistingPersonCandidate[];
};

export type LegacyImportRow = {
  sourceRowNumber: number;
  legacyStudentRef: string;
  legacyEnrolmentRef: string;
  proposedStudentOrder: number | null;
  maskedMobile: string | null;
  nameFingerprint: string | null;
  courseInput: string | null;
  resolvedCourse: Pick<LegacyCourse, "id" | "code" | "name"> | null;
  admissionDate: string | null;
  legacyStatusInput: string | null;
  mappedStudentStatus: "active" | "on_hold" | "alumni" | null;
  mappedEnrolmentStatus: "active" | "on_hold" | "completed" | null;
  studentClassification: "CURRENT" | "ALUMNI" | null;
  personMatchStatus: "new_person" | "exact_existing_match" | "shared_contact_new_person" | "possible_match_review" | "not_checked";
  matchedPersonId: string | null;
  validationStatus: "valid" | "review" | "error";
  validationSeverity: "info" | "warning" | "error";
  validationCodes: string[];
};

export type LegacyImportResult = {
  batch: {
    sourceFileName: string;
    sourceChecksum: string;
    organisationId: string;
    branchCode: string;
    mode: "dry_run" | "preflight" | "apply";
  };
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    reviewRows: number;
    proposedPersonCount: number;
    proposedEnrolmentCount: number;
    newPersonCount: number;
    existingPersonMatchCount: number;
    sharedContactNewPersonCount: number;
    possibleMatchReviewCount: number;
    currentStudentCount: number;
    alumniStudentCount: number;
  };
  rows: LegacyImportRow[];
};

const DEFAULT_COURSE_ROWS: Array<[string, string, string, string, number]> = [
  ["course_syk_mscit_001", "SYK-MSCIT-001", "MS CIT", "MSCIT", 2],
  ["course_syk_ccc_001", "SYK-CCC-001", "CCC", "CCC", 2],
  ["course_syk_ccc_002", "SYK-CCC-002", "CCC+", "CCC", 2],
  ["course_syk_mso_001", "SYK-MSO-001", "MS OFFICE", "MSO", 1.5],
  ["course_syk_aex_001", "SYK-AEX-001", "ADVANCED EXCEL", "AEX", 1],
  ["course_syk_tly_001", "SYK-TLY-001", "BASIC TALLY", "TLY", 1],
  ["course_syk_tly_002", "SYK-TLY-002", "TALLY WITH TAX", "TLY", 2],
  ["course_syk_tly_003", "SYK-TLY-003", "CAP - TALLY WITH TAX AND MS OFFICE", "TLY", 3],
  ["course_syk_dmk_001", "SYK-DMK-001", "DIGITAL MARKETING WITH AI TOOLS", "DMK", 3],
  ["course_syk_dmk_002", "SYK-DMK-002", "DIGITAL MARKETING WITH WORDPRESS", "DMK", 4],
  ["course_syk_dmk_003", "SYK-DMK-003", "WORDPRESS", "DMK", 1],
  ["course_syk_dmk_004", "SYK-DMK-004", "SHOPIFY", "DMK", 1.5],
  ["course_syk_dmk_005", "SYK-DMK-005", "ECOMMERCE", "DMK", 2],
  ["course_syk_dmk_006", "SYK-DMK-006", "META ADS", "DMK", 1],
  ["course_syk_dmk_007", "SYK-DMK-007", "SEO", "DMK", 1],
  ["course_syk_dmk_008", "SYK-DMK-008", "GOOGLE ADS", "DMK", 1],
  ["course_syk_dan_001", "SYK-DAN-001", "DATA ANALYTICS - BEGINNER", "DAN", 4],
  ["course_syk_dan_002", "SYK-DAN-002", "DATA ANALYTICS - ADVANCED", "DAN", 6],
  ["course_syk_dan_003", "SYK-DAN-003", "POWER BI", "DAN", 1],
  ["course_syk_wdd_001", "SYK-WDD-001", "FULL STACK COURSE - 6 MONTHS", "WDD", 6],
  ["course_syk_wdd_002", "SYK-WDD-002", "HTML", "WDD", 1],
  ["course_syk_wdd_003", "SYK-WDD-003", "CSS", "WDD", 1],
  ["course_syk_wdd_004", "SYK-WDD-004", "JAVA", "WDD", 1],
  ["course_syk_wdd_005", "SYK-WDD-005", "PYTHON & WEB DESIGN", "WDD", 3],
  ["course_syk_wdd_006", "SYK-WDD-006", "REACT, NODE.JS WITH MONGO DB", "WDD", 4],
  ["course_syk_wdd_007", "SYK-WDD-007", "UI UX", "WDD", 2],
  ["course_syk_gds_001", "SYK-GDS-001", "GRAPHIC DESIGN DIPLOMA", "GDS", 4],
  ["course_syk_gds_002", "SYK-GDS-002", "CORELDRAW", "GDS", 1],
  ["course_syk_gds_003", "SYK-GDS-003", "ADOBE PHOTOSHOP", "GDS", 1],
  ["course_syk_gds_004", "SYK-GDS-004", "ADOBE ILLUSTRATOR", "GDS", 1.5],
  ["course_syk_gds_005", "SYK-GDS-005", "CANVA", "GDS", 1],
  ["course_syk_ved_001", "SYK-VED-001", "FILMORA", "VED", 1],
  ["course_syk_ved_002", "SYK-VED-002", "ADOBE PREMIERE PRO", "VED", 2],
  ["course_syk_avx_001", "SYK-AVX-001", "ADOBE ANIMATE", "AVX", 1.5],
  ["course_syk_dsai_001", "SYK-DSAI-001", "AI TOOLS & PROMPTING", "DSAI", 1],
  ["course_syk_dsai_002", "SYK-DSAI-002", "DIPLOMA IN MACHINE LEARNING", "DSAI", 3],
  ["course_syk_dsai_003", "SYK-DSAI-003", "PYTHON - BEGINNER", "DSAI", 1],
  ["course_syk_dsai_004", "SYK-DSAI-004", "PYTHON - ADVANCED", "DSAI", 2],
  ["course_syk_dsai_005", "SYK-DSAI-005", "R PROGRAMMING LANGUAGE", "DSAI", 1.5],
  ["course_syk_civ_001", "SYK-CIV-001", "PRIMAVERA", "CIV", 2],
  ["course_syk_civ_002", "SYK-CIV-002", "MS PROJECT", "CIV", 1],
  ["course_syk_sft_001", "SYK-SFT-001", "SPOKEN ENGLISH", "SFT", 1.5],
];

export const DEFAULT_LEGACY_COURSES: LegacyCourse[] = DEFAULT_COURSE_ROWS.map(([id, code, name, categoryCode, durationMonths]) => ({ id, code, name, categoryCode, durationMonths }));

const COURSE_ALIASES = new Map([
  ["ADVANCE EXCEL", "ADVANCED EXCEL"],
  ["ADVANCED EXCEL", "ADVANCED EXCEL"],
  ["SPOKEN ENGLISH", "SPOKEN ENGLISH"],
  ["SPOKEN ENGLISH COURSE", "SPOKEN ENGLISH"],
  ["MS-CIT", "MS CIT"],
  ["MSCIT", "MS CIT"],
]);

export type ParsedRow = {
  sourceRowNumber: number;
  values: Record<string, string>;
};

export type InternalLegacyImportRow = LegacyImportRow & {
  normalizedName: string | null;
  normalizedMobile: string | null;
};

export type LegacyImportPlan = {
  batch: LegacyImportResult["batch"];
  rows: InternalLegacyImportRow[];
};

export function analyzeLegacyImportCsv(csvText: string, options: LegacyImportOptions = {}): LegacyImportResult {
  const plan = analyzeLegacyImportPlan(csvText, options);
  const rows = plan.rows;
  const publicRows = rows.map(({ normalizedMobile: _mobile, normalizedName: _name, ...row }) => row);
  const uniqueValidPersonKeys = new Set(rows.filter((row) => row.validationStatus !== "error" && row.normalizedName && row.normalizedMobile).map((row) => `${row.normalizedName}|${row.normalizedMobile}`));
  const uniqueCurrentPersonKeys = new Set(rows.filter((row) => row.studentClassification === "CURRENT" && row.normalizedName && row.normalizedMobile).map((row) => `${row.normalizedName}|${row.normalizedMobile}`));
  const uniqueAlumniPersonKeys = new Set(rows.filter((row) => row.studentClassification === "ALUMNI" && row.normalizedName && row.normalizedMobile && !uniqueCurrentPersonKeys.has(`${row.normalizedName}|${row.normalizedMobile}`)).map((row) => `${row.normalizedName}|${row.normalizedMobile}`));

  return {
    batch: plan.batch,
    summary: {
      totalRows: rows.length,
      validRows: rows.filter((row) => row.validationStatus !== "error").length,
      errorRows: rows.filter((row) => row.validationStatus === "error").length,
      reviewRows: rows.filter((row) => row.validationStatus === "review").length,
      proposedPersonCount: uniqueValidPersonKeys.size,
      proposedEnrolmentCount: rows.filter((row) => row.validationStatus !== "error").length,
      newPersonCount: countUniquePeopleByMatchStatus(rows, "new_person"),
      existingPersonMatchCount: countUniquePeopleByMatchStatus(rows, "exact_existing_match"),
      sharedContactNewPersonCount: countUniquePeopleByMatchStatus(rows, "shared_contact_new_person"),
      possibleMatchReviewCount: countUniquePeopleByMatchStatus(rows, "possible_match_review"),
      currentStudentCount: uniqueCurrentPersonKeys.size,
      alumniStudentCount: uniqueAlumniPersonKeys.size,
    },
    rows: publicRows,
  };
}

export function analyzeLegacyImportPlan(csvText: string, options: LegacyImportOptions = {}): LegacyImportPlan {
  const parsed = parseLegacyCsv(csvText);
  assertRequiredHeaders(parsed.headers);

  const sourceChecksum = sha256(csvText);
  const catalog = buildCourseIndexes(options.courseCatalog || DEFAULT_LEGACY_COURSES);
  const rows: InternalLegacyImportRow[] = parsed.rows.map((parsedRow) => analyzeRow(parsedRow, catalog));
  assignPersonMatches(rows, options.existingPeople || []);
  assignProposedStudentOrder(rows);

  return {
    batch: {
      sourceFileName: options.sourceFileName || "legacy-students.csv",
      sourceChecksum,
      organisationId: options.organisationId || "org_samyak",
      branchCode: options.branchCode || "SION",
      mode: "dry_run",
    },
    rows,
  };
}

function countUniquePeopleByMatchStatus(rows: InternalLegacyImportRow[], status: LegacyImportRow["personMatchStatus"]) {
  return new Set(rows
    .filter((row) => row.validationStatus !== "error" && row.personMatchStatus === status && row.normalizedName && row.normalizedMobile)
    .map((row) => `${row.normalizedName}|${row.normalizedMobile}`)).size;
}

export function parseLegacyCsv(csvText: string): { headers: string[]; rows: ParsedRow[] } {
  const table = parseCsv(csvText.replace(/^\uFEFF/, ""));
  if (table.length === 0) throw new Error("CSV file is empty.");
  const headers = table[0].map(normalizeHeader);
  const rows = table.slice(1)
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells, index) => {
      const values: Record<string, string> = {};
      for (let i = 0; i < headers.length; i += 1) values[headers[i]] = cells[i] || "";
      return { sourceRowNumber: index + 2, values };
    });
  return { headers, rows };
}

export function assertRequiredHeaders(headers: string[]) {
  const missing = REQUIRED_LEGACY_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Missing required legacy import columns: ${missing.join(", ")}`);
}

export function normalizePersonName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (/[\u0000-\u001F\u007F]/.test(normalized)) return null;
  if (normalized.length > 140) return null;
  return normalized.toUpperCase();
}

export function normalizeIndianMobile(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const tenDigits = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  if (!/^[6-9]\d{9}$/.test(tenDigits)) return null;
  return `+91${tenDigits}`;
}

export function mapLegacyStatus(value: string): { studentStatus: "active" | "on_hold" | "alumni"; enrolmentStatus: "active" | "on_hold" | "completed"; classification: "CURRENT" | "ALUMNI"; domainStatus: "ONGOING" | "ON_HOLD" | "COMPLETED" } | null {
  const normalized = normalizeHeader(value);
  if (["IN PROGRESS", "IN-PROGRESS", "ONGOING", "ON GOING", "ACTIVE"].includes(normalized)) {
    return { studentStatus: "active", enrolmentStatus: "active", classification: "CURRENT", domainStatus: "ONGOING" };
  }
  if (["ON HOLD", "ON-HOLD", "HOLD"].includes(normalized)) {
    return { studentStatus: "on_hold", enrolmentStatus: "on_hold", classification: "CURRENT", domainStatus: "ON_HOLD" };
  }
  if (["COMPLETED", "COMPLETE", "FINISHED"].includes(normalized)) {
    return { studentStatus: "alumni", enrolmentStatus: "completed", classification: "ALUMNI", domainStatus: "COMPLETED" };
  }
  return null;
}

export function resolveLegacyCourse(input: string, catalog: LegacyCourse[] = DEFAULT_LEGACY_COURSES): LegacyCourse | null {
  const indexes = buildCourseIndexes(catalog);
  return resolveCourse(input, indexes);
}

export function buildPrivacySafeReport(result: LegacyImportResult) {
  return {
    batch: result.batch,
    summary: result.summary,
    rows: result.rows.map((row) => ({
      sourceRowNumber: row.sourceRowNumber,
      legacyStudentRef: row.legacyStudentRef,
      legacyEnrolmentRef: row.legacyEnrolmentRef,
      proposedStudentOrder: row.proposedStudentOrder,
      maskedMobile: row.maskedMobile,
      nameFingerprint: row.nameFingerprint,
      courseInput: row.courseInput,
      resolvedCourse: row.resolvedCourse,
      admissionDate: row.admissionDate,
      mappedStudentStatus: row.mappedStudentStatus,
      mappedEnrolmentStatus: row.mappedEnrolmentStatus,
      studentClassification: row.studentClassification,
      personMatchStatus: row.personMatchStatus,
      matchedPersonId: row.matchedPersonId,
      validationStatus: row.validationStatus,
      validationSeverity: row.validationSeverity,
      validationCodes: row.validationCodes,
    })),
    writeOperationsPerformed: false,
  };
}

function analyzeRow(parsedRow: ParsedRow, catalog: ReturnType<typeof buildCourseIndexes>): InternalLegacyImportRow {
  const nameInput = value(parsedRow, "STUDENT FULL NAME");
  const mobileInput = value(parsedRow, "PRIMARY MOBILE NUMBER");
  const courseInput = value(parsedRow, "COURSE ENROLLMENT");
  const admissionDateInput = value(parsedRow, "ADMISSION DATE");
  const statusInput = value(parsedRow, "COURSE STATUS");
  const validationCodes: string[] = [];

  const normalizedName = normalizePersonName(nameInput);
  if (!normalizedName) validationCodes.push("INVALID_NAME");
  if (hasFormulaPrefix(nameInput) || hasFormulaPrefix(courseInput) || hasFormulaPrefix(statusInput)) validationCodes.push("FORMULA_LIKE_VALUE");

  const normalizedMobile = normalizeIndianMobile(mobileInput);
  if (!normalizedMobile) validationCodes.push("INVALID_MOBILE");

  const resolvedCourse = resolveCourse(courseInput, catalog);
  if (!resolvedCourse) validationCodes.push("UNRESOLVED_COURSE");

  const admissionDate = parseAdmissionDate(admissionDateInput);
  if (!admissionDate) validationCodes.push("INVALID_ADMISSION_DATE");

  const mapped = mapLegacyStatus(statusInput);
  if (!mapped) validationCodes.push("UNRESOLVED_STATUS");

  const severity = validationCodes.some((code) => code !== "FORMULA_LIKE_VALUE") ? "error" : validationCodes.length ? "warning" : "info";
  const validationStatus = severity === "error" ? "error" : severity === "warning" ? "review" : "valid";
  const identitySeed = `${normalizedName || "no-name"}:${normalizedMobile || "no-mobile"}`;
  const courseSeed = resolvedCourse?.code || normalizeCourseKey(courseInput || "unresolved-course");
  const rowSeed = `${identitySeed}:${courseSeed}:${admissionDate || admissionDateInput || "no-date"}`;

  return {
    sourceRowNumber: parsedRow.sourceRowNumber,
    legacyStudentRef: `LEG-STU-${sha256(identitySeed).slice(0, 12).toUpperCase()}`,
    legacyEnrolmentRef: `LEG-ENR-${sha256(rowSeed).slice(0, 12).toUpperCase()}`,
    proposedStudentOrder: null,
    maskedMobile: normalizedMobile ? maskMobile(normalizedMobile) : null,
    nameFingerprint: normalizedName ? sha256(normalizedName).slice(0, 12) : null,
    normalizedName,
    normalizedMobile,
    courseInput: courseInput || null,
    resolvedCourse: resolvedCourse ? { id: resolvedCourse.id, code: resolvedCourse.code, name: resolvedCourse.name } : null,
    admissionDate,
    legacyStatusInput: statusInput || null,
    mappedStudentStatus: mapped?.studentStatus || null,
    mappedEnrolmentStatus: mapped?.enrolmentStatus || null,
    studentClassification: mapped?.classification || null,
    personMatchStatus: "not_checked",
    matchedPersonId: null,
    validationStatus,
    validationSeverity: severity,
    validationCodes,
  };
}

function assignPersonMatches(rows: InternalLegacyImportRow[], existingPeople: ExistingPersonCandidate[]) {
  const byMobile = new Map<string, ExistingPersonCandidate[]>();
  for (const candidate of existingPeople) {
    const normalizedMobile = candidate.mobileNormalized ? normalizeIndianMobile(candidate.mobileNormalized) : null;
    const mobileKey = normalizedMobile || candidate.mobileHash || null;
    if (!mobileKey) continue;
    const candidates = byMobile.get(mobileKey) || [];
    candidates.push({ ...candidate, fullName: normalizePersonName(candidate.fullName) || candidate.fullName });
    byMobile.set(mobileKey, candidates);
  }

  const sourceNamesByMobile = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.normalizedMobile && row.normalizedName) {
      if (!sourceNamesByMobile.has(row.normalizedMobile)) sourceNamesByMobile.set(row.normalizedMobile, new Set());
      sourceNamesByMobile.get(row.normalizedMobile)!.add(row.normalizedName);
    }
  }

  for (const row of rows) {
    if (row.validationStatus === "error" || !row.normalizedMobile || !row.normalizedName) {
      row.personMatchStatus = "not_checked";
      continue;
    }
    const candidates = byMobile.get(row.normalizedMobile) || [];
    const exact = candidates.find((candidate) => normalizePersonName(candidate.fullName) === row.normalizedName);
    if (exact) {
      row.personMatchStatus = "exact_existing_match";
      row.matchedPersonId = exact.personId;
      continue;
    }
    if (candidates.length === 0) {
      row.personMatchStatus = "new_person";
      continue;
    }
    const hasExactForAnotherSourceName = [...(sourceNamesByMobile.get(row.normalizedMobile) || [])].some((name) =>
      candidates.some((candidate) => normalizePersonName(candidate.fullName) === name),
    );
    row.personMatchStatus = hasExactForAnotherSourceName ? "shared_contact_new_person" : "possible_match_review";
    if (row.personMatchStatus === "possible_match_review") {
      row.validationStatus = "review";
      row.validationSeverity = "warning";
      row.validationCodes = [...new Set([...row.validationCodes, "POSSIBLE_EXISTING_PERSON_MATCH"])];
    }
  }
}

function assignProposedStudentOrder(rows: InternalLegacyImportRow[]) {
  const groups = new Map<string, InternalLegacyImportRow[]>();
  for (const row of rows) {
    if (row.validationStatus === "error" || !row.normalizedName || !row.normalizedMobile) continue;
    const key = `${row.normalizedName}|${row.normalizedMobile}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const orderedGroups = [...groups.values()].sort((left, right) => {
    const leftFirst = earliestDate(left);
    const rightFirst = earliestDate(right);
    return leftFirst.localeCompare(rightFirst) || Math.min(...left.map((row) => row.sourceRowNumber)) - Math.min(...right.map((row) => row.sourceRowNumber));
  });
  orderedGroups.forEach((group, index) => {
    for (const row of group) row.proposedStudentOrder = index + 1;
  });
}

function buildCourseIndexes(catalog: LegacyCourse[]) {
  const byCode = new Map<string, LegacyCourse>();
  const byName = new Map<string, LegacyCourse>();
  for (const course of catalog) {
    byCode.set(normalizeHeader(course.code), course);
    byName.set(normalizeCourseKey(course.name), course);
  }
  return { byCode, byName };
}

function resolveCourse(input: string, catalog: ReturnType<typeof buildCourseIndexes>): LegacyCourse | null {
  const code = normalizeHeader(input);
  if (catalog.byCode.has(code)) return catalog.byCode.get(code)!;
  const courseKey = normalizeCourseKey(input);
  const alias = COURSE_ALIASES.get(courseKey) || courseKey;
  return catalog.byName.get(alias) || null;
}

function normalizeCourseKey(value: string) {
  return value.toUpperCase().trim().replace(/\s+/g, " ");
}

function normalizeHeader(value: string) {
  return value.toUpperCase().trim().replace(/\s+/g, " ");
}

function value(row: ParsedRow, header: string) {
  return (row.values[header] || "").trim();
}

function hasFormulaPrefix(value: string) {
  return /^[=+@]/.test(value.trim());
}

function parseAdmissionDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return validIsoDate(trimmed) ? trimmed : null;
  const slash = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const [, day, month, year] = slash;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return validIsoDate(iso) ? iso : null;
  }
  if (/^\d{5}$/.test(trimmed)) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Number(trimmed) * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function validIsoDate(iso: string) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

function earliestDate(rows: InternalLegacyImportRow[]) {
  return rows.map((row) => row.admissionDate || "9999-12-31").sort()[0];
}

function maskMobile(normalizedMobile: string) {
  return `******${normalizedMobile.slice(-4)}`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  row.push(cell.replace(/\r$/, ""));
  rows.push(row);
  return rows;
}
