/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RemoteD1Client, WranglerRemoteD1Client } from "./legacy-import-remote-preflight.ts";
import { PRODUCTION_DEMO_DATABASE, type RemoteD1WriteClient } from "./organisation-demo-maintenance.ts";

export const DEMO_CORE_V1_SEED_VERSION = "demo-core-v1";
export const DEMO_DATA_AUDIT_ACTION = "demo_data_seeded";

const TARGET_OWNER = {
  organisationId: "org_88ee748d08a14eb1b5201ca88edfa07e",
  organisationName: "Demo Training Institute",
  centreId: "branch_01477474b96d4a9eb3e6bade61c7c035",
  centreName: "Main Centre",
  loginAccountId: "acct_b2c2779f27eb48bd8ed2241bdc3b38c5",
  personId: "person_e76887f2bcb04cef9705d3d95a09f947",
  membershipId: "omem_2afd8d508ba54e059f7685445f06617f",
};

export type DemoDataMaintenanceArgs = {
  remote: boolean;
  preflight: boolean;
  apply: boolean;
  confirmApply: boolean;
  confirmProductionDemoData: boolean;
  organisationId: string;
  expectedName: string;
  expectedCentre: string;
  seedVersion: string;
  reason: string;
  databaseName: string;
  now?: string;
};

export type DemoDataSeedStatus = "READY" | "ALREADY_SEEDED" | "BLOCKED";

export type DemoDataCounts = ReturnType<typeof demoDataCounts>;

export type DemoDataPreflightReport = {
  mode: "remote_preflight";
  status: DemoDataSeedStatus;
  code: string;
  seedVersion: string;
  writeOperationsPerformed: false;
  target: {
    organisationId: string;
    organisationName: string;
    organisationKind: string;
    organisationStatus: string;
    centreId: string;
    centreName: string;
    ownerShellIntact: boolean;
  } | null;
  seedState: {
    deterministicRowsPresent: number;
    deterministicRowsExpected: number;
    seedAuditRows: number;
    unknownOperationalRows: number;
    financialRows: Record<string, number>;
  };
  plannedCounts: DemoDataCounts;
  zeroWriteProof: {
    queries: number;
    changedDbFalse: boolean;
    rowsWritten: number;
  };
};

export type DemoDataApplyReport = {
  mode: "remote_apply";
  status: "APPLIED" | "ALREADY_SEEDED";
  code: string;
  seedVersion: string;
  remoteWriteExecuted: boolean;
  remoteWriteModel: "d1_execute_file_guarded_batch";
  preflight: DemoDataPreflightReport;
  postflight: DemoDataPreflightReport;
};

type SeedRow = {
  table: string;
  id: string;
};

type DemoDataset = {
  now: string;
  config: {
    admissionOptions: Array<[string, string, string, string, number, number]>;
    paymentRules: Array<[string, number, number | null, string, number | null]>;
  };
  roles: Array<[string, string, string]>;
  categories: Array<[string, string, string, number]>;
  courses: Array<[string, string, string, string, string, number, number, number]>;
  trainers: Array<[string, string, string, string]>;
  enquiryPeople: Array<[string, string, string, string, string]>;
  enquiries: Array<[string, string, string, string, string, string, string, string, string, string | null, string | null, string | null, string | null]>;
  followUpEvents: Array<[string, string, string, string, string | null, string, string | null, string]>;
  students: Array<[string, string, string, string, string, string, number, string, string, string, string]>;
  enrolments: Array<[string, string, string, string | null, string, string, string, string, string | null]>;
  batches: Array<[string, string, string, string, string, string, string, number, string]>;
  batchCourses: Array<[string, string]>;
  memberships: Array<[string, string, string, string, string | null, string]>;
  sessions: Array<[string, string, string, string, string, string, string, string, string]>;
  attendance: Array<[string, string, string, string, string, string]>;
};

const FINANCIAL_TABLES = [
  "receipts",
  "receipt_reversals",
  "fee_agreements",
  "fee_agreement_instalments",
  "collection_followups",
  "admission_discount_approvals",
] as const;

const FORBIDDEN_WRITE_TABLES = new Set<string>(FINANCIAL_TABLES);

export function validateDemoDataMaintenanceRequest(input: DemoDataMaintenanceArgs) {
  if (!input.remote) throw new Error("Demo data maintenance requires --remote.");
  if (input.preflight === input.apply) throw new Error("Use exactly one of --preflight or --apply.");
  if (input.databaseName !== PRODUCTION_DEMO_DATABASE) throw new Error(`Demo data maintenance is locked to D1 database ${PRODUCTION_DEMO_DATABASE}.`);
  if (input.organisationId !== TARGET_OWNER.organisationId) throw new Error("Demo data maintenance is locked to the controlled Demo Training Institute Organisation.");
  if (input.expectedName !== TARGET_OWNER.organisationName) throw new Error("Missing or incorrect --expected-name for Demo Training Institute.");
  if (input.expectedCentre !== TARGET_OWNER.centreId && input.expectedCentre !== TARGET_OWNER.centreName) {
    throw new Error("Missing or incorrect --expected-centre for Demo Training Institute.");
  }
  if (input.seedVersion !== DEMO_CORE_V1_SEED_VERSION) throw new Error(`Unsupported --seed-version. Expected ${DEMO_CORE_V1_SEED_VERSION}.`);
  if (input.apply) {
    if (!input.confirmApply || !input.confirmProductionDemoData) {
      throw new Error("Remote demo data apply requires --remote --apply --confirm-apply --confirm-production-demo-data.");
    }
    if (!input.reason.trim()) throw new Error("Missing --reason.");
  }
}

export async function buildRemotePreflightDemoData(
  client: RemoteD1Client,
  options: Pick<DemoDataMaintenanceArgs, "organisationId" | "expectedName" | "expectedCentre" | "seedVersion" | "now">,
): Promise<DemoDataPreflightReport> {
  const dataset = buildDemoCoreV1Dataset(options.now || new Date().toISOString());
  const queryMetas: Array<{ changed_db?: boolean; changes?: number; rows_written?: number }> = [];
  const execute = async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string) => {
    const result = await client.execute<T>(sql);
    queryMetas.push(result.meta);
    return result.results;
  };

  const target = await loadTarget(execute, options);
  const financialRows = await loadFinancialCounts(execute, options.organisationId);
  const deterministicRowsPresent = await countDeterministicRows(execute, dataset);
  const unknownOperationalRows = await countUnknownOperationalRows(execute, dataset, options.organisationId);
  const seedAuditRows = await countSeedAuditRows(execute, options.organisationId, options.seedVersion);

  const reportBase = {
    mode: "remote_preflight" as const,
    seedVersion: options.seedVersion,
    writeOperationsPerformed: false as const,
    target,
    seedState: {
      deterministicRowsPresent,
      deterministicRowsExpected: deterministicSeedRows(dataset).length,
      seedAuditRows,
      unknownOperationalRows,
      financialRows,
    },
    plannedCounts: demoDataCounts(dataset),
    zeroWriteProof: {
      queries: queryMetas.length,
      changedDbFalse: queryMetas.every((meta) => meta.changed_db === false),
      rowsWritten: queryMetas.reduce((sum, meta) => sum + Number(meta.rows_written || meta.changes || 0), 0),
    },
  };

  if (!target) return { ...reportBase, status: "BLOCKED", code: "ORGANISATION_NOT_FOUND" };
  if (target.organisationId === "org_samyak") return { ...reportBase, status: "BLOCKED", code: "SAMYAK_TARGET_BLOCKED" };
  if (target.organisationName !== options.expectedName) return { ...reportBase, status: "BLOCKED", code: "EXPECTED_NAME_MISMATCH" };
  if (target.organisationStatus !== "active") return { ...reportBase, status: "BLOCKED", code: "ORGANISATION_NOT_ACTIVE" };
  if (target.organisationKind !== "demo") return { ...reportBase, status: "BLOCKED", code: "ORGANISATION_NOT_DEMO" };
  if (target.centreId !== TARGET_OWNER.centreId || target.centreName !== TARGET_OWNER.centreName) return { ...reportBase, status: "BLOCKED", code: "EXPECTED_CENTRE_MISMATCH" };
  if (!target.ownerShellIntact) return { ...reportBase, status: "BLOCKED", code: "OWNER_SHELL_BROKEN" };
  if (unknownOperationalRows > 0) return { ...reportBase, status: "BLOCKED", code: "UNRELATED_EXISTING_DATA" };
  if (deterministicRowsPresent === deterministicSeedRows(dataset).length && seedAuditRows === 1) {
    return { ...reportBase, status: "ALREADY_SEEDED", code: "ALREADY_SEEDED" };
  }
  if (deterministicRowsPresent > 0 || seedAuditRows > 0) return { ...reportBase, status: "BLOCKED", code: "BLOCKED_PARTIAL_SEED" };
  return { ...reportBase, status: "READY", code: "READY_FOR_DEMO_CORE_V1" };
}

export async function applyRemoteDemoData(
  client: RemoteD1WriteClient,
  options: Pick<DemoDataMaintenanceArgs, "organisationId" | "expectedName" | "expectedCentre" | "seedVersion" | "reason" | "now">,
): Promise<DemoDataApplyReport> {
  const preflight = await buildRemotePreflightDemoData(client, options);
  if (preflight.status === "ALREADY_SEEDED") {
    return {
      mode: "remote_apply",
      status: "ALREADY_SEEDED",
      code: "ALREADY_SEEDED",
      seedVersion: options.seedVersion,
      remoteWriteExecuted: false,
      remoteWriteModel: "d1_execute_file_guarded_batch",
      preflight,
      postflight: preflight,
    };
  }
  if (preflight.status !== "READY") throw new Error(`Demo data apply blocked: ${preflight.code}.`);
  const dataset = buildDemoCoreV1Dataset(options.now || new Date().toISOString());
  const sql = buildDemoCoreV1ApplySql(dataset, {
    organisationId: options.organisationId,
    expectedName: options.expectedName,
    expectedCentre: options.expectedCentre,
    seedVersion: options.seedVersion,
    reason: options.reason,
  });
  assertNoForbiddenFinancialWrites(sql);
  await client.executeSqlFile(sql);
  const postflight = await buildRemotePreflightDemoData(client, options);
  if (postflight.status !== "ALREADY_SEEDED") throw new Error(`Demo data apply verification failed: ${postflight.code}.`);
  return {
    mode: "remote_apply",
    status: "APPLIED",
    code: "DEMO_CORE_V1_APPLIED",
    seedVersion: options.seedVersion,
    remoteWriteExecuted: true,
    remoteWriteModel: "d1_execute_file_guarded_batch",
    preflight,
    postflight,
  };
}

export function buildDemoCoreV1Dataset(nowIso: string): DemoDataset {
  const now = new Date(nowIso);
  const iso = (days: number) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString();
  };
  const date = (days: number) => iso(days).slice(0, 10);
  const dt = (days: number, hour = 10, minute = 0) => `${date(days)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

  const courses: DemoDataset["courses"] = [
    ["demo_v1_course_excel_power_bi", "demo_v1_cat_data", "DTI-AEPB", "Advanced Excel & Power BI", "4 months", 4, 3500000, 2800000],
    ["demo_v1_course_tally_gst", "demo_v1_cat_accounting", "DTI-TGST", "Tally Prime with GST", "3 months", 3, 2800000, 2200000],
    ["demo_v1_course_digital_marketing", "demo_v1_cat_marketing", "DTI-DMKT", "Digital Marketing", "3 months", 3, 3200000, 2500000],
    ["demo_v1_course_python_full_stack", "demo_v1_cat_development", "DTI-PFSD", "Python Full Stack Development", "6 months", 6, 6000000, 4800000],
    ["demo_v1_course_graphic_design", "demo_v1_cat_design", "DTI-GDES", "Graphic Design Essentials", "3 months", 3, 3000000, 2400000],
  ];

  return {
    now: now.toISOString(),
    config: {
      admissionOptions: [
        ["demo_v1_adopt_lang_english", "preferred_language", "english", "English", 10, 0],
        ["demo_v1_adopt_lang_hindi", "preferred_language", "hindi", "Hindi", 20, 0],
        ["demo_v1_adopt_qual_hsc", "qualification_level", "hsc", "HSC / 12th", 10, 0],
        ["demo_v1_adopt_qual_graduate", "qualification_level", "graduate", "Graduate", 20, 0],
        ["demo_v1_adopt_stream_commerce", "stream", "commerce", "Commerce", 10, 0],
        ["demo_v1_adopt_stream_it", "stream", "it_computer_science", "IT / Computer Science", 20, 0],
        ["demo_v1_adopt_occ_student", "occupation_status", "student", "Student", 10, 0],
        ["demo_v1_adopt_occ_working", "occupation_status", "employed_salaried", "Employed / Salaried", 20, 0],
        ["demo_v1_adopt_batch_evening", "batch_preference", "17_20", "5 PM to 8 PM", 10, 0],
        ["demo_v1_adopt_batch_weekend", "batch_preference", "weekend", "Weekend", 20, 0],
      ],
      paymentRules: [
        ["demo_v1_payrule_short_full", 1, 3, "full", 1],
        ["demo_v1_payrule_short_two", 2, 4, "two_instalments", 2],
        ["demo_v1_payrule_mid_three", 4, 6, "three_instalments", 3],
      ],
    },
    roles: [
      ["demo_v1_role_trainer", "trainer", "Trainer"],
      ["demo_v1_role_student", "student", "Student"],
      ["demo_v1_role_alumni", "alumni", "Alumni"],
    ],
    categories: [
      ["demo_v1_cat_data", "DTI-DATA", "Data & Analytics", 10],
      ["demo_v1_cat_accounting", "DTI-ACCT", "Accounting", 20],
      ["demo_v1_cat_marketing", "DTI-MKT", "Marketing", 30],
      ["demo_v1_cat_development", "DTI-DEV", "Development", 40],
      ["demo_v1_cat_design", "DTI-DES", "Design", 50],
    ],
    courses,
    trainers: [
      ["demo_v1_person_trainer_priya_nair", "Priya Nair", "Priya Nair", "1989-04-12"],
      ["demo_v1_person_trainer_rahul_verma", "Rahul Verma", "Rahul Verma", "1987-09-22"],
      ["demo_v1_person_trainer_meera_shah", "Meera Shah", "Meera Shah", "1991-01-16"],
    ],
    enquiryPeople: [
      ["demo_v1_person_enquiry_01", "Anika Rao", "Anika Rao", "demo_hash_enq_01", "0101"],
      ["demo_v1_person_enquiry_02", "Karan Mehta", "Karan Mehta", "demo_hash_enq_02", "0102"],
      ["demo_v1_person_enquiry_03", "Nisha Iyer", "Nisha Iyer", "demo_hash_enq_03", "0103"],
      ["demo_v1_person_enquiry_04", "Omar Khan", "Omar Khan", "demo_hash_enq_04", "0104"],
      ["demo_v1_person_enquiry_05", "Ritika Sen", "Ritika Sen", "demo_hash_enq_05", "0105"],
      ["demo_v1_person_enquiry_06", "Dev Malhotra", "Dev Malhotra", "demo_hash_enq_06", "0106"],
      ["demo_v1_person_enquiry_07", "Sara Dsouza", "Sara Dsouza", "demo_hash_enq_07", "0107"],
      ["demo_v1_person_enquiry_08", "Ishaan Joshi", "Ishaan Joshi", "demo_hash_enq_08", "0108"],
      ["demo_v1_person_enquiry_09", "Farah Sheikh", "Farah Sheikh", "demo_hash_enq_09", "0109"],
      ["demo_v1_person_enquiry_10", "Manav Desai", "Manav Desai", "demo_hash_enq_10", "0110"],
      ["demo_v1_person_enquiry_11", "Tara Kapoor", "Tara Kapoor", "demo_hash_enq_11", "0111"],
      ["demo_v1_person_enquiry_12", "Neil Fernandes", "Neil Fernandes", "demo_hash_enq_12", "0112"],
    ],
    enquiries: [
      ["demo_v1_enquiry_001", "demo_v1_person_enquiry_01", "DTI-ENQ-0001", "demo_hash_enq_01", courses[0][0], "walk-in", "Centre visit", "new", "new", null, null, date(5), null],
      ["demo_v1_enquiry_002", "demo_v1_person_enquiry_02", "DTI-ENQ-0002", "demo_hash_enq_02", courses[1][0], "website", "Course page", "attempted_contact", "contacting", dt(1, 11), dt(-2, 10), date(10), null],
      ["demo_v1_enquiry_003", "demo_v1_person_enquiry_03", "DTI-ENQ-0003", "demo_hash_enq_03", courses[2][0], "referral", "Student referral", "contacted", "engaged", dt(2, 12), dt(-1, 16), date(12), null],
      ["demo_v1_enquiry_004", "demo_v1_person_enquiry_04", "DTI-ENQ-0004", "demo_hash_enq_04", courses[3][0], "instagram", "Reel campaign", "interested", "considering", dt(3, 15), dt(-3, 15), date(20), null],
      ["demo_v1_enquiry_005", "demo_v1_person_enquiry_05", "DTI-ENQ-0005", "demo_hash_enq_05", courses[4][0], "walk-in", "Portfolio counselling", "demo_scheduled", "engaged", dt(1, 17), dt(-1, 17), date(7), null],
      ["demo_v1_enquiry_006", "demo_v1_person_enquiry_06", "DTI-ENQ-0006", "demo_hash_enq_06", courses[0][0], "website", "Power BI enquiry", "admission_pending", "admission_ready", dt(1, 14), dt(-2, 14), date(3), null],
      ["demo_v1_enquiry_007", "demo_v1_person_enquiry_07", "DTI-ENQ-0007", "demo_hash_enq_07", courses[3][0], "phone", "Inbound call", "follow_up", "deferred", dt(7, 11), dt(-5, 12), date(28), null],
      ["demo_v1_enquiry_008", "demo_v1_person_enquiry_08", "DTI-ENQ-0008", "demo_hash_enq_08", courses[1][0], "website", "GST course", "lost", "lost", null, dt(-10, 12), date(-1), "fee_budget_issue"],
      ["demo_v1_enquiry_009", "demo_v1_person_enquiry_09", "DTI-ENQ-0009", "demo_hash_enq_09", courses[4][0], "facebook", "Lead form", "not_interested", "lost", null, dt(-7, 18), date(-2), "course_not_suitable"],
      ["demo_v1_enquiry_010", "demo_v1_person_enquiry_10", "DTI-ENQ-0010", "demo_hash_enq_10", courses[2][0], "walk-in", "Marketing counselling", "converted", "converted", null, dt(-15, 13), date(-12), null],
      ["demo_v1_enquiry_011", "demo_v1_person_enquiry_11", "DTI-ENQ-0011", "demo_hash_enq_11", courses[0][0], "phone", "Corporate upskilling", "contacted", "engaged", dt(2, 16), dt(-4, 16), date(14), null],
      ["demo_v1_enquiry_012", "demo_v1_person_enquiry_12", "DTI-ENQ-0012", "demo_hash_enq_12", courses[3][0], "website", "Full stack syllabus", "attempted_contact", "contacting", dt(1, 10), dt(-1, 10), date(15), null],
    ],
    followUpEvents: [
      ["demo_v1_enqevt_002_a", "demo_v1_enquiry_002", "call", "call_no_answer", "No answer, retry planned.", dt(-2, 10), dt(1, 11), "contacting"],
      ["demo_v1_enqevt_003_a", "demo_v1_enquiry_003", "whatsapp", "course_details_shared", "Sent digital marketing outline.", dt(-1, 16), dt(2, 12), "engaged"],
      ["demo_v1_enqevt_004_a", "demo_v1_enquiry_004", "call", "fee_discussed", "Interested in weekday evening batch.", dt(-3, 15), dt(3, 15), "considering"],
      ["demo_v1_enqevt_005_a", "demo_v1_enquiry_005", "in_person", "demo_scheduled", "Portfolio demo booked.", dt(-1, 17), dt(1, 17), "engaged"],
      ["demo_v1_enqevt_006_a", "demo_v1_enquiry_006", "call", "batch_discussed", "Ready for admission after documents.", dt(-2, 14), dt(1, 14), "admission_ready"],
      ["demo_v1_enqevt_007_a", "demo_v1_enquiry_007", "call", "deferred_joining", "Planning to join next month.", dt(-5, 12), dt(7, 11), "deferred"],
      ["demo_v1_enqevt_008_a", "demo_v1_enquiry_008", "call", "not_interested", "Budget mismatch.", dt(-10, 12), null, "lost"],
      ["demo_v1_enqevt_009_a", "demo_v1_enquiry_009", "whatsapp", "not_interested", "Course not suitable.", dt(-7, 18), null, "lost"],
      ["demo_v1_enqevt_010_a", "demo_v1_enquiry_010", "in_person", "demo_completed", "Converted after counselling.", dt(-15, 13), null, "converted"],
      ["demo_v1_enqevt_011_a", "demo_v1_enquiry_011", "call", "course_details_shared", "Asked for Power BI project examples.", dt(-4, 16), dt(2, 16), "engaged"],
      ["demo_v1_enqevt_012_a", "demo_v1_enquiry_012", "call", "call_no_answer", "First attempt.", dt(-1, 10), dt(1, 10), "contacting"],
    ],
    students: [
      ["demo_v1_person_student_01", "demo_v1_student_01", "Aarav Kulkarni", "Aarav Kulkarni", "demo_hash_stu_01", "1101", 1, "DTI-STU-0001", date(-90), "active", "2001-03-08"],
      ["demo_v1_person_student_02", "demo_v1_student_02", "Maya Thomas", "Maya Thomas", "demo_hash_stu_02", "1102", 2, "DTI-STU-0002", date(-75), "active", "2000-11-19"],
      ["demo_v1_person_student_03", "demo_v1_student_03", "Kabir Sethi", "Kabir Sethi", "demo_hash_stu_03", "1103", 3, "DTI-STU-0003", date(-60), "active", "1999-07-24"],
      ["demo_v1_person_student_04", "demo_v1_student_04", "Zoya Mirza", "Zoya Mirza", "demo_hash_stu_04", "1104", 4, "DTI-STU-0004", date(-55), "active", "2002-02-05"],
      ["demo_v1_person_student_05", "demo_v1_student_05", "Vivaan Shah", "Vivaan Shah", "demo_hash_stu_05", "1105", 5, "DTI-STU-0005", date(-45), "active", "2001-12-12"],
      ["demo_v1_person_student_06", "demo_v1_student_06", "Ira Banerjee", "Ira Banerjee", "demo_hash_stu_06", "1106", 6, "DTI-STU-0006", date(-35), "active", "2003-05-21"],
      ["demo_v1_person_student_07", "demo_v1_student_07", "Rohan Menon", "Rohan Menon", "demo_hash_stu_07", "1107", 7, "DTI-STU-0007", date(-240), "alumni", "1998-10-03"],
      ["demo_v1_person_student_08", "demo_v1_student_08", "Diya Patel", "Diya Patel", "demo_hash_stu_08", "1108", 8, "DTI-STU-0008", date(-220), "completed", "1997-06-29"],
    ],
    enrolments: [
      ["demo_v1_enrolment_01", "demo_v1_student_01", courses[0][0], null, "DTI-ENR-0001", date(-90), date(-88), date(35), null],
      ["demo_v1_enrolment_02", "demo_v1_student_02", courses[1][0], null, "DTI-ENR-0002", date(-75), date(-73), date(20), null],
      ["demo_v1_enrolment_03", "demo_v1_student_03", courses[2][0], "demo_v1_enquiry_010", "DTI-ENR-0003", date(-60), date(-58), date(40), null],
      ["demo_v1_enrolment_04", "demo_v1_student_04", courses[3][0], null, "DTI-ENR-0004", date(-55), date(-54), date(120), null],
      ["demo_v1_enrolment_05", "demo_v1_student_05", courses[4][0], null, "DTI-ENR-0005", date(-45), date(-44), date(50), null],
      ["demo_v1_enrolment_06", "demo_v1_student_06", courses[0][0], null, "DTI-ENR-0006", date(-35), date(-34), date(55), null],
      ["demo_v1_enrolment_07", "demo_v1_student_07", courses[1][0], null, "DTI-ENR-0007", date(-240), date(-238), date(-120), date(-125)],
      ["demo_v1_enrolment_08", "demo_v1_student_08", courses[4][0], null, "DTI-ENR-0008", date(-220), date(-218), date(-100), date(-104)],
    ],
    batches: [
      ["demo_v1_batch_excel_evening", courses[0][0], "Excel & Power BI Evening", "demo_v1_person_trainer_priya_nair", "[\"mon\",\"wed\",\"fri\"]", "18:00", "20:00", 18, "active"],
      ["demo_v1_batch_tally_morning", courses[1][0], "Tally GST Morning", "demo_v1_person_trainer_rahul_verma", "[\"tue\",\"thu\",\"sat\"]", "09:00", "11:00", 16, "active"],
      ["demo_v1_batch_full_stack", courses[3][0], "Python Full Stack Weekday", "demo_v1_person_trainer_meera_shah", "[\"mon\",\"tue\",\"thu\"]", "16:00", "18:00", 20, "active"],
      ["demo_v1_batch_design_completed", courses[4][0], "Graphic Design Alumni Batch", "demo_v1_person_trainer_meera_shah", "[\"sat\",\"sun\"]", "11:30", "13:30", 12, "completed"],
    ],
    batchCourses: [
      ["demo_v1_batch_excel_evening", courses[0][0]],
      ["demo_v1_batch_tally_morning", courses[1][0]],
      ["demo_v1_batch_full_stack", courses[3][0]],
      ["demo_v1_batch_full_stack", courses[2][0]],
      ["demo_v1_batch_design_completed", courses[4][0]],
    ],
    memberships: [
      ["demo_v1_batchmem_01", "demo_v1_batch_excel_evening", "demo_v1_enrolment_01", date(-80), null, "active"],
      ["demo_v1_batchmem_02", "demo_v1_batch_tally_morning", "demo_v1_enrolment_02", date(-70), null, "active"],
      ["demo_v1_batchmem_03", "demo_v1_batch_full_stack", "demo_v1_enrolment_03", date(-50), null, "active"],
      ["demo_v1_batchmem_04", "demo_v1_batch_full_stack", "demo_v1_enrolment_04", date(-48), null, "active"],
      ["demo_v1_batchmem_05", "demo_v1_batch_design_completed", "demo_v1_enrolment_05", date(-40), null, "active"],
      ["demo_v1_batchmem_06", "demo_v1_batch_excel_evening", "demo_v1_enrolment_06", date(-30), null, "active"],
      ["demo_v1_batchmem_07", "demo_v1_batch_tally_morning", "demo_v1_enrolment_07", date(-230), date(-126), "completed"],
      ["demo_v1_batchmem_08", "demo_v1_batch_design_completed", "demo_v1_enrolment_08", date(-210), date(-105), "completed"],
    ],
    sessions: [
      ["demo_v1_session_01", "demo_v1_batch_excel_evening", "demo_v1_person_trainer_priya_nair", date(-14), "18:00", "20:00", dt(-14, 18), dt(-14, 20), "Pivot tables and dashboard layout"],
      ["demo_v1_session_02", "demo_v1_batch_tally_morning", "demo_v1_person_trainer_rahul_verma", date(-13), "09:00", "11:00", dt(-13, 9), dt(-13, 11), "GST ledger practice"],
      ["demo_v1_session_03", "demo_v1_batch_full_stack", "demo_v1_person_trainer_meera_shah", date(-12), "16:00", "18:00", dt(-12, 16), dt(-12, 18), "Python functions and API basics"],
      ["demo_v1_session_04", "demo_v1_batch_design_completed", "demo_v1_person_trainer_meera_shah", date(-110), "11:30", "13:30", dt(-110, 11), dt(-110, 13), "Portfolio review"],
      ["demo_v1_session_05", "demo_v1_batch_excel_evening", "demo_v1_person_trainer_priya_nair", date(-9), "18:00", "20:00", dt(-9, 18), dt(-9, 20), "Power Query cleanup"],
      ["demo_v1_session_06", "demo_v1_batch_tally_morning", "demo_v1_person_trainer_rahul_verma", date(-8), "09:00", "11:00", dt(-8, 9), dt(-8, 11), "Purchase and sales vouchers"],
      ["demo_v1_session_07", "demo_v1_batch_full_stack", "demo_v1_person_trainer_meera_shah", date(-7), "16:00", "18:00", dt(-7, 16), dt(-7, 18), "React component practice"],
      ["demo_v1_session_08", "demo_v1_batch_excel_evening", "demo_v1_person_trainer_priya_nair", date(-4), "18:00", "20:00", dt(-4, 18), dt(-4, 20), "Power BI relationships"],
      ["demo_v1_session_09", "demo_v1_batch_tally_morning", "demo_v1_person_trainer_rahul_verma", date(-3), "09:00", "11:00", dt(-3, 9), dt(-3, 11), "GST returns overview"],
      ["demo_v1_session_10", "demo_v1_batch_full_stack", "demo_v1_person_trainer_meera_shah", date(-2), "16:00", "18:00", dt(-2, 16), dt(-2, 18), "Express routing workshop"],
      ["demo_v1_session_11", "demo_v1_batch_full_stack", "demo_v1_person_trainer_meera_shah", date(-6), "16:00", "18:00", dt(-6, 16), dt(-6, 18), "Database joins and reporting"],
      ["demo_v1_session_12", "demo_v1_batch_full_stack", "demo_v1_person_trainer_meera_shah", date(-5), "16:00", "18:00", dt(-5, 16), dt(-5, 18), "Authentication flow practice"],
      ["demo_v1_session_13", "demo_v1_batch_excel_evening", "demo_v1_person_trainer_priya_nair", date(-1), "18:00", "20:00", dt(-1, 18), dt(-1, 20), "Dashboard publishing review"],
    ],
    attendance: [],
  };
}

export function buildDemoCoreV1ApplySql(dataset: DemoDataset, input: {
  organisationId: string;
  expectedName: string;
  expectedCentre: string;
  seedVersion: string;
  reason: string;
}) {
  const org = input.organisationId;
  const centre = TARGET_OWNER.centreId;
  const now = dataset.now;
  const auditMetadata = JSON.stringify({
    source: "maintenance",
    seedVersion: input.seedVersion,
    reason: input.reason.trim(),
    counts: demoDataCounts(dataset),
  });
  const guard = `exists (select 1 from organisations join branches on branches.organisation_id = organisations.id where organisations.id = ${q(org)} and organisations.name = ${q(input.expectedName)} and organisations.status = 'active' and organisations.organisation_kind = 'demo' and branches.id = ${q(centre)} and branches.name = ${q(TARGET_OWNER.centreName)} and branches.organisation_id = organisations.id)`;
  const statements: string[] = [];
  const push = (sql: string) => statements.push(`${sql};`);

  for (const [id, category, code, label, sortOrder, custom] of dataset.config.admissionOptions) {
    push(`insert into admission_option_values (id, organisation_id, category, code, label, sort_order, requires_custom_label, is_active, created_at, updated_at)
select ${q(id)}, ${q(org)}, ${q(category)}, ${q(code)}, ${q(label)}, ${sortOrder}, ${custom}, 1, ${q(now)}, ${q(now)} where ${guard}`);
  }
  for (const [id, min, max, plan, instalments] of dataset.config.paymentRules) {
    push(`insert into payment_plan_rules (id, organisation_id, min_duration_months, max_duration_months, plan_type, fixed_instalments, is_active, created_at, updated_at)
select ${q(id)}, ${q(org)}, ${min}, ${max ?? "null"}, ${q(plan)}, ${instalments ?? "null"}, 1, ${q(now)}, ${q(now)} where ${guard}`);
  }
  for (const [id, code, name] of dataset.roles) {
    push(`insert into roles (id, organisation_id, code, name, created_at)
select ${q(id)}, ${q(org)}, ${q(code)}, ${q(name)}, ${q(now)} where ${guard}`);
  }
  for (const [id, code, name, sortOrder] of dataset.categories) {
    push(`insert into course_categories (id, organisation_id, code, name, sort_order, is_active, created_at, updated_at)
select ${q(id)}, ${q(org)}, ${q(code)}, ${q(name)}, ${sortOrder}, 1, ${q(now)}, ${q(now)} where ${guard}`);
  }
  for (const [id, categoryId, code, name, durationLabel, months, defaultFee, lowestFee] of dataset.courses) {
    push(`insert into courses (id, organisation_id, category_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
select ${q(id)}, ${q(org)}, ${q(categoryId)}, ${q(code)}, ${q(name)}, ${q(durationLabel)}, ${months}, ${defaultFee}, ${lowestFee}, 1, 0, 'active', ${q(now)}, ${q(now)} where ${guard}`);
  }

  const insertPerson = (personId: string, fullName: string, publicName: string, dob: string) => {
    push(`insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at)
select ${q(personId)}, ${q(org)}, ${q(centre)}, ${q(fullName)}, ${q(publicName)}, 'active', ${q(now)}, ${q(now)} where ${guard}`);
    push(`insert into person_identity_details (person_id, official_full_name, date_of_birth, identity_verified, created_at, updated_at)
select ${q(personId)}, ${q(fullName)}, ${q(dob)}, 0, ${q(now)}, ${q(now)} where ${guard}`);
  };
  const insertContact = (personId: string, contactId: string, hash: string, lastFour: string, belongsTo: string) => {
    push(`insert into person_contacts (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, created_at, updated_at)
select ${q(contactId)}, ${q(personId)}, 'mobile', ${q(hash)}, null, ${q(lastFour)}, 1, 0, ${q(now)}, ${q(now)} where ${guard}`);
    push(`insert into person_contact_details (contact_id, belongs_to, is_whatsapp, status, created_at, updated_at)
select ${q(contactId)}, ${q(belongsTo)}, 0, 'active', ${q(now)}, ${q(now)} where ${guard}`);
  };

  for (const [personId, fullName, publicName, dob] of dataset.trainers) {
    insertPerson(personId, fullName, publicName, dob);
    push(`insert into person_roles (person_id, role_id, branch_id, branch_key, status, created_at)
select ${q(personId)}, 'demo_v1_role_trainer', ${q(centre)}, ${q(centre)}, 'active', ${q(now)} where ${guard}`);
  }
  for (const [personId, fullName, publicName, hash, lastFour] of dataset.enquiryPeople) {
    insertPerson(personId, fullName, publicName, "2000-01-01");
    insertContact(personId, `demo_v1_contact_${personId.replace("demo_v1_person_", "")}`, hash, lastFour, "student");
  }
  for (const [personId, studentId, fullName, publicName, hash, lastFour, seq, studentNo, since, status, dob] of dataset.students) {
    insertPerson(personId, fullName, publicName, dob);
    insertContact(personId, `demo_v1_contact_${studentId}`, hash, lastFour, "student");
    push(`insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at)
select ${q(studentId)}, ${q(org)}, ${q(personId)}, ${q(centre)}, ${q(studentNo)}, ${seq}, ${q(since)}, ${q(status)}, 'not_invited', ${q(now)}, ${q(now)} where ${guard}`);
    push(`insert into person_roles (person_id, role_id, branch_id, branch_key, status, created_at)
select ${q(personId)}, ${q(status === "active" ? "demo_v1_role_student" : "demo_v1_role_alumni")}, ${q(centre)}, ${q(centre)}, 'active', ${q(now)} where ${guard}`);
  }

  for (const [id, personId, number, mobile, courseId, source, sourceDetail, status, stage, next, contacted, preferred, lost] of dataset.enquiries) {
    const converted = id === "demo_v1_enquiry_010" ? "demo_v1_enrolment_03" : null;
    push(`insert into enquiries (id, organisation_id, branch_id, person_id, enquiry_number, mobile_used, course_interest_id, source, source_detail, counsellor_login_account_id, preferred_timing, preferred_joining_date, status, pipeline_stage, next_follow_up_at, assigned_at, last_contacted_at, lost_reason, closed_reason, converted_enrolment_id, converted_at, created_at, updated_at)
select ${q(id)}, ${q(org)}, ${q(centre)}, ${q(personId)}, ${q(number)}, ${q(mobile)}, ${q(courseId)}, ${q(source)}, ${q(sourceDetail)}, ${q(TARGET_OWNER.loginAccountId)}, 'Evening', ${sqlString(preferred)}, ${q(status)}, ${q(stage)}, ${sqlString(next)}, ${q(now)}, ${sqlString(contacted)}, ${sqlString(lost)}, ${sqlString(lost)}, ${sqlString(converted)}, ${converted ? q(contacted || now) : "null"}, ${q(now)}, ${q(now)} where ${guard}`);
  }
  for (const [id, enquiryId, channel, outcome, note, occurredAt, next, stage] of dataset.followUpEvents) {
    push(`insert into enquiry_follow_up_events (id, enquiry_id, organisation_id, branch_id, actor_login_account_id, channel, outcome, note, occurred_at, next_follow_up_at_snapshot, pipeline_stage_snapshot, created_at)
select ${q(id)}, ${q(enquiryId)}, ${q(org)}, ${q(centre)}, ${q(TARGET_OWNER.loginAccountId)}, ${q(channel)}, ${q(outcome)}, ${note ? q(note) : "null"}, ${q(occurredAt)}, ${next ? q(next) : "null"}, ${q(stage)}, ${q(occurredAt)} where ${guard}`);
  }
  for (const [id, studentId, courseId, enquiryId, number, admission, joining, expected, actual] of dataset.enrolments) {
    const status = actual ? "completed" : "active";
    push(`insert into enrolments (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference, admission_date, joining_date, expected_completion_date, actual_completion_date, status, nsdc_preference, created_at, updated_at)
select ${q(id)}, ${q(studentId)}, ${q(centre)}, ${q(courseId)}, ${enquiryId ? q(enquiryId) : "null"}, ${q(number)}, 'classroom', '17_20', ${q(admission)}, ${q(joining)}, ${expected ? q(expected) : "null"}, ${actual ? q(actual) : "null"}, ${q(status)}, 'no', ${q(now)}, ${q(now)} where ${guard}`);
  }
  for (const [id, courseId, name, trainerId, daysJson, start, end, capacity, status] of dataset.batches) {
    push(`insert into batches (id, organisation_id, branch_id, course_id, name, primary_trainer_person_id, days_of_week_json, start_time, end_time, capacity, status, created_by_login_account_id, created_at, updated_at)
select ${q(id)}, ${q(org)}, ${q(centre)}, ${q(courseId)}, ${q(name)}, ${q(trainerId)}, ${q(daysJson)}, ${q(start)}, ${q(end)}, ${capacity}, ${q(status)}, ${q(TARGET_OWNER.loginAccountId)}, ${q(now)}, ${q(now)} where ${guard}`);
  }
  for (const [batchId, courseId] of dataset.batchCourses) {
    push(`insert into batch_courses (batch_id, course_id, organisation_id, created_at, created_by)
select ${q(batchId)}, ${q(courseId)}, ${q(org)}, ${q(now)}, ${q(TARGET_OWNER.loginAccountId)} where ${guard}`);
  }
  for (const [id, batchId, enrolmentId, joined, left, status] of dataset.memberships) {
    push(`insert into batch_memberships (id, organisation_id, batch_id, enrolment_id, joined_at, left_at, status, assigned_by_login_account_id, created_at)
select ${q(id)}, ${q(org)}, ${q(batchId)}, ${q(enrolmentId)}, ${q(joined)}, ${left ? q(left) : "null"}, ${q(status)}, ${q(TARGET_OWNER.loginAccountId)}, ${q(now)} where ${guard}`);
  }
  for (const [id, batchId, trainerId, sessionDate, start, end, actualStart, actualEnd, note] of dataset.sessions) {
    push(`insert into class_sessions (id, organisation_id, branch_id, batch_id, trainer_person_id, session_date, scheduled_start_time, scheduled_end_time, actual_started_at, actual_ended_at, teaching_note, status, version, created_at, updated_at, created_by_actor_id)
select ${q(id)}, ${q(org)}, ${q(centre)}, ${q(batchId)}, ${q(trainerId)}, ${q(sessionDate)}, ${q(start)}, ${q(end)}, ${q(actualStart)}, ${q(actualEnd)}, ${q(note)}, 'completed', 1, ${q(now)}, ${q(now)}, ${q(TARGET_OWNER.loginAccountId)} where ${guard}`);
  }
  for (const [sessionId, batchId] of dataset.sessions.map((session) => [session[0], session[1]] as const)) {
    const sessionDate = dataset.sessions.find((session) => session[0] === sessionId)![3];
    for (const membership of dataset.memberships.filter((item) => item[1] === batchId && item[3] <= sessionDate && (!item[4] || item[4] >= sessionDate))) {
      const enrolment = dataset.enrolments.find((item) => item[0] === membership[2])!;
      const student = dataset.students.find((item) => item[1] === enrolment[1])!;
      const id = `demo_v1_att_${sessionId.replace("demo_v1_session_", "")}_${membership[0].replace("demo_v1_batchmem_", "")}`;
      const status = Number(membership[0].slice(-2)) % 3 === 0 ? "absent" : "present";
      push(`insert into attendance_records (id, organisation_id, class_session_id, batch_membership_id, enrolment_id, person_id, status, marked_by_actor_id, marked_at, updated_at)
select ${q(id)}, ${q(org)}, ${q(sessionId)}, ${q(membership[0])}, ${q(enrolment[0])}, ${q(student[0])}, ${q(status)}, ${q(TARGET_OWNER.loginAccountId)}, ${q(now)}, ${q(now)} where ${guard}`);
    }
  }
  push(`insert into audit_logs (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, old_values_json, new_values_json, metadata_json, created_at)
select 'demo_v1_audit_seeded', ${q(org)}, ${q(centre)}, ${q(TARGET_OWNER.loginAccountId)}, ${q(TARGET_OWNER.personId)}, ${q(DEMO_DATA_AUDIT_ACTION)}, 'organisation', ${q(org)}, null, ${q(JSON.stringify({ seedVersion: input.seedVersion }))}, ${q(auditMetadata)}, ${q(now)} where ${guard}`);
  return `${statements.join("\n")}\n`;
}

export function deterministicSeedRows(dataset: DemoDataset): SeedRow[] {
  const rows: SeedRow[] = [];
  const add = (table: string, id: string) => rows.push({ table, id });
  for (const item of dataset.config.admissionOptions) add("admission_option_values", item[0]);
  for (const item of dataset.config.paymentRules) add("payment_plan_rules", item[0]);
  for (const item of dataset.roles) add("roles", item[0]);
  for (const item of dataset.categories) add("course_categories", item[0]);
  for (const item of dataset.courses) add("courses", item[0]);
  for (const item of dataset.trainers) {
    add("people", item[0]);
    add("person_identity_details", item[0]);
    add("person_roles", item[0]);
  }
  for (const item of dataset.enquiryPeople) {
    add("people", item[0]);
    add("person_identity_details", item[0]);
    add("person_contacts", `demo_v1_contact_${item[0].replace("demo_v1_person_", "")}`);
    add("person_contact_details", `demo_v1_contact_${item[0].replace("demo_v1_person_", "")}`);
  }
  for (const item of dataset.students) {
    add("people", item[0]);
    add("person_identity_details", item[0]);
    add("person_contacts", `demo_v1_contact_${item[1]}`);
    add("person_contact_details", `demo_v1_contact_${item[1]}`);
    add("students", item[1]);
    add("person_roles", item[0]);
  }
  for (const item of dataset.enquiries) add("enquiries", item[0]);
  for (const item of dataset.followUpEvents) add("enquiry_follow_up_events", item[0]);
  for (const item of dataset.enrolments) add("enrolments", item[0]);
  for (const item of dataset.batches) add("batches", item[0]);
  for (const item of dataset.batchCourses) add("batch_courses", `${item[0]}:${item[1]}`);
  for (const item of dataset.memberships) add("batch_memberships", item[0]);
  for (const item of dataset.sessions) add("class_sessions", item[0]);
  for (const session of dataset.sessions) {
    const sessionDate = session[3];
    for (const membership of dataset.memberships.filter((item) => item[1] === session[1] && item[3] <= sessionDate && (!item[4] || item[4] >= sessionDate))) {
      add("attendance_records", `demo_v1_att_${session[0].replace("demo_v1_session_", "")}_${membership[0].replace("demo_v1_batchmem_", "")}`);
    }
  }
  add("audit_logs", "demo_v1_audit_seeded");
  return rows;
}

export function demoDataCounts(dataset: DemoDataset) {
  const attendanceRecords = deterministicSeedRows(dataset).filter((row) => row.table === "attendance_records").length;
  return {
    admissionOptionValues: dataset.config.admissionOptions.length,
    paymentPlanRules: dataset.config.paymentRules.length,
    roles: dataset.roles.length,
    courseCategories: dataset.categories.length,
    courses: dataset.courses.length,
    trainers: dataset.trainers.length,
    enquiryPeople: dataset.enquiryPeople.length,
    enquiries: dataset.enquiries.length,
    followUpEvents: dataset.followUpEvents.length,
    students: dataset.students.length,
    enrolments: dataset.enrolments.length,
    batches: dataset.batches.length,
    batchCourses: dataset.batchCourses.length,
    batchMemberships: dataset.memberships.length,
    classSessions: dataset.sessions.length,
    attendanceRecords,
    certificateApplications: 0,
    certificates: 0,
    auditLogs: 1,
  };
}

export function assertNoForbiddenFinancialWrites(sql: string) {
  for (const table of FORBIDDEN_WRITE_TABLES) {
    const pattern = new RegExp(`\\b(insert\\s+into|update|delete\\s+from)\\s+${table}\\b`, "i");
    if (pattern.test(sql)) throw new Error(`Demo core v1 must not write ${table}.`);
  }
  if (/\borg_samyak\b/i.test(sql)) throw new Error("Demo core v1 SQL must not target org_samyak.");
}

export class WranglerRemoteDemoDataWriteClient extends WranglerRemoteD1Client implements RemoteD1WriteClient {
  executeSqlFile(sql: string) {
    const dir = mkdtempSync(join(tmpdir(), "samyak-demo-data-"));
    const file = join(dir, "demo-core-v1.sql");
    try {
      writeFileSync(file, sql, "utf8");
      const wranglerBin = join(this.cwd, "node_modules", "wrangler", "bin", "wrangler.js");
      execFileSync(process.execPath, [wranglerBin, "d1", "execute", this.databaseName, "--remote", "--file", file], {
        cwd: this.cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } finally {
      if (existsSync(file)) unlinkSync(file);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }
}

export function createRemoteDemoDataMaintenanceClient(databaseName = PRODUCTION_DEMO_DATABASE) {
  return new WranglerRemoteDemoDataWriteClient(databaseName);
}

export async function runRemoteDemoDataMaintenance(input: DemoDataMaintenanceArgs) {
  validateDemoDataMaintenanceRequest(input);
  const client = input.apply
    ? createRemoteDemoDataMaintenanceClient(input.databaseName)
    : new WranglerRemoteD1Client(input.databaseName);
  if (input.preflight) return buildRemotePreflightDemoData(client, input);
  return applyRemoteDemoData(client as RemoteD1WriteClient, input);
}

async function loadTarget(
  execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>,
  options: Pick<DemoDataMaintenanceArgs, "organisationId" | "expectedCentre">,
) {
  const rows = await execute<{
    organisation_id: string;
    organisation_name: string;
    organisation_status: string;
    organisation_kind: string;
    centre_id: string | null;
    centre_name: string | null;
    owner_shell_intact: number;
  }>(
    `select organisations.id as organisation_id, organisations.name as organisation_name, organisations.status as organisation_status,
       organisations.organisation_kind, branches.id as centre_id, branches.name as centre_name,
       case when exists (
         select 1
         from login_accounts
         join organisation_memberships on organisation_memberships.login_account_id = login_accounts.id
         join login_account_people on login_account_people.login_account_id = login_accounts.id
         join people on people.id = login_account_people.person_id
         where login_accounts.id = ${q(TARGET_OWNER.loginAccountId)}
           and people.id = ${q(TARGET_OWNER.personId)}
           and organisation_memberships.id = ${q(TARGET_OWNER.membershipId)}
           and login_accounts.organisation_id = organisations.id
           and organisation_memberships.organisation_id = organisations.id
           and people.organisation_id = organisations.id
       ) then 1 else 0 end as owner_shell_intact
     from organisations
     left join branches on branches.organisation_id = organisations.id
       and (branches.id = ${q(options.expectedCentre)} or branches.name = ${q(options.expectedCentre)})
     where organisations.id = ${q(options.organisationId)}
     limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    organisationKind: row.organisation_kind,
    organisationStatus: row.organisation_status,
    centreId: row.centre_id || "",
    centreName: row.centre_name || "",
    ownerShellIntact: Number(row.owner_shell_intact || 0) === 1,
  };
}

async function loadFinancialCounts(execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>, organisationId: string) {
  const counts: Record<string, number> = {};
  for (const table of FINANCIAL_TABLES) {
    const column = table === "fee_agreements" || table === "fee_agreement_instalments"
      ? "enrolments.student_id in (select id from students where organisation_id = "
      : "organisation_id = ";
    const sql = table === "fee_agreements"
      ? `select count(*) as count from fee_agreements join enrolments on enrolments.id = fee_agreements.enrolment_id where ${column}${q(organisationId)})`
      : table === "fee_agreement_instalments"
        ? `select count(*) as count from fee_agreement_instalments join fee_agreements on fee_agreements.id = fee_agreement_instalments.fee_agreement_id join enrolments on enrolments.id = fee_agreements.enrolment_id where ${column}${q(organisationId)})`
        : `select count(*) as count from ${table} where organisation_id = ${q(organisationId)}`;
    counts[table] = Number((await execute<{ count: number }>(sql))[0]?.count || 0);
  }
  return counts;
}

async function countDeterministicRows(execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>, dataset: DemoDataset) {
  let total = 0;
  const grouped = groupSeedRows(dataset);
  for (const [table, ids] of grouped) {
    if (table === "batch_courses") {
      const pairs = ids.map((id) => id.split(":"));
      total += Number((await execute<{ count: number }>(
        `select count(*) as count from batch_courses where ${pairs.map(([batchId, courseId]) => `(batch_id = ${q(batchId)} and course_id = ${q(courseId)})`).join(" or ")}`,
      ))[0]?.count || 0);
      continue;
    }
    if (table === "person_roles") {
      total += Number((await execute<{ count: number }>(
        `select count(*) as count from person_roles where person_id in (${ids.map(q).join(",")})`,
      ))[0]?.count || 0);
      continue;
    }
    if (table === "person_identity_details") {
      total += Number((await execute<{ count: number }>(
        `select count(*) as count from person_identity_details where person_id in (${ids.map(q).join(",")})`,
      ))[0]?.count || 0);
      continue;
    }
    if (table === "person_contact_details") {
      total += Number((await execute<{ count: number }>(
        `select count(*) as count from person_contact_details where contact_id in (${ids.map(q).join(",")})`,
      ))[0]?.count || 0);
      continue;
    }
    total += Number((await execute<{ count: number }>(
      `select count(*) as count from ${table} where id in (${ids.map(q).join(",")})`,
    ))[0]?.count || 0);
  }
  return total;
}

async function countUnknownOperationalRows(execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>, dataset: DemoDataset, organisationId: string) {
  const seed = groupSeedRows(dataset);
  const seedIds = (table: string) => seed.get(table) || [];
  const checks = [
    `select count(*) as count from admission_option_values where organisation_id = ${q(organisationId)} and id not in (${seedIds("admission_option_values").map(q).join(",")})`,
    `select count(*) as count from payment_plan_rules where organisation_id = ${q(organisationId)} and id not in (${seedIds("payment_plan_rules").map(q).join(",")})`,
    `select count(*) as count from course_categories where organisation_id = ${q(organisationId)} and id not in (${seedIds("course_categories").map(q).join(",")})`,
    `select count(*) as count from courses where organisation_id = ${q(organisationId)} and id not in (${seedIds("courses").map(q).join(",")})`,
    `select count(*) as count from roles where organisation_id = ${q(organisationId)} and code in ('trainer','student','alumni') and id not in (${seedIds("roles").map(q).join(",")})`,
    `select count(*) as count from people where organisation_id = ${q(organisationId)} and id <> ${q(TARGET_OWNER.personId)} and id not in (${seedIds("people").map(q).join(",")})`,
    `select count(*) as count from enquiries where organisation_id = ${q(organisationId)} and id not in (${seedIds("enquiries").map(q).join(",")})`,
    `select count(*) as count from students where organisation_id = ${q(organisationId)} and id not in (${seedIds("students").map(q).join(",")})`,
    `select count(*) as count from batches where organisation_id = ${q(organisationId)} and id not in (${seedIds("batches").map(q).join(",")})`,
    `select count(*) as count from batch_memberships where organisation_id = ${q(organisationId)} and id not in (${seedIds("batch_memberships").map(q).join(",")})`,
    `select count(*) as count from class_sessions where organisation_id = ${q(organisationId)} and id not in (${seedIds("class_sessions").map(q).join(",")})`,
    `select count(*) as count from attendance_records where organisation_id = ${q(organisationId)} and id not in (${seedIds("attendance_records").map(q).join(",")})`,
  ];
  let total = 0;
  for (const sql of checks) total += Number((await execute<{ count: number }>(sql))[0]?.count || 0);
  return total;
}

async function countSeedAuditRows(execute: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>, organisationId: string, seedVersion: string) {
  return Number((await execute<{ count: number }>(
    `select count(*) as count from audit_logs where organisation_id = ${q(organisationId)} and action = ${q(DEMO_DATA_AUDIT_ACTION)} and metadata_json like ${q(`%"seedVersion":"${seedVersion}"%`)}`,
  ))[0]?.count || 0);
}

function groupSeedRows(dataset: DemoDataset) {
  const grouped = new Map<string, string[]>();
  for (const row of deterministicSeedRows(dataset)) {
    const list = grouped.get(row.table) || [];
    list.push(row.id);
    grouped.set(row.table, list);
  }
  return grouped;
}

function q(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlString(value: string | null) {
  return value ? q(value) : "null";
}
