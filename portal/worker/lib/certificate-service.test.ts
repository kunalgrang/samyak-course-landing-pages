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

function testContext() {
  const db = migratedSeededDb();
  seedStaff(db);
  seedCertificateStudents(db);
  return {
    db,
    c: {
      env: {
        DB: new SqliteD1(db),
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
  const studentStatus = enrolmentStatus === "completed" ? "completed" : enrolmentStatus;
  const readableName = title(suffix.replace(/_/g, " "));
  const sequence = suffix === "completed" ? 1 : suffix === "active" ? 2 : suffix === "on_hold" ? 3 : suffix === "completed_null_date" ? 4 : suffix === "active_boundary" ? 6 : suffix === "active_overall" ? 7 : 5;
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
  applySql(db, readFileSync(join(process.cwd(), "seed.sql"), "utf8"));
}

function applySql(db: DatabaseSync, sql: string) {
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
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
  constructor(private readonly db: DatabaseSync) {}
  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql, []);
  }
  async batch(statements: SqliteD1Statement[]) {
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
