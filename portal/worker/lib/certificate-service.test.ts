import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { AppContext } from "./http";
import type { StaffContext } from "./staff-auth";
import {
  CERTIFICATE_TEMPLATE_CODE,
  certificateEligibility,
  getCertificatePdf,
  issueCertificate,
  listCertificates,
  revokeCertificate,
  verifyCertificate,
  buildVerificationUrl,
} from "./certificate-service";
import {
  approveCourseCompletionFromApplication,
  listStudentCertificateApplications,
  submitCertificateApplication,
} from "./certificate-application-service";
import { createMemoryCertificatePdfStorage, type CertificatePdfStorage } from "./certificate-storage";

type SqlValue = SQLInputValue;

describe("certificate system migration", () => {
  it("creates the certificate schema and keeps template seeding idempotent", () => {
    const db = migratedSeededDb();

    expect(columns(db, "certificate_templates")).toContain("code");
    expect(columns(db, "certificates")).toContain("pdf_storage_key");
    expect(columns(db, "certificate_status_events")).toContain("reason");
    expect(indexes(db)).toEqual(expect.arrayContaining(["certificates_one_issued_per_enrolment_unique", "certificates_verification_code_unique"]));
    expect(count(db, `certificate_templates where code = '${CERTIFICATE_TEMPLATE_CODE}'`)).toBe(1);

    applySeed(db);

    expect(count(db, `certificate_templates where code = '${CERTIFICATE_TEMPLATE_CODE}'`)).toBe(1);
    db.close();
  });

  it("upgrades a current-main database through 0017 without duplicating seeded templates", () => {
    const db = new DatabaseSync(":memory:");
    applyMigrations(db, "0016_legacy_student_import_foundation.sql");
    applySeed(db);

    applyMigrationFile(db, "0017_certificate_system.sql");
    applySeed(db);

    expect(count(db, `certificate_templates where code = '${CERTIFICATE_TEMPLATE_CODE}'`)).toBe(1);
    expect(columns(db, "certificates")).toContain("verification_code");
    db.close();
  });
});

describe("certificate service synthetic issuance flow", () => {
  it("builds public verification URLs from configured platform origin", () => {
    const { c } = testContext();

    expect(buildVerificationUrl(c, "org_samyak", "SYK-ABC1234567890XYZ")).toBe("https://edu.rememo.in/verify/SYK-ABC1234567890XYZ");
    expect(buildVerificationUrl(c, "org_demo", "CERT-ABC1234567890XYZ")).toBe("https://edu.rememo.in/verify/CERT-ABC1234567890XYZ");
    const misconfiguredContext = { ...c, env: { ...c.env, CERTIFICATE_VERIFICATION_ORIGIN: "" } } as unknown as AppContext;
    expect(() => buildVerificationUrl(misconfiguredContext, "org_samyak", "SYK-ABC1234567890XYZ")).toThrow();
  });

  it("issues, stores, verifies, downloads, deduplicates, and revokes a completed enrolment", async () => {
    const { c, db, staff } = testContext();
    const objects = new Map<string, Uint8Array>();
    const storage = createMemoryCertificatePdfStorage(objects);

    const active = await certificateEligibility(c, { organisationId: "org_samyak", enrolmentId: "enrolment_active" });
    const onHold = await certificateEligibility(c, { organisationId: "org_samyak", enrolmentId: "enrolment_on_hold" });
    expect(active).toMatchObject({ eligible: false, reasons: ["enrolment_active"] });
    expect(onHold).toMatchObject({ eligible: false, reasons: ["enrolment_on_hold"] });

    const issued = await issueCertificate(c, staff, "enrolment_completed", "2026-08-17", { storage });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("expected certificate issuance to succeed");
    expect(issued.idempotent).toBe(false);
    expect(issued.certificate.certificate_number).toBe("SYK-SION-CERT-2026-000001");
    expect(issued.certificate.student_name_snapshot).toBe("Synthetic Completed Student");
    expect(issued.certificate.course_name_snapshot).toBe("FULL STACK COURSE - 6 MONTHS");
    expect(issued.certificate.pdf_storage_key).toMatch(/^certificates\/org_samyak\/branch_sion\/2026\/syk-sion-cert-2026-000001\.pdf$/);
    expect(objects.size).toBe(1);
    expect(buildVerificationUrl(c, issued.certificate.organisation_id, issued.certificate.verification_code)).toBe(`https://edu.rememo.in/verify/${issued.certificate.verification_code}`);

    db.prepare("update people set full_name = 'Changed After Issue', updated_at = ? where id = 'person_completed'").run(now(),);
    db.prepare("update courses set name = 'Changed Course Name', updated_at = ? where id = 'course_syk_wdd_001'").run(now());
    const persisted = row(db, "select student_name_snapshot, course_name_snapshot from certificates where id = ?", issued.certificate.id);
    expect(persisted).toMatchObject({
      student_name_snapshot: "Synthetic Completed Student",
      course_name_snapshot: "FULL STACK COURSE - 6 MONTHS",
    });

    const verification = await verifyCertificate(c, issued.certificate.verification_code);
    expect(verification.status).toBe("valid");
    expect(verification.issuer).toMatchObject({ organisation_name: expect.any(String), branch_name: "Sion" });
    expect(verification.issuer).not.toHaveProperty("organisation_id");
    expect(verification.issuer).not.toHaveProperty("branch_id");
    expect(verification.issuer).not.toHaveProperty("branch_mobile_last_four");
    expect(verification.certificate).toMatchObject({
      certificate_number: "SYK-SION-CERT-2026-000001",
      student_name_snapshot: "Synthetic Completed Student",
      course_name_snapshot: "FULL STACK COURSE - 6 MONTHS",
      completion_date_snapshot: "2026-08-10",
    });
    expect(Object.keys(verification.certificate || {})).not.toEqual(
      expect.arrayContaining(["verification_code", "pdf_storage_key", "revocation_reason", "person_id", "student_id"]),
    );
    const studentApplications = await listStudentCertificateApplications(c, { organisationId: "org_samyak", personId: "person_completed" });
    expect(studentApplications.items[0]).toMatchObject({
      certificate: { verification_url: `https://edu.rememo.in/verify/${issued.certificate.verification_code}` },
    });

    const staffPdf = await getCertificatePdf(c, { organisationId: "org_samyak", certificateId: issued.certificate.id }, { storage });
    const studentPdf = await getCertificatePdf(c, { organisationId: "org_samyak", certificateId: issued.certificate.id, personId: "person_completed" }, { storage });
    const wrongStudentPdf = await getCertificatePdf(c, { organisationId: "org_samyak", certificateId: issued.certificate.id, personId: "person_active" }, { storage });
    expect(staffPdf.ok).toBe(true);
    expect(studentPdf.ok).toBe(true);
    expect(wrongStudentPdf).toMatchObject({ ok: false, status: 404, code: "certificate_not_found" });
    if (!staffPdf.ok) throw new Error("expected staff PDF download to succeed");
    const staffPdfText = new TextDecoder("latin1").decode(staffPdf.bytes);
    expect(staffPdfText).not.toContain("Internal");
    expect(staffPdfText).not.toContain("Aadhaar");
    expect(staffPdfText).not.toContain("Fee");
    expect(staffPdfText).not.toContain("Grade");

    const duplicate = await issueCertificate(c, staff, "enrolment_completed", "2026-08-17", { storage });
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) throw new Error("expected duplicate issuance to be idempotent");
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.certificate.id).toBe(issued.certificate.id);
    expect(count(db, "certificates where enrolment_id = 'enrolment_completed' and status = 'issued'")).toBe(1);
    expect(objects.size).toBe(1);

    const revoked = await revokeCertificate(c, staff, issued.certificate.id, "Synthetic revocation");
    expect(revoked).toMatchObject({ ok: true });
    const revokedVerification = await verifyCertificate(c, issued.certificate.verification_code);
    expect(revokedVerification.status).toBe("revoked");
    expect(Object.keys(revokedVerification.certificate || {})).not.toContain("revocation_reason");
    expect(count(db, "certificate_status_events where certificate_id = '" + issued.certificate.id + "'")).toBe(2);

    db.close();
  });

  it("omits completion date when the completed enrolment has no actual completion date", async () => {
    const { c, db, staff } = testContext();
    const objects = new Map<string, Uint8Array>();
    const storage = createMemoryCertificatePdfStorage(objects);

    const issued = await issueCertificate(c, staff, "enrolment_completed_null_date", "2026-08-17", { storage });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("expected null-date certificate issuance to succeed");
    const pdf = await getCertificatePdf(c, { organisationId: "org_samyak", certificateId: issued.certificate.id, personId: "person_completed_null_date" }, { storage });
    expect(pdf.ok).toBe(true);
    if (!pdf.ok) throw new Error("expected PDF download to succeed");

    const pdfText = new TextDecoder("latin1").decode(pdf.bytes);
    expect(issued.certificate.completion_date_snapshot).toBeNull();
    expect(pdfText).not.toContain("Completion Date");

    db.close();
  });

  it("does not insert a certificate row when production PDF storage fails", async () => {
    const { c, db, staff } = testContext();
    const failingStorage: CertificatePdfStorage = {
      async put() {
        throw new Error("storage unavailable");
      },
      async get() {
        return null;
      },
      async delete() {},
    };

    const failed = await issueCertificate(c, staff, "enrolment_storage_failure", "2026-08-17", { storage: failingStorage });

    expect(failed).toMatchObject({ ok: false, status: 500, code: "certificate_pdf_storage_failed" });
    expect(count(db, "certificates where enrolment_id = 'enrolment_storage_failure'")).toBe(0);
    expect(count(db, "certificate_status_events")).toBe(0);
    db.close();
  });

  it("issues non-Samyak certificates with tenant issuer data and keeps Samyak staff isolated", async () => {
    const { c, db, staff } = testContext();
    seedDemoOrganisation(db);
    const demoStaff = { loginAccountId: "login_demo_staff", activePersonId: "person_demo_staff", organisationId: "org_demo", roles: ["owner"] } satisfies StaffContext;
    const storage = createMemoryCertificatePdfStorage(new Map<string, Uint8Array>());

    const samyakAttempt = await issueCertificate(c, staff, "enrolment_demo_completed", "2026-08-17", { storage });
    const demoIssued = await issueCertificate(c, demoStaff, "enrolment_demo_completed", "2026-08-17", { storage });

    expect(samyakAttempt).toMatchObject({ ok: false, status: 409, code: "not_eligible", reasons: ["enrolment_not_found"] });
    expect(demoIssued.ok).toBe(true);
    if (!demoIssued.ok) throw new Error("expected Demo certificate issuance to succeed");
    expect(demoIssued.certificate.organisation_id).toBe("org_demo");
    expect(demoIssued.certificate.certificate_number).toBe("DEMO-INSTITUTE-ORG-DEMO-MAIN-CERT-2026-000001");
    expect(demoIssued.certificate.verification_code).toMatch(/^CERT-/);
    expect(buildVerificationUrl(c, demoIssued.certificate.organisation_id, demoIssued.certificate.verification_code)).toBe(`https://edu.rememo.in/verify/${demoIssued.certificate.verification_code}`);
    expect(demoIssued.certificate.pdf_storage_key).toMatch(/^certificates\/org_demo\/branch_demo_main\/2026\/demo-institute-org-demo-main-cert-2026-000001\.pdf$/);
    expect(row(db, "select code, name from certificate_templates where id = ?", demoIssued.certificate.template_id)).toMatchObject({
      code: "GENERIC_COMPLETION_V1",
      name: "Demo Institute Completion Certificate",
    });

    const verification = await verifyCertificate(c, demoIssued.certificate.verification_code);
    expect(verification).toMatchObject({
      status: "valid",
      issuer: { organisation_name: "Demo Institute", organisation_legal_name: "Demo Institute LLP", branch_name: "Main Centre", email: "hello@demo.example" },
      certificate: { certificate_number: demoIssued.certificate.certificate_number },
    });
    expect(verification.issuer).not.toHaveProperty("organisation_id");
    expect(verification.issuer).not.toHaveProperty("branch_id");
    expect(verification.issuer).not.toHaveProperty("branch_mobile_last_four");

    const generated = await getCertificatePdf(c, { organisationId: "org_demo", certificateId: demoIssued.certificate.id }, { storage });
    expect(generated.ok).toBe(true);
    if (!generated.ok) throw new Error("expected Demo PDF fallback to succeed");
    const pdfText = new TextDecoder("latin1").decode(generated.bytes);
    expect(pdfText).toContain("Demo Institute");
    expect(pdfText).toContain("Main Centre");
    expect(pdfText).not.toContain("SAMYAK");
    expect(pdfText).not.toContain("info@samyaksion.com");

    const samyakList = await listCertificates(c, { organisationId: "org_samyak", limit: 25, offset: 0 });
    const demoList = await listCertificates(c, { organisationId: "org_demo", limit: 25, offset: 0 });
    expect(samyakList.items).toHaveLength(0);
    expect(demoList.items).toHaveLength(1);
    expect(demoList.items[0]).toMatchObject({ verification_url: `https://edu.rememo.in/verify/${demoIssued.certificate.verification_code}` });
    db.close();
  });

  it("keeps non-Samyak certificate numbers globally unique when similar slugs share branch code and year", async () => {
    const { c, db } = testContext();
    seedCollisionCertificateOrganisation(db, {
      organisationId: "org_collision_north",
      slug: "abcdefghijkl-north",
      name: "abcdefghijkl North Academy",
      branchId: "branch_collision_north_main",
      staffPersonId: "person_collision_north_staff",
      loginAccountId: "login_collision_north_staff",
      roleId: "role_collision_north_owner",
      courseId: "course_collision_north_fullstack",
      personId: "person_collision_north_completed",
      studentId: "student_collision_north_completed",
      enrolmentId: "enrolment_collision_north_completed",
      mobile: "+919000000101",
      studentNumber: "NORTH-MAIN-9001",
      sequenceNumber: 9201,
    });
    seedCollisionCertificateOrganisation(db, {
      organisationId: "org_collision_south",
      slug: "abcdefghijkl-south",
      name: "abcdefghijkl South Academy",
      branchId: "branch_collision_south_main",
      staffPersonId: "person_collision_south_staff",
      loginAccountId: "login_collision_south_staff",
      roleId: "role_collision_south_owner",
      courseId: "course_collision_south_fullstack",
      personId: "person_collision_south_completed",
      studentId: "student_collision_south_completed",
      enrolmentId: "enrolment_collision_south_completed",
      mobile: "+919000000102",
      studentNumber: "SOUTH-MAIN-9001",
      sequenceNumber: 9202,
    });
    const storage = createMemoryCertificatePdfStorage(new Map<string, Uint8Array>());

    const northIssued = await issueCertificate(c, {
      loginAccountId: "login_collision_north_staff",
      activePersonId: "person_collision_north_staff",
      organisationId: "org_collision_north",
      roles: ["owner"],
    }, "enrolment_collision_north_completed", "2026-08-17", { storage });
    const southIssued = await issueCertificate(c, {
      loginAccountId: "login_collision_south_staff",
      activePersonId: "person_collision_south_staff",
      organisationId: "org_collision_south",
      roles: ["owner"],
    }, "enrolment_collision_south_completed", "2026-08-17", { storage });

    expect(northIssued.ok).toBe(true);
    expect(southIssued.ok).toBe(true);
    if (!northIssued.ok || !southIssued.ok) throw new Error("expected collision fixtures to issue");
    expect(northIssued.certificate.certificate_number).toBe("ABCDEFGHIJKL-NORTH-ORG-COLLISION-NORTH-MAIN-CERT-2026-000001");
    expect(southIssued.certificate.certificate_number).toBe("ABCDEFGHIJKL-SOUTH-ORG-COLLISION-SOUTH-MAIN-CERT-2026-000001");
    expect(northIssued.certificate.certificate_number).not.toBe(southIssued.certificate.certificate_number);
    expect(northIssued.certificate.certificate_number).not.toBe("ABCDEFGHIJKL-MAIN-CERT-2026-000001");
    expect(southIssued.certificate.certificate_number).not.toBe("ABCDEFGHIJKL-MAIN-CERT-2026-000001");
    expect(northIssued.certificate.verification_code).toMatch(/^CERT-/);
    expect(southIssued.certificate.verification_code).toMatch(/^CERT-/);
    expect(row(db, "select next_sequence from number_sequences where organisation_id = 'org_collision_north' and branch_id = 'branch_collision_north_main' and sequence_key = 'certificate:2026'")).toMatchObject({ next_sequence: 2 });
    expect(row(db, "select next_sequence from number_sequences where organisation_id = 'org_collision_south' and branch_id = 'branch_collision_south_main' and sequence_key = 'certificate:2026'")).toMatchObject({ next_sequence: 2 });
    expect(count(db, "number_sequences where sequence_key = 'certificate:2026' and organisation_id like 'org_collision_%'")).toBe(2);
    db.close();
  });

  it("rejects malformed Demo enrolments that point at Samyak person, course, or branch rows", async () => {
    const { c, db } = testContext();
    seedDemoOrganisation(db);
    seedMalformedDemoCertificateEnrolments(db);
    const demoStaff = { loginAccountId: "login_demo_staff", activePersonId: "person_demo_staff", organisationId: "org_demo", roles: ["owner"] } satisfies StaffContext;
    const storage = createMemoryCertificatePdfStorage(new Map<string, Uint8Array>());

    await expect(listStudentCertificateApplications(c, { organisationId: "org_demo", personId: "person_active" }))
      .resolves.toMatchObject({ items: [] });
    await expect(listStudentCertificateApplications(c, { organisationId: "org_demo", personId: "person_demo_bad_course" }))
      .resolves.toMatchObject({ items: [] });
    await expect(listStudentCertificateApplications(c, { organisationId: "org_demo", personId: "person_demo_bad_branch" }))
      .resolves.toMatchObject({ items: [] });

    for (const [personId, enrolmentId] of [
      ["person_active", "enrolment_demo_bad_person"],
      ["person_demo_bad_course", "enrolment_demo_bad_course"],
      ["person_demo_bad_branch", "enrolment_demo_bad_branch"],
    ] as const) {
      await expect(submitCertificateApplication(c, { organisationId: "org_demo", personId }, { ...applicationInput(), enrolmentId }))
        .resolves.toMatchObject({ ok: false, status: 404, code: "enrolment_not_found" });
      await expect(certificateEligibility(c, { organisationId: "org_demo", enrolmentId }))
        .resolves.toMatchObject({ eligible: false, reasons: ["enrolment_not_found"] });
      await expect(issueCertificate(c, demoStaff, enrolmentId, "2026-08-17", { storage }))
        .resolves.toMatchObject({ ok: false, status: 409, code: "not_eligible", reasons: ["enrolment_not_found"] });
    }

    expect(count(db, "certificates where organisation_id = 'org_demo'")).toBe(0);
    expect(count(db, "certificate_applications where organisation_id = 'org_demo'")).toBe(0);
    db.close();
  });
});

describe("certificate application workflow", () => {
  it("allows V1 finalised enrolment statuses when the agreed fee is fully paid", async () => {
    const { c, db } = testContext();
    seedCertificateStudent(db, "confirmed", "confirmed", null);
    seedCertificateStudent(db, "not_started", "not_started", null);

    for (const suffix of ["confirmed", "not_started", "active", "on_hold", "completed"] as const) {
      const listed = await listStudentCertificateApplications(c, { organisationId: "org_samyak", personId: `person_${suffix}` });
      expect(listed.items[0]).toMatchObject({
        enrolment: { enrolment_id: `enrolment_${suffix}` },
        applicationEligibility: { eligible: true, reasons: [] },
      });
    }

    await expect(submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_confirmed" }, applicationInput({ enrolmentId: "enrolment_confirmed" })))
      .resolves.toMatchObject({ ok: true, status: 201 });
    expect(row(db, "select status, actual_completion_date from enrolments where id = 'enrolment_confirmed'")).toMatchObject({ status: "confirmed", actual_completion_date: null });
    db.close();
  });

  it("requires full payment from active fee agreements and excludes reversed receipts", async () => {
    const { c, db } = testContext();
    seedCertificateStudent(db, "confirmed_partial", "confirmed", null);
    seedCertificateStudent(db, "active_partial", "active", null);
    seedCertificateStudent(db, "multi_receipt", "confirmed", null);
    seedCertificateStudent(db, "reversed_underpaid", "confirmed", null);
    seedCertificateStudent(db, "exact_fee", "confirmed", null);
    seedCertificateStudent(db, "overpaid", "confirmed", null);
    seedCertificateStudent(db, "missing_fee", "confirmed", null);

    db.prepare("update receipts set amount_paise = 1399999 where id = 'receipt_confirmed_partial_1'").run();
    db.prepare("update receipts set amount_paise = 500000 where id = 'receipt_active_partial_1'").run();
    db.prepare("delete from receipts where id = 'receipt_multi_receipt_1'").run();
    db.prepare("insert into receipts (id, organisation_id, branch_id, receipt_number, receipt_year, person_id, student_id, enrolment_id, fee_agreement_id, amount_paise, received_at, payment_mode, status, created_by_login_account_id, idempotency_key, payload_fingerprint, created_at, updated_at) values ('receipt_multi_receipt_1a', 'org_samyak', 'branch_sion', 'RCP-MULTI-A', 2026, 'person_multi_receipt', 'student_multi_receipt', 'enrolment_multi_receipt', 'fee_multi_receipt', 700000, ?, 'upi', 'recorded', 'login_staff', 'multi_a', 'multi_a_fp', ?, ?)").run(now(), now(), now());
    db.prepare("insert into receipts (id, organisation_id, branch_id, receipt_number, receipt_year, person_id, student_id, enrolment_id, fee_agreement_id, amount_paise, received_at, payment_mode, status, created_by_login_account_id, idempotency_key, payload_fingerprint, created_at, updated_at) values ('receipt_multi_receipt_1b', 'org_samyak', 'branch_sion', 'RCP-MULTI-B', 2026, 'person_multi_receipt', 'student_multi_receipt', 'enrolment_multi_receipt', 'fee_multi_receipt', 700000, ?, 'upi', 'recorded', 'login_staff', 'multi_b', 'multi_b_fp', ?, ?)").run(now(), now(), now());
    db.prepare("insert into receipt_reversals (id, organisation_id, branch_id, receipt_id, enrolment_id, fee_agreement_id, reason, reversed_by_login_account_id, idempotency_key, payload_fingerprint, created_at) values ('reversal_reversed_underpaid_1', 'org_samyak', 'branch_sion', 'receipt_reversed_underpaid_1', 'enrolment_reversed_underpaid', 'fee_reversed_underpaid', 'Synthetic correction', 'login_staff', 'rev_underpaid', 'rev_underpaid_fp', ?)").run(now());
    db.prepare("update receipts set amount_paise = 1500000 where id = 'receipt_overpaid_1'").run();
    db.prepare("delete from receipts where fee_agreement_id = 'fee_missing_fee'").run();
    db.prepare("delete from fee_agreement_instalments where fee_agreement_id = 'fee_missing_fee'").run();
    db.prepare("delete from fee_agreements where id = 'fee_missing_fee'").run();

    for (const suffix of ["confirmed_partial", "active_partial", "reversed_underpaid"] as const) {
      const listed = await listStudentCertificateApplications(c, { organisationId: "org_samyak", personId: `person_${suffix}` });
      expect(listed.items[0].applicationEligibility).toMatchObject({ eligible: false, reasons: expect.arrayContaining(["fee_not_fully_paid"]) });
      await expect(submitCertificateApplication(c, { organisationId: "org_samyak", personId: `person_${suffix}` }, applicationInput({ enrolmentId: `enrolment_${suffix}` })))
        .resolves.toMatchObject({ ok: false, status: 409, reasons: expect.arrayContaining(["fee_not_fully_paid"]) });
    }

    for (const suffix of ["multi_receipt", "exact_fee", "overpaid"] as const) {
      const listed = await listStudentCertificateApplications(c, { organisationId: "org_samyak", personId: `person_${suffix}` });
      expect(listed.items[0].applicationEligibility).toMatchObject({ eligible: true, reasons: [] });
    }

    const missing = await listStudentCertificateApplications(c, { organisationId: "org_samyak", personId: "person_missing_fee" });
    expect(missing.items[0].applicationEligibility).toMatchObject({ eligible: false, reasons: expect.arrayContaining(["fee_agreement_missing"]) });
    db.close();
  });

  it("lets an active student apply once and leaves enrolment active", async () => {
    const { c, db } = testContext();

    const before = await listStudentCertificateApplications(c, { organisationId: "org_samyak", personId: "person_active" });
    expect(before.items[0]).toMatchObject({
      enrolment: { enrolment_id: "enrolment_active", student_name: "Synthetic Active Student" },
      applicationEligibility: { eligible: true, reasons: [] },
    });

    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput({ feedbackOverallScore: 5 }));
    const duplicate = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput({ feedbackOverallScore: 1 }));

    expect(submitted).toMatchObject({ ok: true, status: 201, idempotent: false, application: { status: "submitted", low_feedback_flag: false } });
    expect(duplicate).toMatchObject({ ok: true, status: 200, idempotent: true, application: { status: "submitted", low_feedback_flag: false } });
    expect(row(db, "select status from enrolments where id = 'enrolment_active'")).toMatchObject({ status: "active" });
    expect(count(db, "certificate_applications where enrolment_id = 'enrolment_active'")).toBe(1);
    db.close();
  });

  it("does not allow a new application after a certificate is issued", async () => {
    const { c, db, staff } = testContext();
    const storage = createMemoryCertificatePdfStorage(new Map<string, Uint8Array>());

    const issued = await issueCertificate(c, staff, "enrolment_completed", "2026-08-17", { storage });
    expect(issued.ok).toBe(true);

    const listed = await listStudentCertificateApplications(c, { organisationId: "org_samyak", personId: "person_completed" });
    expect(listed.items[0].applicationEligibility).toMatchObject({ eligible: false, reasons: expect.arrayContaining(["certificate_already_issued"]) });
    await expect(submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_completed" }, applicationInput({ enrolmentId: "enrolment_completed" })))
      .resolves.toMatchObject({ ok: false, status: 409, reasons: expect.arrayContaining(["certificate_already_issued"]) });
    db.close();
  });

  it("rejects cross-person, archived, incomplete confirmation, invalid score, and long comment submissions", async () => {
    const { c, db } = testContext();
    db.prepare("update students set current_status = 'archived', updated_at = ? where id = 'student_on_hold'").run(now());

    await expect(submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, { ...applicationInput(), enrolmentId: "enrolment_on_hold" })).resolves.toMatchObject({ ok: false, status: 404 });
    await expect(submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_on_hold" }, { ...applicationInput(), enrolmentId: "enrolment_on_hold" })).resolves.toMatchObject({ ok: false, status: 409, reasons: expect.arrayContaining(["student_archived"]) });
    await expect(submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput({ studentCompletionConfirmed: false }))).resolves.toMatchObject({ ok: false, status: 400, code: "confirmations_required" });
    await expect(submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput({ feedbackOverallScore: 6 }))).resolves.toMatchObject({ ok: false, status: 400, code: "invalid_feedback" });
    await expect(submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput({ feedbackImprovementText: "x".repeat(1001) }))).resolves.toMatchObject({ ok: false, status: 400, code: "comment_too_long" });
    db.close();
  });

  it("flags low feedback without rejecting or affecting Google-review-neutral eligibility", async () => {
    const { c, db } = testContext();

    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput({
      feedbackTrainerClarityScore: 2,
      feedbackPracticalLearningScore: 3,
      feedbackCourseExpectationScore: 2,
      feedbackOverallScore: 3,
      feedbackImprovementText: "More practice time",
    }));

    expect(submitted).toMatchObject({ ok: true, application: { low_feedback_flag: true } });
    expect(row(db, "select feedback_improvement_text, low_feedback_flag from certificate_applications where enrolment_id = 'enrolment_active'")).toMatchObject({
      feedback_improvement_text: "More practice time",
      low_feedback_flag: 1,
    });
    db.close();
  });

  it("applies the low-feedback boundary rule deterministically", async () => {
    const { c, db } = testContext();
    seedCertificateStudent(db, "active_boundary", "active", null);
    seedCertificateStudent(db, "active_overall", "active", null);

    const boundary = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput({
      feedbackTrainerClarityScore: 2,
      feedbackPracticalLearningScore: 3,
      feedbackCourseExpectationScore: 2,
      feedbackOverallScore: 3,
    }));
    const aboveBoundary = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active_boundary" }, {
      ...applicationInput({
        enrolmentId: "enrolment_active_boundary",
        feedbackTrainerClarityScore: 3,
        feedbackPracticalLearningScore: 3,
        feedbackCourseExpectationScore: 2,
        feedbackOverallScore: 3,
      }),
    });
    const lowOverall = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active_overall" }, {
      ...applicationInput({
        enrolmentId: "enrolment_active_overall",
        feedbackTrainerClarityScore: 5,
        feedbackPracticalLearningScore: 5,
        feedbackCourseExpectationScore: 5,
        feedbackOverallScore: 2,
      }),
    });

    expect(boundary).toMatchObject({ ok: true, application: { low_feedback_flag: true } });
    expect(aboveBoundary).toMatchObject({ ok: true, application: { low_feedback_flag: false } });
    expect(lowOverall).toMatchObject({ ok: true, application: { low_feedback_flag: true } });
    db.close();
  });

  it("approves course completion from application and then existing eligibility becomes true", async () => {
    const { c, db, staff } = testContext();
    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput());
    if (!submitted.ok) throw new Error("expected application submission");
    db.prepare(`insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference, batch_id,
       admission_date, joining_date, expected_completion_date, actual_completion_date, status, nsdc_preference,
       referrer_profile_id, created_at, updated_at)
     values ('enrolment_active_second', 'student_active', 'branch_sion', 'course_syk_wdd_001', null, 'ENR-ACTIVE-SECOND', 'classroom', null, null,
       '2026-09-01', '2026-09-05', '2027-02-28', null, 'active', 'decide_later', null, ?, ?)`).run(now(), now());

    const approved = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");
    const eligibility = await certificateEligibility(c, { organisationId: "org_samyak", enrolmentId: "enrolment_active" });

    expect(approved).toMatchObject({ ok: true, idempotent: false });
    expect(row(db, "select status, actual_completion_date from enrolments where id = 'enrolment_active'")).toMatchObject({ status: "completed", actual_completion_date: "2026-08-18" });
    expect(row(db, "select current_status from students where id = 'student_active'")).toMatchObject({ current_status: "active" });
    expect(row(db, "select status, completion_date from certificate_applications where id = ?", submitted.application.id)).toMatchObject({ status: "approved", completion_date: "2026-08-18" });
    expect(eligibility).toMatchObject({ eligible: true, reasons: [] });
    db.close();
  });

  it("approves course completion from confirmed and not-started applications without issuing certificates", async () => {
    const { c, db, staff } = testContext();
    seedCertificateStudent(db, "confirmed_completion", "confirmed", null);
    seedCertificateStudent(db, "not_started_completion", "not_started", null);

    for (const suffix of ["confirmed_completion", "not_started_completion"] as const) {
      const submitted = await submitCertificateApplication(
        c,
        { organisationId: "org_samyak", personId: `person_${suffix}` },
        applicationInput({ enrolmentId: `enrolment_${suffix}` }),
      );
      if (!submitted.ok) throw new Error(`expected ${suffix} application submission`);

      const approved = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");
      const retry = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");
      const eligibility = await certificateEligibility(c, { organisationId: "org_samyak", enrolmentId: `enrolment_${suffix}` });

      expect(approved).toMatchObject({ ok: true, idempotent: false });
      expect(retry).toMatchObject({ ok: true, idempotent: true });
      expect(row(db, "select status, actual_completion_date from enrolments where id = ?", `enrolment_${suffix}`)).toMatchObject({ status: "completed", actual_completion_date: "2026-08-18" });
      expect(row(db, "select current_status from students where id = ?", `student_${suffix}`)).toMatchObject({ current_status: "completed" });
      expect(row(db, "select status, completion_date from certificate_applications where id = ?", submitted.application.id)).toMatchObject({ status: "approved", completion_date: "2026-08-18" });
      expect(eligibility).toMatchObject({ eligible: true, reasons: [] });
      expect(count(db, `certificate_application_events where application_id = '${submitted.application.id}' and action = 'approved'`)).toBe(1);
    }

    expect(count(db, "certificates where organisation_id = 'org_samyak' and enrolment_id in ('enrolment_confirmed_completion', 'enrolment_not_started_completion')")).toBe(0);
    db.close();
  });

  it("approves course completion from an on-hold application without issuing a certificate", async () => {
    const { c, db, staff } = testContext();
    const submitted = await submitCertificateApplication(
      c,
      { organisationId: "org_samyak", personId: "person_on_hold" },
      applicationInput({ enrolmentId: "enrolment_on_hold" }),
    );
    if (!submitted.ok) throw new Error("expected on-hold application submission");

    expect(row(db, "select status, actual_completion_date from enrolments where id = 'enrolment_on_hold'")).toMatchObject({ status: "on_hold", actual_completion_date: null });
    expect(row(db, "select status, completion_date, reviewed_at, reviewed_by_actor_id from certificate_applications where id = ?", submitted.application.id)).toMatchObject({
      status: "submitted",
      completion_date: null,
      reviewed_at: null,
      reviewed_by_actor_id: null,
    });

    const approved = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");

    expect(approved).toMatchObject({ ok: true, idempotent: false });
    expect(row(db, "select status, actual_completion_date from enrolments where id = 'enrolment_on_hold'")).toMatchObject({ status: "completed", actual_completion_date: "2026-08-18" });
    expect(row(db, "select status, completion_date, reviewed_by_actor_id from certificate_applications where id = ?", submitted.application.id)).toMatchObject({
      status: "approved",
      completion_date: "2026-08-18",
      reviewed_by_actor_id: "login_staff",
    });
    expect(row(db, "select reviewed_at from certificate_applications where id = ?", submitted.application.id)?.reviewed_at).toEqual(expect.any(String));
    expect(row(db, "select current_status from students where id = 'student_on_hold'")).toMatchObject({ current_status: "completed" });
    expect(count(db, `certificate_application_events where application_id = '${submitted.application.id}' and action = 'approved'`)).toBe(1);
    expect(count(db, "certificates where organisation_id = 'org_samyak' and enrolment_id = 'enrolment_on_hold'")).toBe(0);
    db.close();
  });

  it("keeps non-finalised enrolment statuses blocked from completion approval", async () => {
    const { c, db, staff } = testContext();

    for (const status of ["provisional", "transferred", "dropped_out", "cancelled", "expired"] as const) {
      const suffix = `blocked_${status}`;
      seedCertificateStudent(db, suffix, "active", null);
      const submitted = await submitCertificateApplication(
        c,
        { organisationId: "org_samyak", personId: `person_${suffix}` },
        applicationInput({ enrolmentId: `enrolment_${suffix}` }),
      );
      if (!submitted.ok) throw new Error(`expected ${suffix} application submission`);
      db.prepare("update enrolments set status = ?, updated_at = ? where id = ?").run(status, now(), `enrolment_${suffix}`);

      const approved = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");

      expect(approved).toMatchObject({ ok: false, status: 409, code: "invalid_enrolment_status" });
      expect(row(db, "select status, actual_completion_date from enrolments where id = ?", `enrolment_${suffix}`)).toMatchObject({ status, actual_completion_date: null });
      expect(row(db, "select status, completion_date from certificate_applications where id = ?", submitted.application.id)).toMatchObject({ status: "submitted", completion_date: null });
      expect(count(db, `certificate_application_events where application_id = '${submitted.application.id}' and action = 'approved'`)).toBe(0);
    }

    db.close();
  });

  it("returns conflict without partial writes when the enrolment changes after review", async () => {
    const { c, db, staff } = testContext({
      beforeBatch(database) {
        database.prepare("update enrolments set status = 'cancelled', updated_at = ? where id = 'enrolment_active'").run("2026-08-17T00:01:00.000Z");
      },
    });
    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput());
    if (!submitted.ok) throw new Error("expected application submission");

    const approved = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");

    expect(approved).toMatchObject({ ok: false, status: 409, code: "approval_state_changed" });
    expect(row(db, "select status, actual_completion_date from enrolments where id = 'enrolment_active'")).toMatchObject({ status: "cancelled", actual_completion_date: null });
    expect(row(db, "select status, completion_date, reviewed_at, reviewed_by_actor_id from certificate_applications where id = ?", submitted.application.id)).toMatchObject({
      status: "submitted",
      completion_date: null,
      reviewed_at: null,
      reviewed_by_actor_id: null,
    });
    expect(count(db, `certificate_application_events where application_id = '${submitted.application.id}' and action = 'approved'`)).toBe(0);
    db.close();
  });

  it("returns conflict without partial writes when the application changes after review", async () => {
    const { c, db, staff } = testContext({
      beforeBatch(database) {
        database.prepare("update certificate_applications set status = 'cancelled', updated_at = ? where enrolment_id = 'enrolment_active'").run("2026-08-17T00:01:00.000Z");
      },
    });
    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput());
    if (!submitted.ok) throw new Error("expected application submission");

    const approved = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");

    expect(approved).toMatchObject({ ok: false, status: 409, code: "approval_state_changed" });
    expect(row(db, "select status, actual_completion_date from enrolments where id = 'enrolment_active'")).toMatchObject({ status: "active", actual_completion_date: null });
    expect(row(db, "select status, completion_date, reviewed_at, reviewed_by_actor_id from certificate_applications where id = ?", submitted.application.id)).toMatchObject({
      status: "cancelled",
      completion_date: null,
      reviewed_at: null,
      reviewed_by_actor_id: null,
    });
    expect(count(db, `certificate_application_events where application_id = '${submitted.application.id}' and action = 'approved'`)).toBe(0);
    db.close();
  });

  it("allows submitted applications for completed enrolments only when the established date matches", async () => {
    const { c, db, staff } = testContext();
    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_completed" }, applicationInput({ enrolmentId: "enrolment_completed" }));
    if (!submitted.ok) throw new Error("expected completed enrolment application submission");

    const approved = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-10");

    expect(approved).toMatchObject({ ok: true, idempotent: false });
    expect(row(db, "select status, actual_completion_date from enrolments where id = 'enrolment_completed'")).toMatchObject({ status: "completed", actual_completion_date: "2026-08-10" });
    expect(row(db, "select status, completion_date, reviewed_by_actor_id from certificate_applications where id = ?", submitted.application.id)).toMatchObject({
      status: "approved",
      completion_date: "2026-08-10",
      reviewed_by_actor_id: "login_staff",
    });
    expect(count(db, `certificate_application_events where application_id = '${submitted.application.id}' and action = 'approved'`)).toBe(1);
    db.close();
  });

  it("rejects conflicting completion dates without rewriting approved history", async () => {
    const { c, db, staff } = testContext();
    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput());
    if (!submitted.ok) throw new Error("expected application submission");
    await expect(approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18")).resolves.toMatchObject({ ok: true });

    const conflict = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-19");

    expect(conflict).toMatchObject({ ok: false, status: 409, code: "completion_date_conflict" });
    expect(row(db, "select status, actual_completion_date from enrolments where id = 'enrolment_active'")).toMatchObject({ status: "completed", actual_completion_date: "2026-08-18" });
    expect(row(db, "select status, completion_date from certificate_applications where id = ?", submitted.application.id)).toMatchObject({ status: "approved", completion_date: "2026-08-18" });
    expect(count(db, `certificate_application_events where application_id = '${submitted.application.id}' and action = 'approved'`)).toBe(1);
    db.close();
  });

  it("rejects established enrolment completion-date conflicts without mutation", async () => {
    const { c, db, staff } = testContext();
    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_completed" }, applicationInput({ enrolmentId: "enrolment_completed" }));
    if (!submitted.ok) throw new Error("expected completed enrolment application submission");

    const conflict = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");

    expect(conflict).toMatchObject({ ok: false, status: 409, code: "completion_date_conflict" });
    expect(row(db, "select status, actual_completion_date from enrolments where id = 'enrolment_completed'")).toMatchObject({ status: "completed", actual_completion_date: "2026-08-10" });
    expect(row(db, "select status, completion_date, reviewed_at from certificate_applications where id = ?", submitted.application.id)).toMatchObject({
      status: "submitted",
      completion_date: null,
      reviewed_at: null,
    });
    expect(count(db, `certificate_application_events where application_id = '${submitted.application.id}' and action = 'approved'`)).toBe(0);
    db.close();
  });

  it("rejects invalid completion dates and keeps needs-attention recoverable", async () => {
    const { c, db, staff } = testContext();
    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput());
    if (!submitted.ok) throw new Error("expected application submission");
    await expect(approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-01-01")).resolves.toMatchObject({ ok: false, code: "completion_before_joining" });
    await expect(approveCourseCompletionFromApplication(c, staff, submitted.application.id, tomorrowInIndia())).resolves.toMatchObject({ ok: false, code: "completion_date_future" });
    db.prepare("update certificate_applications set status = 'needs_attention', updated_at = ? where id = ?").run(now(), submitted.application.id);

    const approved = await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");

    expect(approved).toMatchObject({ ok: true });
    expect(row(db, "select status from certificate_applications where id = ?", submitted.application.id)).toMatchObject({ status: "approved" });
    db.close();
  });

  it("updates approved applications after certificate issuance while legacy completed enrolments still issue", async () => {
    const { c, db, staff } = testContext();
    const storage = createMemoryCertificatePdfStorage(new Map<string, Uint8Array>());
    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput());
    if (!submitted.ok) throw new Error("expected application submission");
    await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");

    const issuedFromApplication = await issueCertificate(c, staff, "enrolment_active", "2026-08-19", { storage });
    const legacy = await issueCertificate(c, staff, "enrolment_completed", "2026-08-19", { storage });

    expect(issuedFromApplication.ok).toBe(true);
    expect(row(db, "select status from certificate_applications where id = ?", submitted.application.id)).toMatchObject({ status: "certificate_issued" });
    expect(legacy.ok).toBe(true);
    expect(count(db, "certificate_applications where enrolment_id = 'enrolment_completed'")).toBe(0);
    db.close();
  });

  it("reconciles approved application status on idempotent certificate issuance retry", async () => {
    const { c, db, staff } = testContext();
    const storage = createMemoryCertificatePdfStorage(new Map<string, Uint8Array>());
    const submitted = await submitCertificateApplication(c, { organisationId: "org_samyak", personId: "person_active" }, applicationInput());
    if (!submitted.ok) throw new Error("expected application submission");
    await approveCourseCompletionFromApplication(c, staff, submitted.application.id, "2026-08-18");
    await issueCertificate(c, staff, "enrolment_active", "2026-08-19", { storage });
    db.prepare("update certificate_applications set status = 'approved', updated_at = ? where id = ?").run(now(), submitted.application.id);

    const retry = await issueCertificate(c, staff, "enrolment_active", "2026-08-19", { storage });

    expect(retry).toMatchObject({ ok: true, idempotent: true });
    expect(row(db, "select status from certificate_applications where id = ?", submitted.application.id)).toMatchObject({ status: "certificate_issued" });
    expect(count(db, "certificates where enrolment_id = 'enrolment_active' and status = 'issued'")).toBe(1);
    db.close();
  });

  it("enforces duplicate application and event foreign-key constraints in the database", () => {
    const db = migratedSeededDb();
    seedStaff(db);
    seedCertificateStudents(db);
    db.exec("pragma foreign_keys = on");
    const insertApplication = db.prepare(
      `insert into certificate_applications
        (id, organisation_id, branch_id, person_id, student_id, enrolment_id, course_id, status,
         student_completion_confirmed, certificate_details_confirmed, feedback_trainer_clarity_score,
         feedback_practical_learning_score, feedback_course_expectation_score, feedback_overall_score,
         low_feedback_flag, applied_at, created_at, updated_at)
       values (?, 'org_samyak', 'branch_sion', 'person_active', 'student_active', 'enrolment_active',
         'course_syk_wdd_001', 'submitted', 1, 1, 5, 5, 5, 5, 0, ?, ?, ?)`,
    );
    insertApplication.run("certapp_direct_1", now(), now(), now());

    expect(() => insertApplication.run("certapp_direct_2", now(), now(), now())).toThrow();
    expect(() => db.prepare(
      `insert into certificate_application_events
        (id, organisation_id, branch_id, application_id, action, to_status, created_at)
       values ('certappevt_missing', 'org_samyak', 'branch_sion', 'certapp_missing', 'submitted', 'submitted', ?)`,
    ).run(now())).toThrow();
    db.close();
  });
});

function testContext(options: { beforeBatch?: (db: DatabaseSync) => void } = {}) {
  const db = migratedSeededDb();
  seedStaff(db);
  seedCertificateStudents(db);
  return {
    db,
    c: {
      env: {
        DB: new SqliteD1(db, options),
        ENVIRONMENT: "production",
        CERTIFICATE_VERIFICATION_ORIGIN: "https://edu.rememo.in",
      },
    } as unknown as AppContext,
    staff: { loginAccountId: "login_staff", activePersonId: "person_staff", roles: ["owner"] } satisfies StaffContext,
  };
}

function seedStaff(db: DatabaseSync) {
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_staff', 'org_samyak', 'branch_sion', 'Synthetic Staff', 'Synthetic Staff', 'active', ?, ?)").run(now(), now());
  db.prepare("insert into login_accounts (id, organisation_id, mobile_normalized, mobile_last_four, login_enabled, status, created_at, updated_at) values ('login_staff', 'org_samyak', '+919876543210', '3210', 1, 'active', ?, ?)").run(now(), now());
  db.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values ('login_staff', 'person_staff', 'staff', 1, 1, ?)").run(now());
  db.prepare("insert or ignore into roles (id, organisation_id, code, name, created_at) values ('role_owner', 'org_samyak', 'owner', 'Owner', ?)").run(now());
  db.prepare("insert or ignore into login_account_roles (login_account_id, role_id, branch_id, created_at) values ('login_staff', 'role_owner', null, ?)").run(now());
}

function seedDemoOrganisation(db: DatabaseSync) {
  db.prepare(`insert into organisations
    (id, name, slug, status, organisation_kind, legal_name, address_line1, city, state_region, country, postcode, website, created_at, updated_at)
    values ('org_demo', 'Demo Institute', 'demo-institute', 'active', 'demo', 'Demo Institute LLP', '42 Demo Road', 'Mumbai', 'Maharashtra', 'IN', '400001', 'https://demo.example', ?, ?)`)
    .run(now(), now());
  db.prepare(`insert into branches
    (id, organisation_id, name, code, timezone, status, address_line1, city, state_region, country, postcode, email, centre_status, created_at, updated_at)
    values ('branch_demo_main', 'org_demo', 'Main Centre', 'MAIN', 'Asia/Kolkata', 'active', '42 Demo Road', 'Mumbai', 'Maharashtra', 'IN', '400001', 'hello@demo.example', 'active', ?, ?)`)
    .run(now(), now());
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_demo_staff', 'org_demo', 'branch_demo_main', 'Demo Staff', 'Demo Staff', 'active', ?, ?)").run(now(), now());
  db.prepare("insert into login_accounts (id, organisation_id, mobile_normalized, mobile_last_four, login_enabled, status, created_at, updated_at) values ('login_demo_staff', 'org_demo', '+919876543211', '3211', 1, 'active', ?, ?)").run(now(), now());
  db.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values ('login_demo_staff', 'person_demo_staff', 'staff', 1, 1, ?)").run(now());
  db.prepare("insert into roles (id, organisation_id, code, name, created_at) values ('role_demo_owner', 'org_demo', 'owner', 'Owner', ?)").run(now());
  db.prepare("insert into login_account_roles (login_account_id, role_id, branch_id, created_at) values ('login_demo_staff', 'role_demo_owner', null, ?)").run(now());
  db.prepare("insert into courses (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at) values ('course_demo_fullstack', 'org_demo', 'FSD', 'Full Stack Demo', '6 months', 6, 5000000, 4500000, 1, 0, 'active', ?, ?)").run(now(), now());
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_demo_completed', 'org_demo', 'branch_demo_main', 'Demo Completed Student', 'Demo Student', 'active', ?, ?)").run(now(), now());
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values ('student_demo_completed', 'org_demo', 'person_demo_completed', 'branch_demo_main', 'DEMO-MAIN-9001', 9001, '2026-01-01', 'completed', 'active', ?, ?)").run(now(), now());
  db.prepare(`insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference, batch_id,
       admission_date, joining_date, expected_completion_date, actual_completion_date, status, nsdc_preference,
       referrer_profile_id, created_at, updated_at)
     values ('enrolment_demo_completed', 'student_demo_completed', 'branch_demo_main', 'course_demo_fullstack', null, 'DEMO-ENR-001', 'classroom', null, null,
       '2026-01-05', '2026-01-10', '2026-08-10', '2026-08-10', 'completed', 'decide_later', null, ?, ?)`)
    .run(now(), now());
}

function seedCollisionCertificateOrganisation(db: DatabaseSync, input: {
  organisationId: string;
  slug: string;
  name: string;
  branchId: string;
  staffPersonId: string;
  loginAccountId: string;
  roleId: string;
  courseId: string;
  personId: string;
  studentId: string;
  enrolmentId: string;
  mobile: string;
  studentNumber: string;
  sequenceNumber: number;
}) {
  db.prepare(`insert into organisations
    (id, name, slug, status, organisation_kind, legal_name, address_line1, city, state_region, country, postcode, website, created_at, updated_at)
    values (?, ?, ?, 'active', 'normal', ?, '42 Collision Road', 'Mumbai', 'Maharashtra', 'IN', '400001', 'https://collision.example', ?, ?)`)
    .run(input.organisationId, input.name, input.slug, `${input.name} LLP`, now(), now());
  db.prepare(`insert into branches
    (id, organisation_id, name, code, timezone, status, address_line1, city, state_region, country, postcode, email, centre_status, created_at, updated_at)
    values (?, ?, 'Main Centre', 'MAIN', 'Asia/Kolkata', 'active', '42 Collision Road', 'Mumbai', 'Maharashtra', 'IN', '400001', 'hello@collision.example', 'active', ?, ?)`)
    .run(input.branchId, input.organisationId, now(), now());
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, ?, ?, ?, ?, 'active', ?, ?)")
    .run(input.staffPersonId, input.organisationId, input.branchId, `${input.name} Staff`, `${input.name} Staff`, now(), now());
  db.prepare("insert into login_accounts (id, organisation_id, mobile_normalized, mobile_last_four, login_enabled, status, created_at, updated_at) values (?, ?, ?, ?, 1, 'active', ?, ?)")
    .run(input.loginAccountId, input.organisationId, input.mobile, input.mobile.slice(-4), now(), now());
  db.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values (?, ?, 'staff', 1, 1, ?)")
    .run(input.loginAccountId, input.staffPersonId, now());
  db.prepare("insert into roles (id, organisation_id, code, name, created_at) values (?, ?, 'owner', 'Owner', ?)")
    .run(input.roleId, input.organisationId, now());
  db.prepare("insert into login_account_roles (login_account_id, role_id, branch_id, created_at) values (?, ?, null, ?)")
    .run(input.loginAccountId, input.roleId, now());
  db.prepare("insert into courses (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at) values (?, ?, 'FSD', 'Full Stack Collision', '6 months', 6, 5000000, 4500000, 1, 0, 'active', ?, ?)")
    .run(input.courseId, input.organisationId, now(), now());
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, ?, ?, ?, ?, 'active', ?, ?)")
    .run(input.personId, input.organisationId, input.branchId, `${input.name} Completed Student`, `${input.name} Student`, now(), now());
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, '2026-01-01', 'completed', 'active', ?, ?)")
    .run(input.studentId, input.organisationId, input.personId, input.branchId, input.studentNumber, input.sequenceNumber, now(), now());
  db.prepare(`insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference, batch_id,
       admission_date, joining_date, expected_completion_date, actual_completion_date, status, nsdc_preference,
       referrer_profile_id, created_at, updated_at)
     values (?, ?, ?, ?, null, ?, 'classroom', null, null,
       '2026-01-05', '2026-01-10', '2026-08-10', '2026-08-10', 'completed', 'decide_later', null, ?, ?)`)
    .run(input.enrolmentId, input.studentId, input.branchId, input.courseId, `ENR-${input.studentNumber}`, now(), now());
}

function seedMalformedDemoCertificateEnrolments(db: DatabaseSync) {
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values ('student_demo_bad_person', 'org_demo', 'person_active', 'branch_demo_main', 'DEMO-MAIN-9101', 9101, '2026-01-01', 'completed', 'active', ?, ?)")
    .run(now(), now());
  db.prepare(`insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference, batch_id,
       admission_date, joining_date, expected_completion_date, actual_completion_date, status, nsdc_preference,
       referrer_profile_id, created_at, updated_at)
     values ('enrolment_demo_bad_person', 'student_demo_bad_person', 'branch_demo_main', 'course_demo_fullstack', null, 'DEMO-ENR-BAD-PERSON', 'classroom', null, null,
       '2026-01-05', '2026-01-10', '2026-08-10', '2026-08-10', 'completed', 'decide_later', null, ?, ?)`)
    .run(now(), now());

  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_demo_bad_course', 'org_demo', 'branch_demo_main', 'Demo Bad Course Student', 'Demo Bad Course', 'active', ?, ?)")
    .run(now(), now());
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values ('student_demo_bad_course', 'org_demo', 'person_demo_bad_course', 'branch_demo_main', 'DEMO-MAIN-9102', 9102, '2026-01-01', 'completed', 'active', ?, ?)")
    .run(now(), now());
  db.prepare(`insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference, batch_id,
       admission_date, joining_date, expected_completion_date, actual_completion_date, status, nsdc_preference,
       referrer_profile_id, created_at, updated_at)
     values ('enrolment_demo_bad_course', 'student_demo_bad_course', 'branch_demo_main', 'course_syk_wdd_001', null, 'DEMO-ENR-BAD-COURSE', 'classroom', null, null,
       '2026-01-05', '2026-01-10', '2026-08-10', '2026-08-10', 'completed', 'decide_later', null, ?, ?)`)
    .run(now(), now());

  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_demo_bad_branch', 'org_demo', 'branch_demo_main', 'Demo Bad Branch Student', 'Demo Bad Branch', 'active', ?, ?)")
    .run(now(), now());
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values ('student_demo_bad_branch', 'org_demo', 'person_demo_bad_branch', 'branch_demo_main', 'DEMO-MAIN-9103', 9103, '2026-01-01', 'completed', 'active', ?, ?)")
    .run(now(), now());
  db.prepare(`insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference, batch_id,
       admission_date, joining_date, expected_completion_date, actual_completion_date, status, nsdc_preference,
       referrer_profile_id, created_at, updated_at)
     values ('enrolment_demo_bad_branch', 'student_demo_bad_branch', 'branch_sion', 'course_demo_fullstack', null, 'DEMO-ENR-BAD-BRANCH', 'classroom', null, null,
       '2026-01-05', '2026-01-10', '2026-08-10', '2026-08-10', 'completed', 'decide_later', null, ?, ?)`)
    .run(now(), now());
}

function seedCertificateStudents(db: DatabaseSync) {
  seedCertificateStudent(db, "completed", "completed", "2026-08-10");
  seedCertificateStudent(db, "active", "active", null);
  seedCertificateStudent(db, "on_hold", "on_hold", null);
  seedCertificateStudent(db, "completed_null_date", "completed", null);
  seedCertificateStudent(db, "storage_failure", "completed", "2026-08-12");
}

function applicationInput(overrides: Partial<Parameters<typeof submitCertificateApplication>[2]> = {}) {
  return {
    enrolmentId: "enrolment_active",
    studentCompletionConfirmed: true,
    certificateDetailsConfirmed: true,
    feedbackTrainerClarityScore: 5,
    feedbackPracticalLearningScore: 5,
    feedbackCourseExpectationScore: 5,
    feedbackOverallScore: 5,
    feedbackImprovementText: null,
    ...overrides,
  };
}

function seedCertificateStudent(db: DatabaseSync, suffix: string, enrolmentStatus: string, actualCompletionDate: string | null) {
  const studentStatus = enrolmentStatus === "completed" ? "completed" : enrolmentStatus === "on_hold" ? "on_hold" : "active";
  const readableName = title(suffix.replace(/_/g, " "));
  const fixedSequences: Record<string, number> = { completed: 1, active: 2, on_hold: 3, completed_null_date: 4, storage_failure: 5, active_boundary: 6, active_overall: 7 };
  const sequence = fixedSequences[suffix] || 100 + Array.from(suffix).reduce((total, char) => total + char.charCodeAt(0), 0);
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', ?, ?, 'active', ?, ?)")
    .run(`person_${suffix}`, `Synthetic ${readableName} Student`, `Synthetic ${readableName}`, now(), now());
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values (?, 'org_samyak', ?, 'branch_sion', ?, ?, '2026-01-01', ?, 'active', ?, ?)")
    .run(`student_${suffix}`, `person_${suffix}`, `SYK-SION-90${sequence.toString().padStart(4, "0")}`, 9000 + sequence, studentStatus, now(), now());
  db.prepare(`insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, batch_preference, batch_id,
       admission_date, joining_date, expected_completion_date, actual_completion_date, status, nsdc_preference,
       referrer_profile_id, created_at, updated_at)
     values (?, ?, 'branch_sion', 'course_syk_wdd_001', null, ?, 'classroom', null, null,
       '2026-01-05', '2026-01-10', '2026-08-10', ?, ?, 'decide_later', null, ?, ?)`)
    .run(`enrolment_${suffix}`, `student_${suffix}`, `ENR-${suffix.toUpperCase()}`, actualCompletionDate, enrolmentStatus, now(), now());
  seedFeeAgreement(db, suffix, { receipts: [1400000] });
}

function seedFeeAgreement(
  db: DatabaseSync,
  suffix: string,
  options: { finalFee?: number; receipts?: number[]; reversedReceiptIndexes?: number[] } = {},
) {
  const finalFee = options.finalFee ?? 1400000;
  const receipts = options.receipts ?? [finalFee];
  const reversed = new Set(options.reversedReceiptIndexes || []);
  db.prepare(`insert into fee_agreements
      (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, gst_rate_basis_points, payment_plan_type, status, created_at, updated_at)
     values (?, ?, ?, ?, 0, 0, 'full_payment', 'active', ?, ?)`)
    .run(`fee_${suffix}`, `enrolment_${suffix}`, finalFee, finalFee, now(), now());
  db.prepare("insert into fee_agreement_instalments (id, fee_agreement_id, instalment_number, amount_paise, due_date, created_at) values (?, ?, 1, ?, '2026-01-05', ?)")
    .run(`inst_${suffix}_1`, `fee_${suffix}`, finalFee, now());
  receipts.forEach((amount, index) => {
    const receiptId = `receipt_${suffix}_${index + 1}`;
    db.prepare(`insert into receipts
        (id, organisation_id, branch_id, receipt_number, receipt_year, enquiry_id, admission_draft_id, person_id, student_id, enrolment_id, fee_agreement_id,
         amount_paise, received_at, payment_mode, payment_reference, notes, status, created_by_login_account_id, idempotency_key, payload_fingerprint, created_at, updated_at)
       values (?, 'org_samyak', 'branch_sion', ?, 2026, null, null, ?, ?, ?, ?, ?, ?, 'upi', null, null, 'recorded', 'login_staff', ?, ?, ?, ?)`)
      .run(
        receiptId,
        `RCP-${suffix.toUpperCase()}-${index + 1}`,
        `person_${suffix}`,
        `student_${suffix}`,
        `enrolment_${suffix}`,
        `fee_${suffix}`,
        amount,
        now(),
        `receipt_${suffix}_${index + 1}`,
        `fingerprint_${suffix}_${index + 1}`,
        now(),
        now(),
      );
    if (reversed.has(index)) {
      db.prepare(`insert into receipt_reversals
          (id, organisation_id, branch_id, receipt_id, enrolment_id, fee_agreement_id, reason, reversed_by_login_account_id, idempotency_key, payload_fingerprint, created_at)
         values (?, 'org_samyak', 'branch_sion', ?, ?, ?, 'Synthetic reversal', 'login_staff', ?, ?, ?)`)
        .run(`reversal_${suffix}_${index + 1}`, receiptId, `enrolment_${suffix}`, `fee_${suffix}`, `reversal_${suffix}_${index + 1}`, `reversal_fingerprint_${suffix}_${index + 1}`, now());
    }
  });
}

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
  let sql = readFileSync(join(process.cwd(), "seed.sql"), "utf8");
  if (!tableExists(db, "centre_commercial_access")) {
    sql = sql.replace(/INSERT INTO centre_commercial_access[\s\S]*?ON CONFLICT\(branch_id\) DO UPDATE SET[\s\S]*?updated_at = excluded\.updated_at;\s*/m, "");
  }
  applySql(db, sql);
}

function applySql(db: DatabaseSync, sql: string) {
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
}

function tableExists(db: DatabaseSync, name: string) {
  return Boolean(db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(name));
}

function seedBase(db: DatabaseSync) {
  db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run("2026-08-08T00:00:00.000Z", "2026-08-08T00:00:00.000Z");
}

function migratedSeededDb() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  applySeed(db);
  return db;
}

function row(db: DatabaseSync, sql: string, ...values: SqlValue[]) {
  return db.prepare(sql).get(...values) as Record<string, unknown> | undefined;
}

function count(db: DatabaseSync, fromAndWhere: string) {
  return (db.prepare(`select count(*) as count from ${fromAndWhere}`).get() as { count: number }).count;
}

function columns(db: DatabaseSync, tableName: string) {
  return db.prepare(`pragma table_info(${tableName})`).all().map((item) => String((item as Record<string, unknown>).name));
}

function indexes(db: DatabaseSync) {
  return db.prepare("select name from sqlite_master where type = 'index'").all().map((item) => String((item as Record<string, unknown>).name));
}

function title(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function now() {
  return "2026-08-17T00:00:00.000Z";
}

function tomorrowInIndia() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(tomorrow);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

class SqliteD1 {
  private batchCount = 0;
  constructor(private readonly db: DatabaseSync, private readonly options: { beforeBatch?: (db: DatabaseSync) => void } = {}) {}
  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql, []);
  }
  async batch(statements: SqliteD1Statement[]) {
    this.batchCount += 1;
    if (this.batchCount === 2) this.options.beforeBatch?.(this.db);
    this.db.exec("begin");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.db.exec("commit");
      return results;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }
}

class SqliteD1Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly params: SqlValue[]) {}
  bind(...params: SqlValue[]) {
    return new SqliteD1Statement(this.db, this.sql, params);
  }
  async first<T = unknown>() {
    return (this.statement().get(...this.params) as T | undefined) || null;
  }
  async all<T = unknown>() {
    return { success: true, results: this.statement().all(...this.params) as T[], meta: {} };
  }
  async run() {
    return this.runSync();
  }
  runSync() {
    const result = this.statement().run(...this.params);
    return { success: true, meta: { changes: result.changes, rows_written: result.changes } };
  }
  private statement(): StatementSync {
    return this.db.prepare(this.sql);
  }
}
