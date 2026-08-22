/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ORG_ID } from "./auth-store";
import { hmacHex } from "./crypto";
import { CURRENT_STUDENT_STATUS_VALUES, listStaffStudents } from "./student-directory";

const NOW = "2026-08-22T00:00:00.000Z";
type SqlValue = string | number | bigint | Uint8Array | null;

describe("student directory", () => {
  it("lists canonical current and alumni students without requiring enquiries", async () => {
    const fixture = await createFixture();
    const all = await listStaffStudents(fixture.c, ownerStaff(), { status: "all" });
    const current = await listStaffStudents(fixture.c, ownerStaff(), { status: "current" });
    const alumni = await listStaffStudents(fixture.c, ownerStaff(), { status: "alumni" });

    expect(all.items.map((item) => item.studentNumber)).toEqual(expect.arrayContaining(["SYK-SION-0001", "SYK-SION-0002", "SYK-SION-0003", "SYK-SION-0005"]));
    expect(CURRENT_STUDENT_STATUS_VALUES).toEqual(["active", "on_hold"]);
    expect(current.items.map((item) => item.currentStatus)).toEqual(["active", "active", "on_hold"]);
    expect(alumni.items.map((item) => item.currentStatus)).toEqual(["alumni", "alumni"]);
    expect(alumni.items.find((item) => item.studentNumber === "SYK-SION-0002")).toMatchObject({ displayName: "Legacy Alumni", enrolmentCount: 1 });
    expect(current.items.find((item) => item.studentNumber === "SYK-SION-0005")).toMatchObject({ currentStatus: "on_hold" });
  });

  it("searches name, student id, mobile, course and enrolment number", async () => {
    const fixture = await createFixture();
    await expectNumbers(fixture, { search: "legacy" }, ["SYK-SION-0002"]);
    await expectNumbers(fixture, { search: "SYK-SION-0001" }, ["SYK-SION-0001"]);
    await expectNumbers(fixture, { search: "98765 43210" }, ["SYK-SION-0001"]);
    await expectNumbers(fixture, { search: "Advanced Excel" }, ["SYK-SION-0001", "SYK-SION-0005", "SYK-SION-0003"]);
    await expectNumbers(fixture, { search: "ENR-SION-0003-B" }, ["SYK-SION-0003"]);
  });

  it("keeps shared mobile students separate and excludes inactive contacts from mobile search", async () => {
    const fixture = await createFixture();
    await expectNumbers(fixture, { search: "9234567890" }, ["SYK-SION-0002", "SYK-SION-0003"]);
    await expectNumbers(fixture, { search: "9345678901" }, []);
  });

  it("deduplicates multiple enrolments into one student result", async () => {
    const fixture = await createFixture();
    const result = await listStaffStudents(fixture.c, ownerStaff(), { search: "Multi Course" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      studentNumber: "SYK-SION-0003",
      enrolmentCount: 2,
      latestCourseName: "Tally Prime",
      latestEnrolmentNumber: "ENR-SION-0003-B",
      paymentShortcutEnrolmentId: null,
    });
  });

  it("shows a payments shortcut only for one confirmed active financial enrolment", async () => {
    const fixture = await createFixture();

    const singleFinancial = await listStaffStudents(fixture.c, ownerStaff(), { search: "SYK-SION-0001" });
    const multipleFinancial = await listStaffStudents(fixture.c, ownerStaff(), { search: "SYK-SION-0003" });
    const noFeeLegacy = await listStaffStudents(fixture.c, ownerStaff(), { search: "SYK-SION-0002" });
    const inactiveFee = await listStaffStudents(fixture.c, ownerStaff(), { search: "SYK-SION-0005" });

    expect(singleFinancial.items[0].paymentShortcutEnrolmentId).toBe("enrol_a");
    expect(multipleFinancial.items[0].paymentShortcutEnrolmentId).toBeNull();
    expect(noFeeLegacy.items[0].paymentShortcutEnrolmentId).toBeNull();
    expect(inactiveFee.items[0].paymentShortcutEnrolmentId).toBeNull();
  });

  it("excludes archived people and branch-inaccessible students", async () => {
    const fixture = await createFixture();
    const owner = await listStaffStudents(fixture.c, ownerStaff(), { status: "all" });
    const branchStaff = await listStaffStudents(fixture.c, branchStaffContext(), { status: "all" });

    expect(owner.items.map((item) => item.studentNumber)).not.toContain("SYK-SION-ARCHIVED");
    expect(branchStaff.items.map((item) => item.studentNumber)).toEqual(["SYK-SION-0001", "SYK-SION-0005", "SYK-SION-0002", "SYK-SION-0003"]);
    await expectNumbers(fixture, { search: "SYK-BANDRA-0004" }, [], branchStaffContext());
  });

  it("escapes wildcard search input and returns accurate pagination totals", async () => {
    const fixture = await createFixture();
    await expectNumbers(fixture, { search: "%' or 1=1 --" }, []);

    const page = await listStaffStudents(fixture.c, ownerStaff(), { status: "all", limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.pagination).toMatchObject({ limit: 2, offset: 0, total: 5, hasMore: true });
  });

  it("returns only safe display fields", async () => {
    const fixture = await createFixture();
    const result = await listStaffStudents(fixture.c, ownerStaff(), { search: "SYK-SION-0001" });
    const text = JSON.stringify(result);

    expect(result.items[0]).toMatchObject({ mobileDisplay: "******3210" });
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain(await testMobileHash("9876543210"));
    expect(text).not.toContain("cipher");
    expect(text).not.toContain("person_a");
  });
});

async function expectNumbers(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  query: Parameters<typeof listStaffStudents>[2],
  expected: string[],
  staff = ownerStaff(),
) {
  const result = await listStaffStudents(fixture.c, staff, query);
  expect(result.items.map((item) => item.studentNumber)).toEqual(expected);
}

async function createFixture() {
  const db = new DatabaseSync(":memory:");
  installSchema(db);
  seedBase(db);
  await seedStudent(db, { personId: "person_a", studentId: "student_a", studentNumber: "SYK-SION-0001", fullName: "Asha Current", status: "active", mobile: "9876543210", withEnquiry: true, enrolments: [{ id: "enrol_a", number: "ENR-SION-0001", courseId: "course_excel", joiningDate: "2026-01-02", hasFee: true }] });
  await seedStudent(db, { personId: "person_b", studentId: "student_b", studentNumber: "SYK-SION-0002", fullName: "Legacy Alumni", status: "alumni", mobile: "9234567890", withEnquiry: false, enrolments: [{ id: "enrol_b", number: "ENR-SION-0002", courseId: "course_tally", joiningDate: "2025-01-02", hasFee: false }] });
  await seedStudent(db, { personId: "person_c", studentId: "student_c", studentNumber: "SYK-SION-0003", fullName: "Multi Course Alumni", status: "alumni", mobile: "9234567890", withEnquiry: true, enrolments: [{ id: "enrol_c1", number: "ENR-SION-0003-A", courseId: "course_excel", joiningDate: "2024-01-02", hasFee: true }, { id: "enrol_c2", number: "ENR-SION-0003-B", courseId: "course_tally", joiningDate: "2026-02-02", hasFee: true }] });
  await seedStudent(db, { personId: "person_d", studentId: "student_d", studentNumber: "SYK-BANDRA-0004", fullName: "Branch Student", status: "active", mobile: "9123456780", branchId: "branch_bandra", withEnquiry: false, enrolments: [{ id: "enrol_d", number: "ENR-BANDRA-0004", courseId: "course_tally", joiningDate: "2026-03-02", hasFee: false }] });
  await seedStudent(db, { personId: "person_e", studentId: "student_e", studentNumber: "SYK-SION-0005", fullName: "On Hold Current", status: "on_hold", mobile: "9988776655", withEnquiry: false, enrolments: [{ id: "enrol_e", number: "ENR-SION-0005", courseId: "course_excel", joiningDate: "2025-08-02", hasFee: true, feeStatus: "cancelled" }] });
  await seedStudent(db, { personId: "person_archived", studentId: "student_archived", studentNumber: "SYK-SION-ARCHIVED", fullName: "Archived Student", status: "active", mobile: "9000000000", personStatus: "archived", withEnquiry: false, enrolments: [] });
  await seedInactiveMobile(db, "person_a", "9345678901");
  const c = { env: { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" }, req: { header: () => null } };
  return { db, c: c as never };
}

function installSchema(db: DatabaseSync) {
  db.exec(`
    create table people (id text primary key, organisation_id text, home_branch_id text, full_name text, public_name text, date_of_birth text, status text, created_at text, updated_at text);
    create table person_identity_details (person_id text primary key, official_full_name text, date_of_birth text, created_at text, updated_at text);
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, sequence_number integer, student_since text, current_status text, portal_status text, created_at text, updated_at text);
    create table person_contacts (id text primary key, person_id text, contact_type text, normalized_value text, display_value text, last_four text, is_primary integer, is_verified integer, verified_at text, created_at text, updated_at text);
    create table person_contact_details (contact_id text primary key, belongs_to text, contact_label text, is_whatsapp integer, valid_from text, valid_until text, status text, created_at text, updated_at text);
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table courses (id text primary key, code text, name text);
    create table enrolments (id text primary key, student_id text, course_id text, enrolment_number text, admission_date text, joining_date text, actual_completion_date text, status text, created_at text);
    create table fee_agreements (id text primary key, enrolment_id text, final_agreed_fee_paise integer, status text);
    create table enquiries (id text primary key, person_id text);
  `);
}

function seedBase(db: DatabaseSync) {
  db.prepare("insert into roles values ('role_owner', ?, 'owner', 'Owner', ?), ('role_counsellor', ?, 'counsellor', 'Counsellor', ?)").run(ORG_ID, NOW, ORG_ID, NOW);
  db.prepare("insert into login_account_roles values ('acct_owner', 'role_owner', null, ?), ('acct_branch', 'role_counsellor', 'branch_sion', ?)").run(NOW, NOW);
  db.prepare("insert into courses values ('course_excel', 'AEX', 'Advanced Excel'), ('course_tally', 'TALLY', 'Tally Prime')").run();
}

async function seedStudent(db: DatabaseSync, input: {
  personId: string;
  studentId: string;
  studentNumber: string;
  fullName: string;
  status: string;
  mobile: string;
  branchId?: string;
  personStatus?: string;
  withEnquiry: boolean;
  enrolments: Array<{ id: string; number: string; courseId: string; joiningDate: string; hasFee: boolean; feeStatus?: string }>;
}) {
  const branchId = input.branchId || "branch_sion";
  db.prepare("insert into people values (?, ?, ?, ?, ?, null, ?, ?, ?)").run(input.personId, ORG_ID, branchId, input.fullName, input.fullName, input.personStatus || "active", NOW, NOW);
  db.prepare("insert into person_identity_details values (?, ?, null, ?, ?)").run(input.personId, input.fullName, NOW, NOW);
  db.prepare("insert into students values (?, ?, ?, ?, ?, 1, ?, ?, 'active', ?, ?)").run(input.studentId, ORG_ID, input.personId, branchId, input.studentNumber, input.enrolments[0]?.joiningDate || "2024-01-01", input.status, NOW, NOW);
  await seedMobile(db, input.personId, `contact_${input.studentId}`, input.mobile, "active", 1);
  for (const enrolment of input.enrolments) {
    db.prepare("insert into enrolments values (?, ?, ?, ?, ?, ?, null, 'confirmed', ?)").run(enrolment.id, input.studentId, enrolment.courseId, enrolment.number, enrolment.joiningDate, enrolment.joiningDate, NOW);
    if (enrolment.hasFee) db.prepare("insert into fee_agreements values (?, ?, 100000, ?)").run(`fee_${enrolment.id}`, enrolment.id, enrolment.feeStatus || "active");
  }
  if (input.withEnquiry) db.prepare("insert into enquiries values (?, ?)").run(`enq_${input.studentId}`, input.personId);
}

async function seedInactiveMobile(db: DatabaseSync, personId: string, mobile: string) {
  await seedMobile(db, personId, "contact_inactive", mobile, "previous", 0);
}

async function seedMobile(db: DatabaseSync, personId: string, contactId: string, mobile: string, status: string, isPrimary: number) {
  const hash = await testMobileHash(mobile);
  db.prepare("insert into person_contacts values (?, ?, 'mobile', ?, 'cipher-not-output', ?, ?, 1, null, ?, ?)").run(contactId, personId, hash, mobile.slice(-4), isPrimary, NOW, NOW);
  db.prepare("insert into person_contact_details values (?, 'student', null, 1, null, null, ?, ?, ?)").run(contactId, status, NOW, NOW);
}

function ownerStaff() {
  return { loginAccountId: "acct_owner", activePersonId: null, roles: ["owner"] };
}

function branchStaffContext() {
  return { loginAccountId: "acct_branch", activePersonId: null, roles: ["counsellor"] };
}

async function testMobileHash(mobile: string) {
  return hmacHex("test-pepper", "mobile", mobile);
}

class D1Adapter {
  constructor(private readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new D1Statement(this.db, sql);
  }
}

class D1Statement {
  private values: SqlValue[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values) ?? null) as T | null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) } as T;
  }
}
