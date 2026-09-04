/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import type { WorkerBindings } from "../bindings";
import { hmacHex } from "../lib/crypto";
import { issueReferralLink } from "../lib/referral-service";
import { requireReferralTokenPepper } from "../lib/referral-token";

const NOW = "2026-08-25T10:00:00.000Z";
const SESSION_PEPPER = "test-session-pepper";
const REFERRAL_TOKEN_PEPPER = "test-referral-token-pepper";
const PARTNER_MOBILE = "9876543210";
const NEW_PARTNER_MOBILE = "9876543211";
const STUDENT_MOBILE = "9876543222";

type Row = Record<string, any>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

describe("Education Partner portal security", () => {
  it("adds only additive Partner auth objects and enforces session subject exclusivity", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("pragma foreign_keys = on");
    applyMigrationsThrough(db, "0022_referral_link_encrypted_recovery.sql");
    seedBase(db);
    await seedLoginAccount(db, "acct_existing", STUDENT_MOBILE);
    await seedPersonStudent(db, "person_existing", "student_existing", STUDENT_MOBILE);
    await seedSessionRow(db, "sess_existing", "acct_existing", "person_existing", null);

    expect(() => applyMigrationFile(db, "0023_education_partner_portal_v1.sql")).not.toThrow();
    expect(columns(db, "user_sessions")).toContain("active_education_partner_id");
    expect(columns(db, "login_account_education_partners")).toEqual(["login_account_id", "education_partner_id", "created_at"]);
    expect(count(db, "login_account_education_partners")).toBe(0);
    expect(row(db, "select active_person_id, active_education_partner_id from user_sessions where id = 'sess_existing'")).toMatchObject({
      active_person_id: "person_existing",
      active_education_partner_id: null,
    });

    await seedEducationPartner(db, "epartner_a", PARTNER_MOBILE, { referrerProfileId: "refprof_partner_a" });
    await expect(seedSessionRow(db, "sess_bad", "acct_existing", "person_existing", "epartner_a")).rejects.toThrow(/both person and education partner/i);
    db.close();
  });

  it("preserves existing Partner session subjects when migration 0027 is applied", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec("pragma foreign_keys = on");
    applyMigrationsThrough(db, "0026_certificate_applications_feedback.sql");
    seedBase(db);
    await seedLoginAccount(db, "acct_student_existing", STUDENT_MOBILE);
    await seedLoginAccount(db, "acct_staff_existing", "9876543333");
    await seedLoginAccount(db, "acct_partner_existing", PARTNER_MOBILE);
    await seedLoginAccount(db, "acct_unselected_existing", "9876543334");
    await seedPersonStudent(db, "person_student_existing", "student_subject_existing", STUDENT_MOBILE);
    db.prepare("insert or ignore into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_staff_existing', 'org_samyak', 'branch_sion', 'Staff Existing', 'Staff Existing', 'active', ?, ?)")
      .run(NOW, NOW);
    await seedEducationPartner(db, "epartner_existing", PARTNER_MOBILE, { referrerProfileId: "refprof_partner_existing" });
    await seedSessionRow(db, "sess_student_existing", "acct_student_existing", "person_student_existing", null);
    await seedSessionRow(db, "sess_staff_existing", "acct_staff_existing", "person_staff_existing", null);
    await seedSessionRow(db, "sess_partner_existing", "acct_partner_existing", null, "epartner_existing");
    await seedSessionRow(db, "sess_unselected_existing", "acct_unselected_existing", null, null);

    applyMigrationFile(db, "0027_trainer_attendance_sessions.sql");

    expect(row(db, "select active_subject_type from user_sessions where id = 'sess_student_existing'")).toMatchObject({ active_subject_type: "person" });
    expect(row(db, "select active_subject_type from user_sessions where id = 'sess_staff_existing'")).toMatchObject({ active_subject_type: "person" });
    expect(row(db, "select active_subject_type from user_sessions where id = 'sess_partner_existing'")).toMatchObject({ active_subject_type: "partner" });
    expect(row(db, "select active_subject_type from user_sessions where id = 'sess_unselected_existing'")).toMatchObject({ active_subject_type: "person" });
    expect(count(db, "user_sessions where active_subject_type = 'trainer'")).toBe(0);
    db.close();
  });

  it("logs in active Partners with OTP, hides unknown/inactive enumeration, blocks replay and wrong or expired OTPs", async () => {
    const fixture = await createFixture();
    try {
      installTurnstile();
      await seedEducationPartner(fixture.sqlite, "epartner_a", PARTNER_MOBILE, { referrerProfileId: "refprof_partner_a" });
      await seedEducationPartner(fixture.sqlite, "epartner_inactive", "9876543219", { referrerProfileId: "refprof_partner_inactive", status: "inactive" });

      const unknown = await requestPartnerOtp(fixture.env, "9000000000");
      const known = await requestPartnerOtp(fixture.env, PARTNER_MOBILE);
      const inactive = await requestPartnerOtp(fixture.env, "9876543219");
      expect(unknown.status).toBe(200);
      expect(known.status).toBe(200);
      expect(inactive.status).toBe(200);
      await expect(unknown.json()).resolves.toMatchObject({ success: true, message: "If this mobile number is registered, an OTP has been sent." });
      await expect(inactive.json()).resolves.toMatchObject({ success: true, message: "If this mobile number is registered, an OTP has been sent." });

      const challengeId = ((await known.json()) as Row).challengeId as string;
      expect((await verifyPartnerOtp(fixture.env, challengeId, "0000")).status).toBe(400);
      const login = await verifyPartnerOtp(fixture.env, challengeId);
      expect(login.status).toBe(200);
      const loginBody = (await login.json()) as Row;
      expect(loginBody.session.activePartner).toMatchObject({ educationPartnerId: "epartner_a" });
      expect(row(fixture.sqlite, "select active_person_id, active_education_partner_id from user_sessions order by created_at desc limit 1")).toMatchObject({
        active_person_id: null,
        active_education_partner_id: "epartner_a",
      });
      expect((await verifyPartnerOtp(fixture.env, challengeId)).status).toBe(400);

      resetOtpRateLimits(fixture.sqlite, PARTNER_MOBILE);
      const expired = await requestPartnerOtp(fixture.env, PARTNER_MOBILE);
      const expiredChallengeId = ((await expired.json()) as Row).challengeId as string;
      fixture.sqlite.prepare("update otp_challenges set expires_at = '2000-01-01T00:00:00.000Z' where id = ?").run(expiredChallengeId);
      expect((await verifyPartnerOtp(fixture.env, expiredChallengeId)).status).toBe(400);
    } finally {
      fixture.close();
    }
  });

  it("isolates same-mobile Student and Partner sessions and denies Partner-scoped staff access", async () => {
    const fixture = await createFixture();
    try {
      installTurnstile();
      await seedPersonStudent(fixture.sqlite, "person_same", "student_same", PARTNER_MOBILE);
      await seedEducationPartner(fixture.sqlite, "epartner_a", PARTNER_MOBILE, { referrerProfileId: "refprof_partner_a" });
      seedStaffRole(fixture.sqlite, "acct_same", "owner");

      const partnerCookie = await loginPartner(fixture.env, PARTNER_MOBILE);
      expect((await app.request("http://localhost/api/partner/me", { headers: { Cookie: partnerCookie } }, fixture.env)).status).toBe(200);
      const appSession = await app.request("http://localhost/api/auth/session", { headers: { Cookie: partnerCookie } }, fixture.env);
      await expect(appSession.json()).resolves.toMatchObject({ authenticated: false, code: "PARTNER_SESSION_ACTIVE" });
      expect((await app.request("http://localhost/api/staff/education-partners", { headers: { Cookie: partnerCookie } }, fixture.env)).status).toBe(403);
      expect((await app.request("http://localhost/api/student/home", { headers: { Cookie: partnerCookie } }, fixture.env)).status).toBe(409);

      resetOtpRateLimits(fixture.sqlite, PARTNER_MOBILE);
      const studentCookie = await loginStudent(fixture.env, PARTNER_MOBILE);
      expect((await app.request("http://localhost/api/student/home", { headers: { Cookie: studentCookie } }, fixture.env)).status).toBe(200);
      const partnerSession = await app.request("http://localhost/api/partner/session", { headers: { Cookie: studentCookie } }, fixture.env);
      await expect(partnerSession.json()).resolves.toMatchObject({ authenticated: false, code: "PERSON_SESSION_ACTIVE" });
      expect((await selectPartner(fixture.env, studentCookie, "epartner_a")).status).toBe(401);
    } finally {
      fixture.close();
    }
  });

  it("requires explicit selection for multiple Partners on one mobile and rejects cross-Partner selection", async () => {
    const fixture = await createFixture();
    try {
      installTurnstile();
      await seedEducationPartner(fixture.sqlite, "epartner_a", PARTNER_MOBILE, { businessName: "ABC Career Academy", referrerProfileId: "refprof_partner_a" });
      await seedEducationPartner(fixture.sqlite, "epartner_b", PARTNER_MOBILE, { businessName: "XYZ College", referrerProfileId: "refprof_partner_b" });
      await seedEducationPartner(fixture.sqlite, "epartner_c", "9876543212", { businessName: "Other Partner", referrerProfileId: "refprof_partner_c" });

      const { cookie, body } = await loginPartnerUnselected(fixture.env, PARTNER_MOBILE);
      expect(body.session.activePartner).toBeNull();
      expect(body.session.partners.map((partner: Row) => partner.businessName)).toEqual(["ABC Career Academy", "XYZ College"]);

      const rejected = await selectPartner(fixture.env, cookie, "epartner_c");
      expect(rejected.status).toBe(403);
      const selected = await selectPartner(fixture.env, cookie, "epartner_a");
      expect(selected.status).toBe(200);
      expect(row(fixture.sqlite, "select active_person_id, active_education_partner_id from user_sessions order by created_at desc limit 1")).toMatchObject({
        active_person_id: null,
        active_education_partner_id: "epartner_a",
      });
    } finally {
      fixture.close();
    }
  });

  it("clears stale Partner mappings and sessions when owner changes mobile or deactivates a Partner", async () => {
    const fixture = await createFixture();
    try {
      installTurnstile();
      await seedEducationPartner(fixture.sqlite, "epartner_a", PARTNER_MOBILE, { referrerProfileId: "refprof_partner_a" });
      await seedEducationPartner(fixture.sqlite, "epartner_b", PARTNER_MOBILE, { referrerProfileId: "refprof_partner_b" });
      const partnerCookie = await loginPartner(fixture.env, PARTNER_MOBILE, "epartner_a");
      seedOwner(fixture.sqlite, "acct_owner");
      const ownerCookie = await seedSession(fixture.sqlite, "acct_owner", "person_owner", null, "owner-token");

      const updateMobile = await patchPartner(fixture.env, ownerCookie, "epartner_a", { mobile: NEW_PARTNER_MOBILE });
      expect(updateMobile.status).toBe(200);
      expect(count(fixture.sqlite, "login_account_education_partners where education_partner_id = 'epartner_a'")).toBe(0);
      expect(row(fixture.sqlite, "select active_education_partner_id from user_sessions where id like 'sess_%' and active_education_partner_id is null limit 1")).toBeTruthy();
      expect((await app.request("http://localhost/api/partner/me", { headers: { Cookie: partnerCookie } }, fixture.env)).status).toBe(401);
      resetOtpRateLimits(fixture.sqlite, PARTNER_MOBILE);
      const oldMobile = await requestPartnerOtp(fixture.env, PARTNER_MOBILE);
      const oldLogin = await verifyPartnerOtp(fixture.env, ((await oldMobile.json()) as Row).challengeId as string);
      expect(oldLogin.status).toBe(200);
      await expect(oldLogin.json()).resolves.toMatchObject({ session: { activePartner: { educationPartnerId: "epartner_b" } } });
      const newMobile = await requestPartnerOtp(fixture.env, NEW_PARTNER_MOBILE);
      expect(newMobile.status).toBe(200);
      const newLogin = await verifyPartnerOtp(fixture.env, ((await newMobile.json()) as Row).challengeId as string);
      expect(newLogin.status).toBe(200);
      const newLoginCookie = sessionCookie(newLogin);
      expect((await app.request("http://localhost/api/partner/me", { headers: { Cookie: newLoginCookie } }, fixture.env)).status).toBe(200);
      expect(count(fixture.sqlite, "login_account_education_partners where education_partner_id = 'epartner_b'")).toBe(1);

      const deactivate = await patchPartner(fixture.env, ownerCookie, "epartner_a", { mobile: NEW_PARTNER_MOBILE, status: "inactive" });
      expect(deactivate.status).toBe(200);
      expect((await app.request("http://localhost/api/partner/me", { headers: { Cookie: newLoginCookie } }, fixture.env)).status).toBe(401);
    } finally {
      fixture.close();
    }
  });

  it("returns only own referral data, friendly commission states, snapshot amounts and payout date/mode", async () => {
    const fixture = await createFixture();
    try {
      installTurnstile();
      await seedEducationPartner(fixture.sqlite, "epartner_a", PARTNER_MOBILE, { referrerProfileId: "refprof_partner_a", commissionBps: 1000 });
      await seedEducationPartner(fixture.sqlite, "epartner_b", "9876543212", { referrerProfileId: "refprof_partner_b", commissionBps: 1200 });
      await seedRecoverableLink(fixture.env, "refprof_partner_a");
      seedPartnerReferralSet(fixture.sqlite);
      const cookie = await loginPartner(fixture.env, PARTNER_MOBILE);

      const response = await app.request("http://localhost/api/partner/me?limit=50", { headers: { Cookie: cookie } }, fixture.env);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Row;
      const serialized = JSON.stringify(body);
      expect(body.referralLink.publicUrl).toMatch(/^https:\/\/go\.samyaksion\.com\/r\//);
      expect(body.summary).toMatchObject({
        totalReferrals: 5,
        admissions: 4,
        awaitingAdmission: 1,
        awaitingPayment: 1,
        qualified: 1,
        approved: 1,
        paid: 1,
        totalApprovedCommissionPaise: 200000,
        totalPaidCommissionPaise: 125000,
      });
      expect(body.referrals.map((item: Row) => item.prospectPublicName)).toEqual(expect.arrayContaining(["Awaiting A.", "Payment P.", "Qualified Q.", "Approved A.", "Paid P."]));
      expect(serialized).not.toContain("Hidden Mobile");
      expect(serialized).not.toContain("9000000001");
      expect(serialized).not.toContain("learner@example.com");
      expect(serialized).not.toContain("upi-reference-secret");
      expect(serialized).not.toContain("internal note");
      expect(serialized).not.toContain("token_hash");
      expect(serialized).not.toContain("ciphertext");
      expect(serialized).not.toContain("ref_b_only");
      expect(body.referrals.find((item: Row) => item.prospectPublicName === "Payment P.").approvedCommissionPaise).toBe(0);
      expect(body.referrals.find((item: Row) => item.prospectPublicName === "Approved A.").approvedCommissionPaise).toBe(75000);
      expect(body.referrals.find((item: Row) => item.prospectPublicName === "Paid P.")).toMatchObject({
        commissionStatus: "Paid",
        approvedCommissionPaise: 125000,
        paidCommissionPaise: 125000,
        paymentMode: "upi",
      });
    } finally {
      fixture.close();
    }
  });

  it("denies Partner replacement endpoints and keeps owner preview equal to self without creating Partner session", async () => {
    const fixture = await createFixture();
    try {
      installTurnstile();
      await seedEducationPartner(fixture.sqlite, "epartner_a", PARTNER_MOBILE, { referrerProfileId: "refprof_partner_a" });
      await seedEducationPartner(fixture.sqlite, "epartner_b", "9876543212", { referrerProfileId: "refprof_partner_b" });
      await seedRecoverableLink(fixture.env, "refprof_partner_a");
      seedPartnerReferralSet(fixture.sqlite);
      const partnerCookie = await loginPartner(fixture.env, PARTNER_MOBILE);
      const partnerView = (await (await app.request("http://localhost/api/partner/me?limit=20", { headers: { Cookie: partnerCookie } }, fixture.env)).json()) as Row;
      expect((await app.request("http://localhost/api/partner/referral-link/replace", { method: "POST", headers: { Origin: "http://localhost", Cookie: partnerCookie } }, fixture.env)).status).toBe(404);

      seedOwner(fixture.sqlite, "acct_owner");
      seedStaffRole(fixture.sqlite, "acct_staff", "counsellor");
      const ownerCookie = await seedSession(fixture.sqlite, "acct_owner", "person_owner", null, "owner-token");
      const nonOwnerCookie = await seedSession(fixture.sqlite, "acct_staff", null, null, "staff-token");
      const preview = await app.request("http://localhost/api/staff/education-partners/epartner_a/portal-preview?limit=20", { headers: { Cookie: ownerCookie } }, fixture.env);
      const nonOwner = await app.request("http://localhost/api/staff/education-partners/epartner_a/portal-preview", { headers: { Cookie: nonOwnerCookie } }, fixture.env);
      expect(preview.status).toBe(200);
      expect(nonOwner.status).toBe(403);
      const previewBody = (await preview.json()) as Row;
      expect(previewBody.preview).toBe(true);
      const { preview: _previewFlag, requestId: _previewRequestId, ...previewCore } = previewBody;
      const { requestId: _selfRequestId, ...selfCore } = partnerView;
      expect(previewCore).toEqual(selfCore);
      expect(count(fixture.sqlite, "user_sessions where active_education_partner_id = 'epartner_a'")).toBe(1);
    } finally {
      fixture.close();
    }
  });
});

async function createFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("pragma foreign_keys = on");
  applyAllMigrations(sqlite);
  seedBase(sqlite);
  const env = bindings(sqlite);
  return { sqlite, env, close: () => sqlite.close() };
}

function bindings(sqlite: DatabaseSync, overrides: Partial<WorkerBindings> = {}): WorkerBindings {
  return {
    DB: new SqliteD1(sqlite) as unknown as D1Database,
    ENVIRONMENT: "development",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SESSION_PEPPER,
    REFERRAL_TOKEN_PEPPER,
    DEV_OTP: "123456",
    ...overrides,
  };
}

function installTurnstile() {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: true, action: "request-otp", hostname: "localhost" }), { status: 200, headers: { "Content-Type": "application/json" } });
    throw new Error(`Unexpected fetch in Partner portal test: ${url}`);
  }));
}

async function requestPartnerOtp(env: WorkerBindings, mobile: string) {
  return app.request("http://localhost/api/partner/auth/request-otp", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ mobile, turnstileToken: "turnstile-token" }),
  }, env);
}

async function verifyPartnerOtp(env: WorkerBindings, challengeId: string, otp = "123456") {
  return app.request("http://localhost/api/partner/auth/verify-otp", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, otp }),
  }, env);
}

async function loginPartner(env: WorkerBindings, mobile: string, partnerId?: string) {
  const { cookie, body } = await loginPartnerUnselected(env, mobile);
  if (body.session.activePartner) return cookie;
  if (!partnerId) throw new Error("Partner selection required");
  const selected = await selectPartner(env, cookie, partnerId);
  expect(selected.status).toBe(200);
  return cookie;
}

async function loginPartnerUnselected(env: WorkerBindings, mobile: string) {
  const otp = await requestPartnerOtp(env, mobile);
  const challengeId = ((await otp.json()) as Row).challengeId as string;
  const verified = await verifyPartnerOtp(env, challengeId);
  expect(verified.status).toBe(200);
  return { cookie: sessionCookie(verified), body: (await verified.json()) as Row };
}

async function selectPartner(env: WorkerBindings, cookie: string, educationPartnerId: string) {
  return app.request("http://localhost/api/partner/auth/select-profile", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ educationPartnerId }),
  }, env);
}

async function loginStudent(env: WorkerBindings, mobile: string) {
  const otp = await app.request("http://localhost/api/auth/request-otp", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ mobile, turnstileToken: "turnstile-token" }),
  }, env);
  const challengeId = ((await otp.json()) as Row).challengeId as string;
  const verified = await app.request("http://localhost/api/auth/verify-otp", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, otp: "123456" }),
  }, env);
  expect(verified.status).toBe(200);
  return sessionCookie(verified);
}

async function patchPartner(env: WorkerBindings, cookie: string, partnerId: string, overrides: Partial<{ mobile: string; status: string }>) {
  return app.request(`http://localhost/api/staff/education-partners/${partnerId}`, {
    method: "PATCH",
    headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      partnerType: "college",
      businessName: partnerId === "epartner_b" ? "Partner B" : "Partner A",
      contactPersonName: "Partner Contact",
      mobile: overrides.mobile ?? PARTNER_MOBILE,
      email: "",
      homeBranchId: "branch_sion",
      commissionPercent: "10",
      status: overrides.status ?? "active",
      internalNotes: "internal note",
    }),
  }, env);
}

async function seedRecoverableLink(env: WorkerBindings, referrerProfileId: string) {
  return issueReferralLink({
    DB: env.DB,
    SESSION_PEPPER: env.SESSION_PEPPER,
    referralTokenPepper: requireReferralTokenPepper(env.REFERRAL_TOKEN_PEPPER || ""),
  }, {
    organisationId: "org_samyak",
    referralProgrammeId: "rprog_samyak_education_partners",
    referrerProfileId,
    loginAccountId: "acct_system",
    now: NOW,
  });
}

function applyAllMigrations(db: DatabaseSync) {
  for (const file of migrationFiles()) {
    if (file === "0012_d1_referral_foundation.sql") seedOrganisation(db);
    applyMigrationFile(db, file);
  }
}

function applyMigrationsThrough(db: DatabaseSync, throughFile: string) {
  for (const file of migrationFiles()) {
    if (file > throughFile) break;
    if (file === "0012_d1_referral_foundation.sql") seedOrganisation(db);
    applyMigrationFile(db, file);
  }
}

function migrationFiles() {
  return readdirSync(join(process.cwd(), "migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
}

function applyMigrationFile(db: DatabaseSync, file: string) {
  const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
}

function seedBase(db: DatabaseSync) {
  seedOrganisation(db);
  db.exec(`
    insert or ignore into roles (id, organisation_id, code, name, created_at) values
      ('role_owner', 'org_samyak', 'owner', 'Owner', '${NOW}'),
      ('role_counsellor', 'org_samyak', 'counsellor', 'Counsellor', '${NOW}'),
      ('role_student', 'org_samyak', 'student', 'Student', '${NOW}');
    insert or ignore into courses (id, organisation_id, code, name, duration_label, default_fee_paise, nsdc_available, status, created_at, updated_at)
      values ('course_fsd', 'org_samyak', 'FSD', 'Full Stack Development', '12 months', 2360000, 0, 'active', '${NOW}', '${NOW}');
    insert or ignore into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at)
      values ('acct_system', 'org_samyak', 'system', 'system', '0000', 1, 'active', '${NOW}', '${NOW}');
  `);
}

function seedOrganisation(db: DatabaseSync) {
  db.exec(`
    insert or ignore into organisations (id, name, slug, status, created_at, updated_at)
      values ('org_samyak', 'Samyak', 'samyak', 'active', '${NOW}', '${NOW}');
    insert or ignore into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
      values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '${NOW}', '${NOW}');
  `);
}

async function seedLoginAccount(db: DatabaseSync, accountId: string, mobile: string) {
  const hash = await hmacHex(SESSION_PEPPER, "mobile", mobile);
  db.prepare(
    `insert or ignore into login_accounts
      (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at)
     values (?, 'org_samyak', ?, ?, ?, 1, 'active', ?, ?)`,
  ).run(accountId, hash, hash, mobile.slice(-4), NOW, NOW);
}

async function seedPersonStudent(db: DatabaseSync, personId: string, studentId: string, mobile: string) {
  const mobileHash = await hmacHex(SESSION_PEPPER, "mobile", mobile);
  db.prepare("insert or ignore into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', ?, ?, 'active', ?, ?)")
    .run(personId, `${personId} Full`, `${personId} Public`, NOW, NOW);
  db.prepare("insert or ignore into person_contacts (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, verified_at, created_at, updated_at) values (?, ?, 'mobile', ?, ?, ?, 1, 1, ?, ?, ?)")
    .run(`contact_${personId}`, personId, mobileHash, `••••••${mobile.slice(-4)}`, mobile.slice(-4), NOW, NOW, NOW);
  db.prepare("insert or ignore into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values (?, 'org_samyak', ?, 'branch_sion', ?, ?, ?, 'active', 'active', ?, ?)")
    .run(studentId, personId, `STU-${studentId}`, deterministicSequence(studentId), NOW, NOW, NOW);
  db.prepare("insert or ignore into person_roles (person_id, role_id, branch_id, branch_key, created_at) values (?, 'role_student', null, '', ?)")
    .run(personId, NOW);
  db.prepare("insert or ignore into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values (?, 'org_samyak', ?, ?, ?, '', 1, ?, ?)")
    .run(`refprof_${personId}`, personId, `student:${personId}`, `token_${personId}`, NOW, NOW);
}

async function seedEducationPartner(db: DatabaseSync, partnerId: string, mobile: string, options: { businessName?: string; referrerProfileId: string; status?: string; commissionBps?: number }) {
  const partnerMobileHash = await hmacHex(SESSION_PEPPER, "education-partner-mobile", mobile);
  db.prepare(
    `insert or replace into education_partners
      (id, organisation_id, home_branch_id, partner_type, business_name, contact_person_name, mobile_hash, mobile_last_four, status, current_commission_basis_points, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', 'college', ?, 'Partner Contact', ?, ?, ?, ?, ?, ?)`,
  ).run(partnerId, options.businessName || (partnerId === "epartner_b" ? "Partner B" : "Partner A"), partnerMobileHash, mobile.slice(-4), options.status || "active", options.commissionBps || 1000, NOW, NOW);
  db.prepare("insert or replace into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values (?, 'org_samyak', null, ?, ?, '', ?, ?, ?)")
    .run(options.referrerProfileId, `education_partner:${partnerId}`, `token_${partnerId}`, options.status === "inactive" ? 0 : 1, NOW, NOW);
  db.prepare("insert or ignore into education_partner_referrer_profiles (education_partner_id, referrer_profile_id, created_at) values (?, ?, ?)")
    .run(partnerId, options.referrerProfileId, NOW);
}

function seedOwner(db: DatabaseSync, accountId: string) {
  db.prepare("insert or ignore into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_owner', 'org_samyak', 'branch_sion', 'Owner User', 'Owner', 'active', ?, ?)").run(NOW, NOW);
  seedStaffRole(db, accountId, "owner");
}

function seedStaffRole(db: DatabaseSync, accountId: string, roleCode: string) {
  db.prepare("insert or ignore into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at) values (?, 'org_samyak', ?, ?, '9999', 1, 'active', ?, ?)")
    .run(accountId, accountId, accountId, NOW, NOW);
  db.prepare("insert or ignore into login_account_roles (login_account_id, role_id, branch_id, created_at) values (?, ?, null, ?)")
    .run(accountId, `role_${roleCode}`, NOW);
}

async function seedSession(db: DatabaseSync, accountId: string, personId: string | null, partnerId: string | null, token: string) {
  await seedSessionRow(db, `sess_${token.replace(/[^a-z0-9]/gi, "_")}`, accountId, personId, partnerId, token);
  return `samyak_session=${token}`;
}

async function seedSessionRow(db: DatabaseSync, sessionId: string, accountId: string, personId: string | null, partnerId: string | null, token = `${sessionId}-token`) {
  const tokenHash = await hmacHex(SESSION_PEPPER, "session", token);
  if (!columns(db, "user_sessions").includes("active_education_partner_id")) {
    if (partnerId) throw new Error("active_education_partner_id is not available before migration 0023");
    db.prepare(
      `insert into user_sessions
        (id, login_account_id, active_person_id, token_hash, created_at, expires_at, last_seen_at)
       values (?, ?, ?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
    ).run(sessionId, accountId, personId, tokenHash, NOW, NOW);
    return;
  }
  db.prepare(
    `insert into user_sessions
      (id, login_account_id, active_person_id, active_education_partner_id, token_hash, created_at, expires_at, last_seen_at)
     values (?, ?, ?, ?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).run(sessionId, accountId, personId, partnerId, tokenHash, NOW, NOW);
}

function seedPartnerReferralSet(db: DatabaseSync) {
  seedReferral(db, "ref_awaiting", "refprof_partner_a", "epartner_a", "Awaiting Alpha", "submitted", null);
  seedReferral(db, "ref_payment", "refprof_partner_a", "epartner_a", "Payment Pending", "converted", { received: 100000, finalFee: 2360000, commission: null, paid: false });
  seedReferral(db, "ref_qualified", "refprof_partner_a", "epartner_a", "Qualified Queen", "converted", { received: 1180000, finalFee: 2360000, commission: null, paid: false });
  seedReferral(db, "ref_approved", "refprof_partner_a", "epartner_a", "Approved Alpha", "converted", { received: 1180000, finalFee: 1180000, commission: 75000, paid: false, snapshotBps: 750 });
  seedReferral(db, "ref_paid", "refprof_partner_a", "epartner_a", "Paid Partner", "converted", { received: 1180000, finalFee: 1250000, commission: 125000, paid: true, snapshotBps: 1000 });
  seedReferral(db, "ref_b_only", "refprof_partner_b", "epartner_b", "Hidden Mobile 9000000001", "converted", { received: 1180000, finalFee: 2360000, commission: 200000, paid: true });
}

function seedReferral(db: DatabaseSync, referralId: string, referrerProfileId: string, partnerId: string, prospectName: string, status: string, admission: null | { received: number; finalFee: number; commission: number | null; paid: boolean; snapshotBps?: number }) {
  db.prepare(
    `insert into referrals
      (id, organisation_id, branch_id, referral_programme_id, referrer_profile_id, course_interest_id, source, status, submitted_at, valid_until,
       prospect_mobile_hash, prospect_mobile_last_four, prospect_mobile_ciphertext, prospect_email_ciphertext, consent_recorded_at,
       created_at, updated_at, education_partner_id, partner_commission_basis_points, gst_basis_points_applicable, prospect_name)
     values (?, 'org_samyak', 'branch_sion', 'rprog_samyak_education_partners', ?, 'course_fsd', 'personal_link', ?, ?, '2026-11-23T10:00:00.000Z',
       ?, '0001', 'v1:secret-mobile', 'learner@example.com', ?, ?, ?, ?, 1000, 1800, ?)`,
  ).run(referralId, referrerProfileId, status, NOW, `mobile_${referralId}`, NOW, NOW, NOW, partnerId, prospectName);
  if (!admission) return;
  const personId = `person_${referralId}`;
  const studentId = `student_${referralId}`;
  db.prepare("insert or ignore into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', ?, ?, 'active', ?, ?)")
    .run(personId, prospectName, prospectName, NOW, NOW);
  db.prepare("insert or ignore into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values (?, 'org_samyak', ?, 'branch_sion', ?, ?, ?, 'active', 'active', ?, ?)")
    .run(studentId, personId, `STU-${referralId}`, deterministicSequence(referralId) + 100000, NOW, NOW, NOW);
  db.prepare(
    `insert into enrolments
      (id, student_id, branch_id, course_id, enrolment_number, training_mode, admission_date, joining_date, status, nsdc_preference, referrer_profile_id, referral_id, created_at, updated_at)
     values (?, ?, 'branch_sion', 'course_fsd', ?, 'classroom', ?, ?, 'confirmed', 'no', ?, ?, ?, ?)`,
  ).run(`enrol_${referralId}`, studentId, `ENR-${referralId}`, NOW, NOW, referrerProfileId, referralId, NOW, NOW);
  db.prepare(
    `insert into fee_agreements
      (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, gst_rate_basis_points, payment_plan_type, status, created_at, updated_at)
     values (?, ?, ?, ?, 0, 1800, 'full_payment', 'active', ?, ?)`,
  ).run(`fee_${referralId}`, `enrol_${referralId}`, admission.finalFee, admission.finalFee, NOW, NOW);
  db.prepare(
    `insert into receipts
      (id, organisation_id, branch_id, receipt_number, receipt_year, person_id, student_id, enrolment_id, fee_agreement_id, amount_paise, received_at, payment_mode, payment_reference, notes, status, created_by_login_account_id, idempotency_key, payload_fingerprint, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', ?, 2026, ?, ?, ?, ?, ?, ?, 'upi', 'student-payment-reference', 'receipt note', 'recorded', 'acct_system', ?, ?, ?, ?)`,
  ).run(`receipt_${referralId}`, `RCPT-${referralId}`, personId, studentId, `enrol_${referralId}`, `fee_${referralId}`, admission.received, NOW, `idem_${referralId}`, `fingerprint_${referralId}`, NOW, NOW);
  if (admission.commission === null) return;
  db.prepare(
    `insert into referral_reward_snapshots
      (id, referral_id, enrolment_id, fee_agreement_id, reward_rule_set_id, slab_id, final_agreed_fee_paise, minimum_fee_percentage, minimum_qualifying_payment_paise, cash_reward_paise, course_credit_paise,
       reward_model_type, education_partner_id, partner_commission_basis_points, gst_basis_points_applicable, pre_gst_final_fee_paise, snapshot_version, snapshot_json, status, approved_by_login_account_id, approved_at, created_at)
     values (?, ?, ?, ?, 'rrs_samyak_education_partners_v1', null, ?, 50, ?, ?, 0, 'partner_percentage', ?, ?, 1800, ?, 1, ?, 'approved', 'acct_system', ?, ?)`,
  ).run(`snap_${referralId}`, referralId, `enrol_${referralId}`, `fee_${referralId}`, admission.finalFee, Math.ceil(admission.finalFee * 0.5), admission.commission, partnerId, admission.snapshotBps || 1000, Math.round(admission.finalFee / 1.18), JSON.stringify({ ok: true }), NOW, NOW);
  if (!admission.paid) return;
  db.prepare(
    `insert into referral_reward_payouts
      (id, organisation_id, branch_id, reward_snapshot_id, referral_id, amount_paise, payment_date, payment_mode, payment_reference, notes, status, paid_by_login_account_id, idempotency_key, payload_fingerprint, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', ?, ?, ?, ?, 'upi', 'upi-reference-secret', 'internal note', 'paid', 'acct_system', ?, ?, ?, ?)`,
  ).run(`payout_${referralId}`, `snap_${referralId}`, referralId, admission.commission, "2026-08-26T10:00:00.000Z", `pay_idem_${referralId}`, `pay_fingerprint_${referralId}`, NOW, NOW);
}

function sessionCookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

function row(db: DatabaseSync, sql: string, ...values: SQLInputValue[]) {
  return db.prepare(sql).get(...values) as Row | undefined;
}

function count(db: DatabaseSync, tableOrSql: string) {
  return Number(row(db, `select count(*) as count from ${tableOrSql}`)?.count || 0);
}

function columns(db: DatabaseSync, table: string) {
  return db.prepare(`pragma table_info(${table})`).all().map((item) => String((item as Row).name));
}

function deterministicSequence(value: string) {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function resetOtpRateLimits(db: DatabaseSync, mobile: string) {
  db.prepare("update otp_challenges set requested_at = '2000-01-01T00:00:00.000Z', last_sent_at = '2000-01-01T00:00:00.000Z' where mobile_last_four = ?")
    .run(mobile.slice(-4));
}

class SqliteD1 {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql, []);
  }

  async batch(statements: SqliteD1Statement[]) {
    const results = [];
    this.db.exec("begin");
    try {
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return results;
  }
}

class SqliteD1Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly params: SQLInputValue[]) {}

  bind(...params: SQLInputValue[]) {
    return new SqliteD1Statement(this.db, this.sql, params);
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) ?? null) as T | null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) } as T;
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), rows_written: Number(result.changes) } };
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
