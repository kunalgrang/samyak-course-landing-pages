/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fetchStudentHomeForActiveProfile, lookupPortalProfilesByMobile, mobileHash, ORG_ID } from "./auth-store";
import { changeStudentFullName, changeStudentPrimaryMobile, getStudentBasicDetailsVersion, getStudentContactVersion } from "./owner-student-maintenance";
import { hmacHex } from "./crypto";
import { listStaffStudents } from "./student-directory";

const NOW = "2026-08-22T00:00:00.000Z";
type SqlValue = string | number | bigint | Uint8Array | null;

describe("owner student maintenance", () => {
  it("lets an owner correct a current student's canonical full name without changing identity or history", async () => {
    const fixture = await createFixture();
    const before = snapshot(fixture.db, "student_a");
    const result = await changeStudentFullName(fixture.c, ownerStaff(), "student_a", {
      fullName: "  Md. Arif   Khan  ",
      expectedBasicDetailsVersion: await getStudentBasicDetailsVersion(fixture.c, "student_a") || "",
    });

    expect(result).toMatchObject({ ok: true, studentId: "student_a", studentNumber: "SYK-SION-0001", personId: "person_a", fullName: "Md. Arif Khan" });
    expect(row(fixture.db, "select full_name, public_name from people where id = 'person_a'")).toMatchObject({ full_name: "Md. Arif Khan", public_name: "Md. Arif Khan" });
    expect(row(fixture.db, "select official_full_name from person_identity_details where person_id = 'person_a'")).toMatchObject({ official_full_name: "Md. Arif Khan" });
    expect(snapshot(fixture.db, "student_a")).toMatchObject({
      studentId: before.studentId,
      studentNumber: before.studentNumber,
      personId: before.personId,
      enrolments: before.enrolments,
      contacts: before.contacts,
      loginLinks: before.loginLinks,
      sessions: before.sessions,
      batchMemberships: before.batchMemberships,
      certificates: before.certificates,
      receipts: before.receipts,
      referrals: before.referrals,
      referralRewardSnapshots: before.referralRewardSnapshots,
      admissionDrafts: before.admissionDrafts,
    });
    expect(row(fixture.db, "select student_name_snapshot from certificate_issues where id = 'cert_person_a'")).toMatchObject({ student_name_snapshot: "person_a Issued Name" });
    const auditJson = JSON.stringify(all(fixture.db, "select action, metadata_json from audit_logs"));
    expect(auditJson).toContain("student_name_changed");
    expect(auditJson).not.toContain("person_a Official");
    expect(auditJson).not.toContain("Md. Arif Khan");
  });

  it("edits legacy and alumni students from the canonical Student/Person identity", async () => {
    const fixture = await createFixture({ withLegacyAlumni: true });

    const legacy = await changeStudentFullName(fixture.c, ownerStaff(), "student_legacy", {
      fullName: "Legacy Corrected",
      expectedBasicDetailsVersion: await getStudentBasicDetailsVersion(fixture.c, "student_legacy") || "",
    });
    const alumni = await changeStudentFullName(fixture.c, ownerStaff(), "student_alumni", {
      fullName: "Alumni Corrected",
      expectedBasicDetailsVersion: await getStudentBasicDetailsVersion(fixture.c, "student_alumni") || "",
    });

    expect(legacy).toMatchObject({ ok: true, personId: "person_legacy", fullName: "Legacy Corrected" });
    expect(alumni).toMatchObject({ ok: true, personId: "person_alumni", fullName: "Alumni Corrected" });
    expect(row(fixture.db, "select count(*) as count from enquiries where person_id in ('person_legacy', 'person_alumni')")?.count).toBe(0);
    expect(row(fixture.db, "select current_status from students where id = 'student_alumni'")).toMatchObject({ current_status: "alumni" });
  });

  it("reflects corrected names in directory search and all enrolments without duplicating name into enrolments", async () => {
    const fixture = await createFixture({ withSecondEnrolment: true });
    await changeStudentFullName(fixture.c, ownerStaff(), "student_a", {
      fullName: "Nisha D'Souza-Rao",
      expectedBasicDetailsVersion: await getStudentBasicDetailsVersion(fixture.c, "student_a") || "",
    });

    const directory = await listStaffStudents(fixture.c, ownerStaff(), { search: "D'Souza", status: "all" });
    expect(directory.items).toHaveLength(1);
    expect(directory.items[0]).toMatchObject({ studentId: "student_a", displayName: "Nisha D'Souza-Rao", enrolmentCount: 2 });
    expect(all(fixture.db, "select distinct student_id from enrolments where student_id = 'student_a'")).toEqual([{ student_id: "student_a" }]);
    expect(all(fixture.db, "select enrolment_number from enrolments where student_id = 'student_a' order by id").map((item) => item.enrolment_number)).toEqual(["ENR-SYK-SION-0001", "ENR-SYK-SION-0001-B"]);
  });

  it("advances the basic-details version, keeps portal names current, and avoids same-name audit churn", async () => {
    const fixture = await createFixture();
    const beforeVersion = await getStudentBasicDetailsVersion(fixture.c, "student_a") || "";
    const changed = await changeStudentFullName(fixture.c, ownerStaff(), "student_a", {
      fullName: " A. K.   Sharma ",
      expectedBasicDetailsVersion: beforeVersion,
    });

    expect(changed).toMatchObject({ ok: true, idempotent: false, fullName: "A. K. Sharma" });
    await expect(getStudentBasicDetailsVersion(fixture.c, "student_a")).resolves.not.toBe(beforeVersion);
    await expect(fetchStudentHomeForActiveProfile(fixture.c, "person_a")).resolves.toMatchObject({
      identity: { fullName: "A. K. Sharma", publicName: "A. K. Sharma" },
    });
    expect((await lookupPortalProfilesByMobile(fixture.c, "9876543210")).profiles[0]).toMatchObject({
      fullName: "A. K. Sharma",
      publicName: "A. K. Sharma",
    });

    const afterVersion = await getStudentBasicDetailsVersion(fixture.c, "student_a") || "";
    const same = await changeStudentFullName(fixture.c, ownerStaff(), "student_a", {
      fullName: "A. K.   Sharma",
      expectedBasicDetailsVersion: afterVersion,
    });

    expect(same).toMatchObject({ ok: true, idempotent: true, fullName: "A. K. Sharma" });
    await expect(getStudentBasicDetailsVersion(fixture.c, "student_a")).resolves.toBe(afterVersion);
    expect(row(fixture.db, "select count(*) as count from audit_logs where action = 'student_name_changed'")?.count).toBe(1);
  });

  it("rejects non-owner, branch-inaccessible, archived, invalid, and stale name updates safely", async () => {
    const fixture = await createFixture({ withOtherBranch: true, withArchived: true });
    const version = await getStudentBasicDetailsVersion(fixture.c, "student_a") || "";

    await expect(changeStudentFullName(fixture.c, { loginAccountId: "acct_counsellor", activePersonId: null, roles: ["counsellor"] }, "student_a", { fullName: "Blocked User", expectedBasicDetailsVersion: version }))
      .resolves.toMatchObject({ ok: false, status: 403 });
    await expect(changeStudentFullName(fixture.c, branchOwnerStaff(), "student_bandra", { fullName: "Branch Blocked", expectedBasicDetailsVersion: await getStudentBasicDetailsVersion(fixture.c, "student_bandra") || "" }))
      .resolves.toMatchObject({ ok: false, status: 403 });
    await expect(changeStudentFullName(fixture.c, ownerStaff(), "student_archived", { fullName: "Archived Blocked", expectedBasicDetailsVersion: await getStudentBasicDetailsVersion(fixture.c, "student_archived") || "" }))
      .resolves.toMatchObject({ ok: false, status: 404 });
    await expect(changeStudentFullName(fixture.c, ownerStaff(), "student_a", { fullName: "   ", expectedBasicDetailsVersion: version }))
      .resolves.toMatchObject({ ok: false, status: 400, code: "invalid_name" });
    await expect(changeStudentFullName(fixture.c, ownerStaff(), "student_a", { fullName: "R".repeat(121), expectedBasicDetailsVersion: version }))
      .resolves.toMatchObject({ ok: false, status: 400, code: "invalid_name" });
    await expect(changeStudentFullName(fixture.c, ownerStaff(), "student_a", { fullName: `Bad${String.fromCharCode(7)}Name`, expectedBasicDetailsVersion: version }))
      .resolves.toMatchObject({ ok: false, status: 400, code: "invalid_name" });

    await changeStudentFullName(fixture.c, ownerStaff(), "student_a", { fullName: "First Correction", expectedBasicDetailsVersion: version });
    await expect(changeStudentFullName(fixture.c, ownerStaff(), "student_a", { fullName: "Second Correction", expectedBasicDetailsVersion: version }))
      .resolves.toMatchObject({ ok: false, status: 409, code: "stale_student" });
    expect(row(fixture.db, "select count(*) as count from audit_logs where action = 'student_name_changed'")?.count).toBe(1);
  });

  it("changes a student primary mobile without changing identity or history tables", async () => {
    const fixture = await createFixture();
    const before = counts(fixture.db);
    const result = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "91234 56780",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
      reason: "Student changed number",
    });

    expect(result).toMatchObject({ ok: true, studentId: "student_a", studentNumber: "SYK-SION-0001", personId: "person_a" });
    expect(row(fixture.db, "select person_id, student_number from students where id = 'student_a'")).toMatchObject({ person_id: "person_a", student_number: "SYK-SION-0001" });
    expect(counts(fixture.db)).toMatchObject({
      students: before.students,
      enrolments: before.enrolments,
      enquiries: before.enquiries,
      referrerProfiles: before.referrerProfiles,
      certificates: before.certificates,
      receipts: before.receipts,
    });

    const oldHash = await testMobileHash("9876543210");
    const newHash = await testMobileHash("9123456780");
    expect(row(fixture.db, "select is_primary from person_contacts where person_id = 'person_a' and normalized_value = ?", oldHash)).toMatchObject({ is_primary: 0 });
    expect(row(fixture.db, "select status from person_contact_details where contact_id = 'contact_old_a'")).toMatchObject({ status: "previous" });
    expect(row(fixture.db, "select is_primary, last_four from person_contacts where person_id = 'person_a' and normalized_value = ?", newHash)).toMatchObject({ is_primary: 1, last_four: "6780" });

    expect((await lookupPortalProfilesByMobile(fixture.c, "9123456780")).profiles.map((profile) => profile.personId)).toContain("person_a");
    expect((await lookupPortalProfilesByMobile(fixture.c, "9876543210")).profiles.map((profile) => profile.personId)).not.toContain("person_a");
    expect(JSON.stringify(all(fixture.db, "select metadata_json from audit_logs"))).not.toContain("9123456780");
    expect(JSON.stringify(all(fixture.db, "select metadata_json from audit_logs"))).not.toContain(newHash);
  });

  it("requires explicit confirmation before sharing another active person's mobile", async () => {
    const fixture = await createFixture({ withSharedTarget: true });
    const rejected = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9234567890",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });
    expect(rejected).toMatchObject({ ok: false, status: 409, code: "shared_mobile_confirmation_required" });

    const accepted = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9234567890",
      confirmSharedMobile: true,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });
    expect(accepted).toMatchObject({ ok: true });
    const sharedHash = await testMobileHash("9234567890");
    expect(all(fixture.db, "select person_id from person_contacts where normalized_value = ? order by person_id", sharedHash).map((item) => item.person_id)).toEqual(["person_a", "person_b"]);
    expect(row(fixture.db, "select status from person_contact_details where contact_id = 'contact_shared_b'")).toMatchObject({ status: "active" });
  });

  it("does not duplicate when submitting the same mobile or reactivating a previous mobile", async () => {
    const fixture = await createFixture();
    const same = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9876543210",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });
    expect(same).toMatchObject({ ok: true, idempotent: true });
    expect(row(fixture.db, "select count(*) as count from person_contacts where person_id = 'person_a'")?.count).toBe(1);

    await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", { newMobile: "9123456780", confirmSharedMobile: false, expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a") });
    await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", { newMobile: "9876543210", confirmSharedMobile: false, expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a") });
    expect(row(fixture.db, "select count(*) as count from person_contacts where person_id = 'person_a'")?.count).toBe(2);
    expect(row(fixture.db, "select status from person_contact_details where contact_id = 'contact_old_a'")).toMatchObject({ status: "active" });
  });

  it("denies counsellor maintenance", async () => {
    const fixture = await createFixture();
    const result = await changeStudentPrimaryMobile(fixture.c, { loginAccountId: "acct_counsellor", activePersonId: null, roles: ["counsellor"] }, "student_a", {
      newMobile: "9123456780",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects stale contact versions without mutating the current contact", async () => {
    const fixture = await createFixture();
    const staleVersion = await getStudentContactVersion(fixture.c, "person_a");
    await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9123456780",
      confirmSharedMobile: false,
      expectedContactVersion: staleVersion,
    });
    const stale = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9345678901",
      confirmSharedMobile: false,
      expectedContactVersion: staleVersion,
    });
    expect(stale).toMatchObject({ ok: false, status: 409, code: "stale_contact" });
    expect(row(fixture.db, "select count(*) as count from person_contacts where person_id = 'person_a' and is_primary = 1")?.count).toBe(1);
    expect(row(fixture.db, "select last_four from person_contacts where person_id = 'person_a' and is_primary = 1")).toMatchObject({ last_four: "6780" });
  });

  it("scopes old shared login account and sessions to the changed person only", async () => {
    const fixture = await createFixture({ withSharedOldMobile: true });
    seedLoginAccountForMobile(fixture.db, await testMobileHash("9876543210"), [
      { personId: "person_a", sessionId: "sess_a" },
      { personId: "person_b", sessionId: "sess_b" },
    ]);

    const result = await changeStudentPrimaryMobile(fixture.c, ownerStaff(), "student_a", {
      newMobile: "9123456780",
      confirmSharedMobile: false,
      expectedContactVersion: await getStudentContactVersion(fixture.c, "person_a"),
    });

    expect(result).toMatchObject({ ok: true });
    expect(row(fixture.db, "select is_available from login_account_people where login_account_id = 'acct_9876543210' and person_id = 'person_a'")).toMatchObject({ is_available: 0 });
    expect(row(fixture.db, "select is_available from login_account_people where login_account_id = 'acct_9876543210' and person_id = 'person_b'")).toMatchObject({ is_available: 1 });
    expect(row(fixture.db, "select active_person_id from user_sessions where id = 'sess_a'")).toMatchObject({ active_person_id: null });
    expect(row(fixture.db, "select active_person_id from user_sessions where id = 'sess_b'")).toMatchObject({ active_person_id: "person_b" });
    expect((await lookupPortalProfilesByMobile(fixture.c, "9876543210")).profiles.map((profile) => profile.personId)).toEqual(["person_b"]);
  });
});

async function createFixture(options: { withSharedTarget?: boolean; withSharedOldMobile?: boolean; withLegacyAlumni?: boolean; withSecondEnrolment?: boolean; withOtherBranch?: boolean; withArchived?: boolean } = {}) {
  const db = new DatabaseSync(":memory:");
  installSchema(db);
  seedBase(db);
  await seedStudent(db, "person_a", "student_a", "SYK-SION-0001", "contact_old_a", "9876543210");
  if (options.withSharedTarget) await seedStudent(db, "person_b", "student_b", "SYK-SION-0002", "contact_shared_b", "9234567890");
  if (options.withSharedOldMobile) await seedStudent(db, "person_b", "student_b", "SYK-SION-0002", "contact_old_b", "9876543210");
  if (options.withLegacyAlumni) {
    await seedStudent(db, "person_legacy", "student_legacy", "SYK-SION-LEGACY", "contact_legacy", "9000000001", { withEnquiry: false, withFee: false });
    await seedStudent(db, "person_alumni", "student_alumni", "SYK-SION-ALUMNI", "contact_alumni", "9000000002", { status: "alumni", withEnquiry: false, withFee: false });
  }
  if (options.withSecondEnrolment) {
    db.prepare("insert into enrolments values ('enrol_person_a_second', 'student_a', 'branch_sion', 'course_a', null, 'ENR-SYK-SION-0001-B', 'classroom', null, '2025-01-01', '2025-01-02', null, null, 'completed', 'no', ?, ?)").run(NOW, NOW);
  }
  if (options.withOtherBranch) {
    await seedStudent(db, "person_bandra", "student_bandra", "SYK-BANDRA-0001", "contact_bandra", "9000000003", { branchId: "branch_bandra" });
  }
  if (options.withArchived) {
    await seedStudent(db, "person_archived", "student_archived", "SYK-SION-ARCHIVED", "contact_archived", "9000000004", { personStatus: "archived" });
  }
  const c = { env: { DB: new D1Adapter(db), SESSION_PEPPER: "test-pepper" }, req: { header: () => null } };
  return { db, c: c as never };
}

function seedLoginAccountForMobile(db: DatabaseSync, mobileHashValue: string, links: Array<{ personId: string; sessionId: string }>) {
  db.prepare("insert into login_accounts values ('acct_9876543210', ?, ?, ?, '3210', 1, 'active', null, ?, ?)")
    .run(ORG_ID, mobileHashValue, mobileHashValue, NOW, NOW);
  for (const link of links) {
    db.prepare("insert into login_account_people values ('acct_9876543210', ?, 'self', 0, 1, ?)")
      .run(link.personId, NOW);
    db.prepare("insert into user_sessions values (?, 'acct_9876543210', ?, ?, ?, '2026-09-22T00:00:00.000Z', ?, null)")
      .run(link.sessionId, link.personId, `hash_${link.sessionId}`, NOW, NOW);
  }
}

function installSchema(db: DatabaseSync) {
  db.exec(`
    create table organisations (id text primary key, name text, slug text, status text, created_at text, updated_at text);
    create table branches (id text primary key, organisation_id text, name text, code text, timezone text, status text, created_at text, updated_at text);
    create table people (id text primary key, organisation_id text, home_branch_id text, full_name text, public_name text, date_of_birth text, status text, created_at text, updated_at text);
    create table person_identity_details (person_id text primary key, official_full_name text, date_of_birth text, created_at text, updated_at text);
    create table students (id text primary key, organisation_id text, person_id text, home_branch_id text, student_number text, sequence_number integer, student_since text, current_status text, portal_status text, created_at text, updated_at text);
    create table person_contacts (id text primary key, person_id text, contact_type text, normalized_value text, display_value text, last_four text, is_primary integer, is_verified integer, verified_at text, created_at text, updated_at text, unique(person_id, contact_type, normalized_value));
    create table person_contact_details (contact_id text primary key, belongs_to text, contact_label text, is_whatsapp integer, valid_from text, valid_until text, status text, created_at text, updated_at text);
    create table person_contact_secrets (contact_id text primary key, value_ciphertext text, encryption_version text, created_at text, updated_at text);
    create table login_accounts (id text primary key, organisation_id text, mobile_normalized text, mobile_hash text, mobile_last_four text, login_enabled integer, status text, last_login_at text, created_at text, updated_at text, unique(organisation_id, mobile_normalized));
    create table login_account_people (login_account_id text, person_id text, access_type text, is_default integer, is_available integer, created_at text, primary key(login_account_id, person_id));
    create table user_sessions (id text primary key, login_account_id text, active_person_id text, token_hash text, created_at text, expires_at text, last_seen_at text, revoked_at text);
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table person_roles (person_id text, role_id text, branch_id text, branch_key text, created_at text);
    create table referral_programmes (id text primary key, organisation_id text, code text, status text);
    create table referral_programme_referrer_types (referral_programme_id text, referrer_type text);
    create table referrer_profiles (id text primary key, organisation_id text, person_id text, external_referrer_id text, referral_token text, personal_link text, active integer, created_at text, updated_at text);
    create table referral_links (id text primary key, organisation_id text, referral_programme_id text, referrer_profile_id text, token_hash text, token_last_four text, link_version integer, status text, activated_at text, expires_at text, revoked_at text, last_used_at text, created_at text, updated_at text);
    create table courses (id text primary key, organisation_id text, code text, name text, duration_label text);
    create table enrolments (id text primary key, student_id text, branch_id text, course_id text, enquiry_id text, enrolment_number text, training_mode text, batch_preference text, admission_date text, joining_date text, expected_completion_date text, actual_completion_date text, status text, nsdc_preference text, created_at text, updated_at text);
    create table fee_agreements (id text primary key, enrolment_id text, final_agreed_fee_paise integer, payment_plan_type text, status text);
    create table enquiries (id text primary key, person_id text);
    create table certificate_issues (id text primary key, person_id text, student_name_snapshot text);
    create table receipts (id text primary key, person_id text);
    create table referrals (id text primary key, prospect_person_id text, prospect_name text);
    create table referral_reward_snapshots (id text primary key, referral_id text, snapshot_json text);
    create table admission_drafts (id text primary key, person_id text, confirmation_snapshot_json text);
    create table batch_memberships (id text primary key, enrolment_id text, batch_id text, status text);
    create table audit_logs (id text primary key, organisation_id text, branch_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, metadata_json text, created_at text);
  `);
}

function seedBase(db: DatabaseSync) {
  db.prepare("insert into organisations values (?, 'Samyak', 'samyak', 'active', ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into branches values ('branch_sion', ?, 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into branches values ('branch_bandra', ?, 'Bandra', 'BANDRA', 'Asia/Kolkata', 'active', ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into roles values ('role_owner', ?, 'owner', 'Owner', ?), ('role_student', ?, 'student', 'Student', ?), ('role_counsellor', ?, 'counsellor', 'Counsellor', ?), ('role_partner', ?, 'partner', 'Partner', ?)").run(ORG_ID, NOW, ORG_ID, NOW, ORG_ID, NOW, ORG_ID, NOW);
  db.prepare("insert into login_accounts values ('acct_owner', ?, 'owner', 'owner', '0000', 1, 'active', null, ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_owner_sion', ?, 'owner-sion', 'owner-sion', '0002', 1, 'active', null, ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_counsellor', ?, 'counsellor', 'counsellor', '0001', 1, 'active', null, ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_student', ?, 'student', 'student', '0003', 1, 'active', null, ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into login_accounts values ('acct_partner', ?, 'partner', 'partner', '0004', 1, 'active', null, ?, ?)").run(ORG_ID, NOW, NOW);
  db.prepare("insert into login_account_roles values ('acct_owner', 'role_owner', null, ?), ('acct_owner_sion', 'role_owner', 'branch_sion', ?), ('acct_counsellor', 'role_counsellor', null, ?), ('acct_student', 'role_student', null, ?), ('acct_partner', 'role_partner', null, ?)").run(NOW, NOW, NOW, NOW, NOW);
  db.prepare("insert into referral_programmes values ('prog_skill_circle', ?, 'samyak_skill_circle', 'active')").run(ORG_ID);
  db.prepare("insert into referral_programme_referrer_types values ('prog_skill_circle', 'student')").run();
  db.prepare("insert into courses values ('course_a', ?, 'AEX', 'Advanced Excel', '3 months')").run(ORG_ID);
}

async function seedStudent(
  db: DatabaseSync,
  personId: string,
  studentId: string,
  studentNumber: string,
  contactId: string,
  mobile: string,
  options: { branchId?: string; status?: string; personStatus?: string; withEnquiry?: boolean; withFee?: boolean } = {},
) {
  const branchId = options.branchId || "branch_sion";
  const currentStatus = options.status || "active";
  const personStatus = options.personStatus || "active";
  const hash = await testMobileHash(mobile);
  db.prepare("insert into people values (?, ?, ?, ?, ?, null, ?, ?, ?)").run(personId, ORG_ID, branchId, `${personId} Name`, `${personId} Name`, personStatus, NOW, NOW);
  db.prepare("insert into person_identity_details values (?, ?, '2000-01-01', ?, ?)").run(personId, `${personId} Official`, NOW, NOW);
  db.prepare("insert into students values (?, ?, ?, ?, ?, 1, '2024-01-01', ?, 'active', ?, ?)").run(studentId, ORG_ID, personId, branchId, studentNumber, currentStatus, NOW, NOW);
  db.prepare("insert into person_contacts values (?, ?, 'mobile', ?, null, ?, 1, 1, null, ?, ?)").run(contactId, personId, hash, mobile.slice(-4), NOW, NOW);
  db.prepare("insert into person_contact_details values (?, 'student', null, 1, null, null, 'active', ?, ?)").run(contactId, NOW, NOW);
  db.prepare("insert into person_roles values (?, 'role_student', null, '', ?)").run(personId, NOW);
  db.prepare("insert into referrer_profiles values (?, ?, ?, ?, ?, ?, 1, ?, ?)").run(`ref_${personId}`, ORG_ID, personId, `ext_${personId}`, `token_${personId}`, `link_${personId}`, NOW, NOW);
  db.prepare("insert into enrolments values (?, ?, ?, 'course_a', null, ?, 'classroom', null, '2024-01-01', '2024-01-02', null, null, 'active', 'no', ?, ?)").run(`enrol_${personId}`, studentId, branchId, `ENR-${studentNumber}`, NOW, NOW);
  if (options.withFee !== false) db.prepare("insert into fee_agreements values (?, ?, 100000, 'full', 'active')").run(`fee_${personId}`, `enrol_${personId}`);
  if (options.withEnquiry !== false) db.prepare("insert into enquiries values (?, ?)").run(`enq_${personId}`, personId);
  db.prepare("insert into certificate_issues values (?, ?, ?)").run(`cert_${personId}`, personId, `${personId} Issued Name`);
  db.prepare("insert into receipts values (?, ?)").run(`receipt_${personId}`, personId);
  db.prepare("insert into referrals values (?, ?, ?)").run(`referral_${personId}`, personId, `${personId} Prospect Snapshot`);
  db.prepare("insert into referral_reward_snapshots values (?, ?, ?)").run(`reward_${personId}`, `referral_${personId}`, JSON.stringify({ personId, atIssue: true }));
  db.prepare("insert into admission_drafts values (?, ?, ?)").run(`draft_${personId}`, personId, JSON.stringify({ fullName: `${personId} Locked Snapshot` }));
}

function ownerStaff() {
  return { loginAccountId: "acct_owner", activePersonId: null, roles: ["owner"] };
}

function branchOwnerStaff() {
  return { loginAccountId: "acct_owner_sion", activePersonId: null, roles: ["owner"] };
}

async function testMobileHash(mobile: string) {
  return hmacHex("test-pepper", "mobile", mobile);
}

function counts(db: DatabaseSync) {
  return {
    students: row(db, "select count(*) as count from students")?.count,
    enrolments: row(db, "select count(*) as count from enrolments")?.count,
    enquiries: row(db, "select count(*) as count from enquiries")?.count,
    referrerProfiles: row(db, "select count(*) as count from referrer_profiles")?.count,
    certificates: row(db, "select count(*) as count from certificate_issues")?.count,
    receipts: row(db, "select count(*) as count from receipts")?.count,
  };
}

function snapshot(db: DatabaseSync, studentId: string) {
  const student = row(db, "select id, student_number, person_id from students where id = ?", studentId);
  const personId = String(student?.person_id || "");
  return {
    studentId: student?.id,
    studentNumber: student?.student_number,
    personId,
    enrolments: all(db, "select id, student_id, enrolment_number from enrolments where student_id = ? order by id", studentId),
    contacts: all(db, "select id, person_id, normalized_value, last_four, is_primary from person_contacts where person_id = ? order by id", personId),
    loginLinks: all(db, "select login_account_id, person_id, is_available from login_account_people where person_id = ? order by login_account_id", personId),
    sessions: all(db, "select id, login_account_id, active_person_id from user_sessions where active_person_id = ? order by id", personId),
    batchMemberships: all(db, "select id, enrolment_id, batch_id, status from batch_memberships where enrolment_id in (select id from enrolments where student_id = ?) order by id", studentId),
    certificates: all(db, "select id, person_id, student_name_snapshot from certificate_issues where person_id = ? order by id", personId),
    receipts: all(db, "select id, person_id from receipts where person_id = ? order by id", personId),
    referrals: all(db, "select id, prospect_person_id, prospect_name from referrals where prospect_person_id = ? order by id", personId),
    referralRewardSnapshots: all(db, "select referral_reward_snapshots.* from referral_reward_snapshots join referrals on referrals.id = referral_reward_snapshots.referral_id where referrals.prospect_person_id = ? order by referral_reward_snapshots.id", personId),
    admissionDrafts: all(db, "select id, person_id, confirmation_snapshot_json from admission_drafts where person_id = ? order by id", personId),
  };
}

function row(db: DatabaseSync, sql: string, ...values: SqlValue[]) {
  return db.prepare(sql).get(...values) as Record<string, any> | undefined;
}

function all(db: DatabaseSync, sql: string, ...values: SqlValue[]) {
  return db.prepare(sql).all(...values) as Array<Record<string, any>>;
}

class D1Adapter {
  constructor(private readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new D1Statement(this.db, sql);
  }
  async batch(statements: D1Statement[]) {
    this.db.exec("begin");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("commit");
      return results;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
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
  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: result.changes } };
  }
}
