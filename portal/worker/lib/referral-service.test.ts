/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { encryptText, hmacHex } from "./crypto";
import { normalizeIndianMobile } from "./mobile";
import { getRecoverableReferralLink, issueReferralLink, listEligibleReferralCourses, normalizeSubmittedReferralName, resolveReferralLink, rotateReferralLink, submitReferralAndCreateEnquiry, type ReferralServiceEnv } from "./referral-service";
import { hashReferralToken } from "./referral-token";
import type { ReferralDb } from "./referral-repository";
import { groupEligibleCourses, registerPublicReferralRoutes } from "../routes/public-referrals";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { registerStudentRoutes } from "../routes/student";
import { registerStaffReferralRoutes } from "../routes/staff-referrals";
import { registerStaffEducationPartnerRoutes } from "../routes/staff-education-partners";
import { registerStaffAdmissionRoutes } from "../routes/staff-admissions";

const NOW = "2026-08-06T10:00:00.000Z";
const PARTNER_NOW = "2026-08-25T10:00:00.000Z";
const SESSION_PEPPER = "session-pepper-for-referral-tests";
const TEST_REFERRAL_TOKEN_PEPPER = "referral-token-pepper-for-tests";
const RESOLVE_LIMIT_WINDOW_SECONDS = 60;
type SqlValue = string | number | bigint | null | Uint8Array;

const WORKBOOK_COURSES = [
  ["SYK-MSCIT-001", "MS CIT", "MSCIT", 2, 620000, 558000],
  ["SYK-CCC-001", "CCC", "CCC", 2, 500000, 450000],
  ["SYK-CCC-002", "CCC+", "CCC", 2, 550000, 495000],
  ["SYK-MSO-001", "MS OFFICE", "MSO", 1.5, 550000, 495000],
  ["SYK-AEX-001", "ADVANCED EXCEL", "AEX", 1, 550000, 495000],
  ["SYK-TLY-001", "BASIC TALLY", "TLY", 1, 600000, 540000],
  ["SYK-TLY-002", "TALLY WITH TAX", "TLY", 2, 1200000, 1080000],
  ["SYK-TLY-003", "CAP - TALLY WITH TAX AND MS OFFICE", "TLY", 3, 1600000, 1440000],
  ["SYK-DMK-001", "DIGITAL MARKETING WITH AI TOOLS", "DMK", 3, 2400000, 2160000],
  ["SYK-DMK-002", "DIGITAL MARKETING WITH WORDPRESS", "DMK", 4, 3500000, 3150000],
  ["SYK-DMK-003", "WORDPRESS", "DMK", 1, 1000000, 900000],
  ["SYK-DMK-004", "SHOPIFY", "DMK", 1.5, 1400000, 1260000],
  ["SYK-DMK-005", "ECOMMERCE", "DMK", 2, 1500000, 1350000],
  ["SYK-DMK-006", "META ADS", "DMK", 1, 750000, 675000],
  ["SYK-DMK-007", "SEO", "DMK", 1, 550000, 495000],
  ["SYK-DMK-008", "GOOGLE ADS", "DMK", 1, 750000, 675000],
  ["SYK-DAN-001", "DATA ANALYTICS - BEGINNER", "DAN", 4, 2500000, 2250000],
  ["SYK-DAN-002", "DATA ANALYTICS - ADVANCED", "DAN", 6, 4500000, 4050000],
  ["SYK-DAN-003", "POWER BI", "DAN", 1, 1250000, 1125000],
  ["SYK-WDD-001", "FULL STACK COURSE - 6 MONTHS", "WDD", 6, 4500000, 4050000],
  ["SYK-WDD-002", "HTML", "WDD", 1, 1800000, 1620000],
  ["SYK-WDD-003", "CSS", "WDD", 1, 800000, 720000],
  ["SYK-WDD-004", "JAVA", "WDD", 1, 800000, 720000],
  ["SYK-WDD-005", "PYTHON & WEB DESIGN", "WDD", 3, 2500000, 2250000],
  ["SYK-WDD-006", "REACT, NODE.JS WITH MONGO DB", "WDD", 4, 4000000, 3600000],
  ["SYK-WDD-007", "UI UX", "WDD", 2, 1800000, 1620000],
  ["SYK-GDS-001", "GRAPHIC DESIGN DIPLOMA", "GDS", 4, 3200000, 2880000],
  ["SYK-GDS-002", "CORELDRAW", "GDS", 1, 750000, 675000],
  ["SYK-GDS-003", "ADOBE PHOTOSHOP", "GDS", 1, 750000, 675000],
  ["SYK-GDS-004", "ADOBE ILLUSTRATOR", "GDS", 1.5, 1200000, 1080000],
  ["SYK-GDS-005", "CANVA", "GDS", 1, 750000, 675000],
  ["SYK-VED-001", "FILMORA", "VED", 1, 1100000, 990000],
  ["SYK-VED-002", "ADOBE PREMIERE PRO", "VED", 2, 1600000, 1440000],
  ["SYK-AVX-001", "ADOBE ANIMATE", "AVX", 1.5, 1400000, 1260000],
  ["SYK-DSAI-001", "AI TOOLS & PROMPTING", "DSAI", 1, 700000, 630000],
  ["SYK-DSAI-002", "DIPLOMA IN MACHINE LEARNING", "DSAI", 3, 3500000, 3150000],
  ["SYK-DSAI-003", "PYTHON - BEGINNER", "DSAI", 1, 850000, 765000],
  ["SYK-DSAI-004", "PYTHON - ADVANCED", "DSAI", 2, 1600000, 1440000],
  ["SYK-DSAI-005", "R PROGRAMMING LANGUAGE", "DSAI", 1.5, 2500000, 2250000],
  ["SYK-CIV-001", "PRIMAVERA", "CIV", 2, 2200000, 1980000],
  ["SYK-CIV-002", "MS PROJECT", "CIV", 1, 1000000, 900000],
  ["SYK-SFT-001", "SPOKEN ENGLISH", "SFT", 1.5, 700000, 630000],
] as const;

describe("native referral services", () => {
  it("issues a strong referral token and stores hash plus encrypted recovery secret", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);

    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      loginAccountId: "acct_student",
      personId: "person_student",
      now: NOW,
    });
    const duplicate = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      loginAccountId: "acct_student",
      personId: "person_student",
      now: NOW,
    });

    expect(issued.issued).toBe(true);
    expect(issued.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(duplicate).toMatchObject({ issued: false, rawToken: null, link: { id: issued.link.id } });
    expect(count(fixture.sqlite, "referral_links")).toBe(1);
    const stored = row(fixture.sqlite, "select token_hash, token_last_four from referral_links");
    expect(stored?.token_hash).toBe(await hashReferralToken(issued.rawToken!, TEST_REFERRAL_TOKEN_PEPPER));
    expect(stored?.token_hash).not.toContain(issued.rawToken);
    expect(stored?.token_last_four).toBe(issued.rawToken!.slice(-4));
    const secret = row(fixture.sqlite, "select token_ciphertext from referral_link_secrets where referral_link_id = ?", issued.link.id);
    expect(String(secret?.token_ciphertext)).toMatch(/^v1:/);
    expect(String(secret?.token_ciphertext)).not.toContain(issued.rawToken);
    expect(String(secret?.token_ciphertext)).not.toContain("/r/");
    expect(JSON.stringify(all(fixture.sqlite, "select * from referral_links"))).not.toContain(issued.rawToken);
    expect(JSON.stringify(all(fixture.sqlite, "select * from referral_link_secrets"))).not.toContain(issued.rawToken);
    expect(JSON.stringify(all(fixture.sqlite, "select * from audit_logs"))).not.toContain(issued.rawToken);
    const recovered = await getRecoverableReferralLink(fixture.env, {
      link: { id: issued.link.id, organisation_id: "org_samyak", token_hash: String(stored?.token_hash) },
      publicOrigin: "https://go.samyaksion.com",
    });
    expect(recovered).toMatchObject({ recoverable: true, publicUrl: `https://go.samyaksion.com/r/${issued.rawToken}` });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: issued.rawToken!, now: NOW })).toMatchObject({ valid: true });
    fixture.close();
  });

  it("fails active-link recovery safely when the encrypted secret is missing, mismatched, or context-swapped", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      now: NOW,
    });
    if (!issued.rawToken) throw new Error("Expected raw token");
    const stored = row(fixture.sqlite, "select token_hash from referral_links where id = ?", issued.link.id);

    fixture.sqlite.prepare("delete from referral_link_secrets where referral_link_id = ?").run(issued.link.id);
    await expect(getRecoverableReferralLink(fixture.env, {
      link: { id: issued.link.id, organisation_id: "org_samyak", token_hash: String(stored?.token_hash) },
      publicOrigin: "https://go.samyaksion.com",
    })).resolves.toEqual({ recoverable: false, reason: "missing_secret" });

    const wrongCiphertext = await encryptText(SESSION_PEPPER, `referral-link-token:${issued.link.id}`, "WRONG-TOKEN-VALUE-1234567890");
    fixture.sqlite.prepare(
      "insert into referral_link_secrets (referral_link_id, token_ciphertext, encryption_version, created_at, updated_at) values (?, ?, 'v1', ?, ?)",
    ).run(issued.link.id, wrongCiphertext, NOW, NOW);
    await expect(getRecoverableReferralLink(fixture.env, {
      link: { id: issued.link.id, organisation_id: "org_samyak", token_hash: String(stored?.token_hash) },
      publicOrigin: "https://go.samyaksion.com",
    })).resolves.toEqual({ recoverable: false, reason: "invalid_secret" });

    const wrongContextCiphertext = await encryptText(SESSION_PEPPER, "referral-link-token:rlink_other", issued.rawToken);
    fixture.sqlite.prepare("update referral_link_secrets set token_ciphertext = ? where referral_link_id = ?").run(wrongContextCiphertext, issued.link.id);
    await expect(getRecoverableReferralLink(fixture.env, {
      link: { id: issued.link.id, organisation_id: "org_samyak", token_hash: String(stored?.token_hash) },
      publicOrigin: "https://go.samyaksion.com",
    })).resolves.toEqual({ recoverable: false, reason: "invalid_secret" });
    fixture.close();
  });

  it("rejects ineligible, cross-organisation, and shared-family referrer issuance", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedReferrer(fixture.sqlite, { suffix: "family", loginAccessType: "shared_family" });
    seedReferrer(fixture.sqlite, { suffix: "other", organisationId: "org_other" });
    fixture.sqlite.prepare("delete from person_roles where person_id = 'person_family'").run();

    await expect(issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_family",
      loginAccountId: "acct_family",
      personId: "person_family",
      now: NOW,
    })).rejects.toMatchObject({ code: "invalid_referrer" });
    await expect(issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_other",
      now: NOW,
    })).rejects.toMatchObject({ code: "invalid_referrer" });
    fixture.close();
  });

  it("rotates referral links atomically without exposing old tokens or breaking attribution history", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      loginAccountId: "acct_student",
      personId: "person_student",
      now: NOW,
    });
    if (!issued.rawToken) throw new Error("Expected initial raw token");
    const oldToken = issued.rawToken;
    const oldLinkId = issued.link.id;

    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: oldToken, now: NOW })).toMatchObject({ valid: true });
    const rotated = await rotateReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      loginAccountId: "acct_student",
      personId: "person_student",
      now: "2026-08-06T10:00:10.000Z",
    });

    expect(rotated.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated.rawToken).not.toBe(oldToken);
    expect(rotated.previousLinkId).toBe(oldLinkId);
    expect(count(fixture.sqlite, "referral_links where status = 'active' and referrer_profile_id = 'refprof_student'")).toBe(1);
    expect(count(fixture.sqlite, "referral_links where status = 'revoked' and id = '" + oldLinkId + "'")).toBe(1);
    expect(row(fixture.sqlite, "select token_hash, token_last_four from referral_links where id = ?", rotated.link.id)).toMatchObject({
      token_hash: await hashReferralToken(rotated.rawToken, TEST_REFERRAL_TOKEN_PEPPER),
      token_last_four: rotated.rawToken.slice(-4),
    });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: oldToken, now: NOW })).toEqual({ valid: false, reason: "invalid_link" });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: rotated.rawToken, now: NOW })).toMatchObject({ valid: true });
    const auditJson = JSON.stringify(all(fixture.sqlite, "select action, metadata_json from audit_logs"));
    expect(auditJson).toContain("referral_link_rotated");
    expect(auditJson).toContain(oldLinkId);
    expect(auditJson).not.toContain(oldToken);
    expect(auditJson).not.toContain(rotated.rawToken);
    expect(auditJson).not.toContain("/r/");
    fixture.close();
  });

  it("resolves only valid active links with generic public invalid results and explicit course configuration", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      now: NOW,
    });

    const eligibleCourses = await listEligibleReferralCourses(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", now: NOW });
    expect(eligibleCourses).toHaveLength(42);
    expect(eligibleCourses.map((course) => course.code)).toContain("SYK-WDD-001");
    expect(eligibleCourses.map((course) => course.code)).toContain("SYK-DSAI-003");
    expect(eligibleCourses.map((course) => course.code)).toContain("SYK-SFT-001");
    seedCourse(fixture.sqlite, "course_future", "FUTURE", "Future Course", "active", "ccat_wdd");
    const resolved = await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: issued.rawToken!, now: NOW });
    expect(resolved).toMatchObject({
      valid: true,
      programme: { publicName: "Samyak Skill Circle" },
      referrer: { publicDisplayName: "Student Referrer" },
    });
    expect(resolved.valid ? resolved.courses : []).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "course_syk_wdd_001",
        code: "SYK-WDD-001",
        name: "FULL STACK COURSE - 6 MONTHS",
        duration_label: "6 months",
        duration_months: 6,
        category_code: "WDD",
        category_name: "WEB DESIGN & DEVELOPMENT",
      }),
    ]));
    expect((await listEligibleReferralCourses(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", now: NOW })).map((course) => course.code)).not.toContain("FUTURE");
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: "bad", now: NOW })).toEqual({ valid: false, reason: "invalid_link" });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_other", rawToken: issued.rawToken!, now: NOW })).toEqual({ valid: false, reason: "invalid_link" });

    fixture.sqlite.prepare("update referral_links set status = 'revoked', revoked_at = ? where id = ?").run(NOW, issued.link.id);
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: issued.rawToken!, now: NOW })).toEqual({ valid: false, reason: "invalid_link" });
    fixture.close();
  });

  it("seeds the owner-approved canonical Course Master and explicit 42-course referral eligibility", async () => {
    const fixture = testFixture();
    expect(count(fixture.sqlite, "course_categories where organisation_id = 'org_samyak'")).toBe(14);
    expect(count(fixture.sqlite, "courses where organisation_id = 'org_samyak'")).toBe(42);
    expect(new Set(WORKBOOK_COURSES.map(([code]) => code)).size).toBe(42);
    expect(count(fixture.sqlite, "courses where organisation_id = 'org_samyak' and status = 'active' and admission_configuration_complete = 1")).toBe(42);
    expect(count(fixture.sqlite, "referral_programme_courses where referral_programme_id = 'rprog_samyak_skill_circle' and is_active = 1")).toBe(42);
    expect(count(fixture.sqlite, "courses group by organisation_id, code having count(*) > 1")).toBe(0);
    expect(count(fixture.sqlite, "courses left join course_categories on course_categories.id = courses.category_id where courses.organisation_id = 'org_samyak' and course_categories.id is null")).toBe(0);

    for (const [code, name, categoryCode, durationMonths, listPricePaise, lowestFeePaise] of WORKBOOK_COURSES) {
      expect(row(
        fixture.sqlite,
        `select courses.id, courses.code, courses.name, course_categories.code as category_code, courses.duration_months,
          courses.default_fee_paise, courses.lowest_acceptable_fee_paise, courses.status, courses.admission_configuration_complete,
          referral_programme_courses.is_active as referral_eligible
         from courses
         join course_categories on course_categories.id = courses.category_id
         join referral_programme_courses on referral_programme_courses.course_id = courses.id
         where courses.organisation_id = 'org_samyak' and courses.code = ?`,
        code,
      )).toMatchObject({
        id: `course_${code.toLowerCase().replaceAll("-", "_")}`,
        code,
        name,
        category_code: categoryCode,
        duration_months: durationMonths,
        default_fee_paise: listPricePaise,
        lowest_acceptable_fee_paise: lowestFeePaise,
        status: "active",
        admission_configuration_complete: 1,
        referral_eligible: 1,
      });
    }

    const pythonCourses = all(fixture.sqlite, "select code, name, duration_months, default_fee_paise, lowest_acceptable_fee_paise from courses where code in ('SYK-DSAI-003', 'SYK-DSAI-004') order by code");
    expect(pythonCourses).toEqual([
      { code: "SYK-DSAI-003", name: "PYTHON - BEGINNER", duration_months: 1, default_fee_paise: 850000, lowest_acceptable_fee_paise: 765000 },
      { code: "SYK-DSAI-004", name: "PYTHON - ADVANCED", duration_months: 2, default_fee_paise: 1600000, lowest_acceptable_fee_paise: 1440000 },
    ]);
    expect(row(fixture.sqlite, "select id, code, name, duration_months, status, admission_configuration_complete from courses where code = 'SYK-MSO-001'")).toMatchObject({
      id: "course_syk_mso_001",
      code: "SYK-MSO-001",
      name: "MS OFFICE",
      duration_months: 1.5,
      status: "active",
      admission_configuration_complete: 1,
    });
    expect(row(fixture.sqlite, "select id, code, name, duration_months, status, admission_configuration_complete from courses where code = 'SYK-MSCIT-001'")).toMatchObject({
      id: "course_syk_mscit_001",
      code: "SYK-MSCIT-001",
      name: "MS CIT",
      duration_months: 2,
      status: "active",
      admission_configuration_complete: 1,
    });
    expect(count(fixture.sqlite, "courses where code = 'SYK-AVX-001'")).toBe(1);
    expect(count(fixture.sqlite, "referral_programme_courses where course_id = 'course_syk_avx_001' and is_active = 1")).toBe(1);
    expect(row(fixture.sqlite, "select courses.id, courses.name, course_categories.name as category_name, duration_months, default_fee_paise, lowest_acceptable_fee_paise from courses join course_categories on course_categories.id = courses.category_id where courses.code = 'SYK-SFT-001'")).toMatchObject({
      id: "course_syk_sft_001",
      name: "SPOKEN ENGLISH",
      category_name: "Soft Skills",
      duration_months: 1.5,
      default_fee_paise: 700000,
      lowest_acceptable_fee_paise: 630000,
    });
    fixture.close();
  });

  it("excludes inactive and cross-organisation courses and never falls back to every course", async () => {
    const fixture = testFixture();
    seedCourse(fixture.sqlite, "course_future", "FUTURE", "Future Course", "active", "ccat_wdd");
    seedCourse(fixture.sqlite, "course_inactive", "INACTIVE", "Inactive Course", "inactive", "ccat_wdd");
    seedCourse(fixture.sqlite, "course_other_org", "OTHER", "Other Org Course", "active", "ccat_wdd", "org_other");
    addProgrammeCourse(fixture.sqlite, "course_inactive");
    addProgrammeCourse(fixture.sqlite, "course_other_org");

    const eligibleCodes = (await listEligibleReferralCourses(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", now: NOW })).map((course) => course.code);
    expect(eligibleCodes).toHaveLength(42);
    expect(eligibleCodes).not.toContain("FUTURE");
    expect(eligibleCodes).not.toContain("INACTIVE");
    expect(eligibleCodes).not.toContain("OTHER");
    fixture.close();
  });

  it("loads Education Partner public courses from active configured courses without programme mappings", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedEducationPartner(fixture.sqlite, { commissionBps: 1000 });
    expect(count(fixture.sqlite, "referral_programme_courses where referral_programme_id = 'rprog_samyak_education_partners'")).toBe(0);

    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_education_partners",
      referrerProfileId: "refprof_partner",
      loginAccountId: "acct_student",
      now: PARTNER_NOW,
    });
    if (!issued.rawToken) throw new Error("Expected partner token");

    fixture.sqlite.prepare(
      "insert into course_categories (id, organisation_id, code, name, sort_order, is_active, created_at, updated_at) values ('ccat_inactive_partner', 'org_samyak', 'INACTIVE-PARTNER', 'Inactive Partner Category', 999, 0, ?, ?)",
    ).run(NOW, NOW);
    seedCourse(fixture.sqlite, "course_partner_new", "PARTNER-NEW", "New Partner Course", "active", "ccat_wdd");
    addPartnerProgrammeCourse(fixture.sqlite, "course_partner_new");
    seedCourse(fixture.sqlite, "course_partner_auto", "PARTNER-AUTO", "Automatic Partner Course", "active", "ccat_wdd");
    seedCourse(fixture.sqlite, "course_partner_inactive", "PARTNER-INACTIVE", "Inactive Partner Course", "inactive", "ccat_wdd");
    seedCourse(fixture.sqlite, "course_partner_incomplete", "PARTNER-INCOMPLETE", "Incomplete Partner Course", "active", "ccat_wdd");
    seedCourse(fixture.sqlite, "course_partner_inactive_category", "PARTNER-INACTIVE-CAT", "Inactive Category Partner Course", "active", "ccat_inactive_partner");
    seedCourse(fixture.sqlite, "course_partner_other_org", "PARTNER-OTHER", "Other Org Partner Course", "active", "ccat_wdd", "org_other");
    fixture.sqlite.prepare("update courses set admission_configuration_complete = 0 where id = 'course_partner_incomplete'").run();

    const eligibleCodes = (await listEligibleReferralCourses(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_education_partners",
      now: PARTNER_NOW,
    })).map((course) => course.code);
    expect(eligibleCodes).toHaveLength(44);
    expect(eligibleCodes).toContain("SYK-WDD-001");
    expect(eligibleCodes).toContain("PARTNER-NEW");
    expect(eligibleCodes).toContain("PARTNER-AUTO");
    expect(eligibleCodes.filter((code) => code === "PARTNER-NEW")).toHaveLength(1);
    expect(eligibleCodes).not.toContain("PARTNER-INACTIVE");
    expect(eligibleCodes).not.toContain("PARTNER-INCOMPLETE");
    expect(eligibleCodes).not.toContain("PARTNER-INACTIVE-CAT");
    expect(eligibleCodes).not.toContain("PARTNER-OTHER");

    const app = publicReferralApp();
    const response = await app.request(
      `https://go.samyaksion.com/api/public/referrals/resolve/${issued.rawToken}/courses`,
      { headers: { Origin: "https://go.samyaksion.com" } },
      { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { categories: Array<{ courses: Array<{ id: string; code: string }> }> };
    const publicCourses = body.categories.flatMap((category) => category.courses);
    expect(publicCourses).toHaveLength(44);
    expect(publicCourses.map((course) => course.id)).toContain("course_partner_new");
    expect(publicCourses.map((course) => course.id)).toContain("course_partner_auto");
    expect(JSON.stringify(body)).not.toContain("default_fee_paise");
    expect(JSON.stringify(body)).not.toContain("partner_commission_basis_points");

    const submitted = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(issued.rawToken, {
      rawReferralToken: issued.rawToken,
      courseId: "course_partner_auto",
      prospectMobile: "9876543299",
      now: PARTNER_NOW,
    }));
    expect(submitted).toMatchObject({ ok: true });

    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(issued.rawToken, {
      rawReferralToken: issued.rawToken,
      courseId: "course_partner_inactive_category",
      prospectMobile: "9876543298",
      now: PARTNER_NOW,
    }))).toEqual({ ok: false, code: "ineligible_course" });

    fixture.sqlite.prepare("update courses set status = 'inactive' where id = 'course_partner_auto'").run();
    expect((await listEligibleReferralCourses(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_education_partners",
      now: PARTNER_NOW,
    })).map((course) => course.code)).not.toContain("PARTNER-AUTO");

    fixture.sqlite.prepare("update courses set status = 'active', admission_configuration_complete = 0 where id = 'course_partner_auto'").run();
    expect((await listEligibleReferralCourses(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_education_partners",
      now: PARTNER_NOW,
    })).map((course) => course.code)).not.toContain("PARTNER-AUTO");

    fixture.sqlite.prepare("update courses set admission_configuration_complete = 0 where id = 'course_partner_new'").run();
    expect((await listEligibleReferralCourses(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_education_partners",
      now: PARTNER_NOW,
    })).map((course) => course.code)).not.toContain("PARTNER-NEW");

    fixture.sqlite.prepare("update referral_programme_courses set is_active = 0 where referral_programme_id = 'rprog_samyak_education_partners' and course_id = 'course_partner_new'").run();
    expect((await listEligibleReferralCourses(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_education_partners",
      now: PARTNER_NOW,
    })).map((course) => course.code)).not.toContain("PARTNER-NEW");
    fixture.close();
  });

  it("groups eligible courses by active categories for the public API without pricing fields", async () => {
    const fixture = testFixture();
    const grouped = groupEligibleCourses(await listEligibleReferralCourses(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", now: NOW }));
    expect(grouped).toHaveLength(14);
    expect(grouped.flatMap((category) => category.courses)).toHaveLength(42);
    expect(grouped.find((category) => category.code === "DSAI")).toMatchObject({
      id: "ccat_dsai",
      name: "DATA SCIENCE & AI",
      courses: expect.arrayContaining([
        { id: "course_syk_dsai_003", code: "SYK-DSAI-003", name: "PYTHON - BEGINNER", durationMonths: 1 },
        { id: "course_syk_dsai_004", code: "SYK-DSAI-004", name: "PYTHON - ADVANCED", durationMonths: 2 },
      ]),
    });
    expect(grouped.find((category) => category.code === "CCC")).toMatchObject({
      courses: expect.arrayContaining([
        { id: "course_syk_ccc_001", code: "SYK-CCC-001", name: "CCC", durationMonths: 2 },
        { id: "course_syk_ccc_002", code: "SYK-CCC-002", name: "CCC+", durationMonths: 2 },
      ]),
    });
    expect(grouped.find((category) => category.code === "SFT")).toMatchObject({
      name: "Soft Skills",
      courses: [
        { id: "course_syk_sft_001", code: "SYK-SFT-001", name: "SPOKEN ENGLISH", durationMonths: 1.5 },
      ],
    });
    expect(JSON.stringify(grouped)).not.toContain("lowest_acceptable_fee_paise");
    expect(JSON.stringify(grouped)).not.toContain("default_fee_paise");
    fixture.close();
  });

  it("serves public referral HTTP resolve, courses, submission, CORS, and content-type safeguards", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      now: NOW,
    });
    if (!issued.rawToken) throw new Error("Expected raw token");
    const app = publicReferralApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };

    const validResolve = await app.request(
      `https://go.samyaksion.com/api/public/referrals/resolve/${issued.rawToken}`,
      { headers: { Origin: "https://go.samyaksion.com" } },
      workerEnv,
    );
    expect(validResolve.status).toBe(200);
    expect(validResolve.headers.get("Cache-Control")).toBe("no-store");
    await expect(validResolve.json()).resolves.toMatchObject({
      success: true,
      valid: true,
      programme: { name: "Samyak Skill Circle" },
      referrer: { displayName: "Student Referrer" },
    });

    const courseResponse = await app.request(
      `https://go.samyaksion.com/api/public/referrals/resolve/${issued.rawToken}/courses`,
      { headers: { Origin: "https://go.samyaksion.com" } },
      workerEnv,
    );
    const courseBody = await courseResponse.json() as { categories: Array<{ courses: Array<{ id: string; code: string }> }> };
    expect(courseResponse.status).toBe(200);
    expect(courseBody.categories.flatMap((category) => category.courses)).toHaveLength(42);
    expect(courseBody.categories.flatMap((category) => category.courses).map((course) => course.id)).toContain("course_syk_wdd_001");
    expect(JSON.stringify(courseBody)).not.toContain("default_fee_paise");

    expect((await app.request(
      `https://evil.test/api/public/referrals/resolve/${issued.rawToken}`,
      { headers: { Origin: "https://evil.test" } },
      workerEnv,
    )).status).toBe(403);
    expect((await app.request(
      "https://go.samyaksion.com/api/public/referrals/resolve/not-a-valid-token",
      { headers: { Origin: "http://localhost:5173" } },
      { ...workerEnv, ENVIRONMENT: "production" },
    )).status).toBe(403);
    expect((await app.request(
      "https://go.samyaksion.com/api/public/referrals/resolve/not-a-valid-token",
      { headers: { Origin: "https://feature-123.pages.dev" } },
      { ...workerEnv, ENVIRONMENT: "production" },
    )).status).toBe(403);
    expect((await app.request(
      "https://go.samyaksion.com/api/public/referrals/resolve/not-a-valid-token",
      { headers: { Origin: "http://localhost:5173" } },
      { ...workerEnv, ENVIRONMENT: "development" },
    )).status).toBe(404);
    expect((await app.request(
      "https://go.samyaksion.com/api/public/referrals/resolve/not-a-valid-token",
      { headers: { Origin: "https://staging-go.samyaksion.com" } },
      { ...workerEnv, ENVIRONMENT: "staging", REFERRAL_PUBLIC_ALLOWED_ORIGINS: "https://staging-go.samyaksion.com" },
    )).status).toBe(404);
    expect((await app.request(
      "https://go.samyaksion.com/api/public/referrals/resolve/not-a-valid-token",
      { headers: { Origin: "https://other-staging.samyaksion.com" } },
      { ...workerEnv, ENVIRONMENT: "staging", REFERRAL_PUBLIC_ALLOWED_ORIGINS: "https://staging-go.samyaksion.com" },
    )).status).toBe(403);
    expect((await app.request(
      "https://go.samyaksion.com/api/public/referrals/resolve/bad",
      { headers: { Origin: "https://go.samyaksion.com" } },
      workerEnv,
    )).status).toBe(404);

    for (let index = 0; index < 58; index += 1) {
      expect((await app.request(
        `https://go.samyaksion.com/api/public/referrals/resolve/${issued.rawToken}`,
        { headers: { Origin: "https://go.samyaksion.com" } },
        workerEnv,
      )).status).toBe(200);
    }
    const resolveLimited = await app.request(
      `https://go.samyaksion.com/api/public/referrals/resolve/${issued.rawToken}/courses`,
      { headers: { Origin: "https://go.samyaksion.com" } },
      workerEnv,
    );
    expect(resolveLimited.status).toBe(429);
    expect(resolveLimited.headers.get("Retry-After")).toBe(String(RESOLVE_LIMIT_WINDOW_SECONDS));

    const invalidContentType = await app.request(
      "https://go.samyaksion.com/api/public/referrals/submit",
      { method: "POST", headers: { Origin: "https://go.samyaksion.com", "Content-Type": "text/plain" }, body: "{}" },
      workerEnv,
    );
    expect(invalidContentType.status).toBe(415);

    const created = await app.request(
      "https://go.samyaksion.com/api/public/referrals/submit",
      {
        method: "POST",
        headers: { Origin: "https://go.samyaksion.com", "Content-Type": "application/json", "Idempotency-Key": "http-idem-1" },
        body: JSON.stringify({
          token: issued.rawToken,
          name: "  Future   Learner  ",
          mobile: "9876543210",
          email: "learner@example.com",
          courseId: "course_syk_wdd_001",
          consent: true,
        }),
      },
      workerEnv,
    );
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ success: true, idempotent: false });
    expect(row(fixture.sqlite, "select prospect_name, prospect_person_id, course_interest_id from referrals")).toMatchObject({
      prospect_name: "Future Learner",
      prospect_person_id: null,
      course_interest_id: "course_syk_wdd_001",
    });
    expect(count(fixture.sqlite, "referral_status_events")).toBe(1);
    expect(count(fixture.sqlite, "people")).toBe(1);

    const replay = await app.request(
      "https://go.samyaksion.com/api/public/referrals/submit",
      {
        method: "POST",
        headers: { Origin: "https://go.samyaksion.com", "Content-Type": "application/json", "Idempotency-Key": "http-idem-1" },
        body: JSON.stringify({ token: issued.rawToken, name: "Future Learner", mobile: "9876543210", email: "learner@example.com", courseId: "course_syk_wdd_001", consent: true }),
      },
      workerEnv,
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ success: true, idempotent: true });
    expect(count(fixture.sqlite, "referrals")).toBe(1);
    expect(JSON.stringify(all(fixture.sqlite, "select * from auth_events"))).not.toContain("9876543210");
    fixture.close();
  });

  it("reports dashboard totals across all referrals independently of pagination", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");

    for (let index = 0; index < 30; index += 1) {
      const status = index % 5 === 0 ? "converted" : "accepted";
      seedDashboardReferral(fixture.sqlite, index, status);
      if (status === "converted") seedRewardSnapshot(fixture.sqlite, index);
    }

    const app = studentRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };
    const firstPage = await app.request(
      "https://portal.samyaksion.com/api/student/referrals?limit=20&offset=0",
      { headers: { Cookie: sessionCookie } },
      workerEnv,
    );
    const secondPage = await app.request(
      "https://portal.samyaksion.com/api/student/referrals?limit=20&offset=20",
      { headers: { Cookie: sessionCookie } },
      workerEnv,
    );
    const firstBody = await firstPage.json() as {
      summary: { totalReferrals: number; successfulAdmissions: number; cashRewardsEarned: number; courseCreditEarned: number };
      pagination: { limit: number; offset: number; hasMore: boolean };
      referrals: Array<{ referralId: string }>;
    };
    const secondBody = await secondPage.json() as typeof firstBody;

    expect(firstPage.status).toBe(200);
    expect(secondPage.status).toBe(200);
    expect(firstBody.summary).toEqual({
      totalReferrals: 30,
      successfulAdmissions: 6,
      cashRewardsEarned: 600,
      courseCreditEarned: 300,
    });
    expect(secondBody.summary).toEqual(firstBody.summary);
    expect(firstBody.referrals).toHaveLength(20);
    expect(firstBody.pagination).toEqual({ limit: 20, offset: 0, hasMore: true });
    expect(secondBody.referrals).toHaveLength(10);
    expect(secondBody.pagination).toEqual({ limit: 20, offset: 20, hasMore: false });
    expect(firstBody.referrals[0].referralId).toBe("referral_29");
    expect(secondBody.referrals[0].referralId).toBe("referral_09");
    fixture.close();
  });

  it("serves staff referral operations with RBAC, pagination, filters, and authorized prospect contact actions", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    seedStaffRole(fixture.sqlite, "acct_student", "counsellor", "branch_sion");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");

    for (let index = 0; index < 5; index += 1) {
      seedDashboardReferral(fixture.sqlite, index, index % 2 === 0 ? "converted" : "accepted");
      if (index % 2 === 0) seedRewardSnapshot(fixture.sqlite, index);
    }
    await attachSubmittedMobile(fixture.sqlite, "referral_04", "9876543210");
    const other = "2026-08-12T10:00:00.000Z";
    fixture.sqlite.prepare(
      `insert into referrals
        (id, organisation_id, branch_id, referral_programme_id, referral_link_id, referrer_profile_id,
         prospect_person_id, enquiry_id, course_interest_id, source, status, submitted_at, valid_until,
         attributed_at, prospect_mobile_hash, prospect_mobile_last_four, prospect_name, created_at, updated_at)
       values ('referral_other_org', 'org_other', 'branch_other', 'rprog_samyak_skill_circle', null, 'refprof_student',
         null, null, 'course_fsd', 'personal_link', 'accepted', ?, '2026-12-31T10:00:00.000Z',
         ?, 'other_hash', '9999', 'Other Prospect', ?, ?)`,
    ).run(other, other, other, other);

    const app = staffReferralRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };
    const firstPage = await app.request("https://portal.samyaksion.com/api/staff/referrals?limit=2&offset=0", { headers: { Cookie: sessionCookie } }, workerEnv);
    const filtered = await app.request("https://portal.samyaksion.com/api/staff/referrals?status=converted&rewardStatus=approved", { headers: { Cookie: sessionCookie } }, workerEnv);
    fixture.sqlite.prepare("delete from login_account_roles where login_account_id = 'acct_student'").run();
    const denied = await app.request("https://portal.samyaksion.com/api/staff/referrals", { headers: { Cookie: sessionCookie } }, workerEnv);

    expect(firstPage.status).toBe(200);
    const body = await firstPage.json() as { pagination: { total: number; hasMore: boolean }; referrals: Array<Record<string, unknown>> };
    expect(body.pagination).toMatchObject({ total: 5, hasMore: true });
    expect(body.referrals).toHaveLength(2);
    expect(body.referrals[0]).toMatchObject({
      referralId: "referral_04",
      prospectContact: {
        mobile: "9876543210",
        mobileDisplay: "+91 98765 43210",
        callUrl: "tel:+919876543210",
      },
    });
    expect(String((body.referrals[0].prospectContact as { whatsappUrl: string }).whatsappUrl)).toContain("https://wa.me/919876543210?text=");
    const decodedDraft = decodeURIComponent(String((body.referrals[0].prospectContact as { whatsappUrl: string }).whatsappUrl));
    expect(decodedDraft).toContain("Full Stack course through a referral");
    expect(decodedDraft).not.toContain("referral_04");
    expect(decodedDraft).not.toContain("Student Referrer");
    expect(JSON.stringify(body)).not.toContain("learner@example.com");
    expect(JSON.stringify(body)).not.toContain("mobile_hash_04");
    expect(JSON.stringify(body)).not.toContain("ciphertext");
    expect(JSON.stringify(body)).not.toContain("referral_other_org");

    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json() as { referrals: Array<{ referralStatus: string; qualificationState: string; reward: unknown }> };
    expect(filteredBody.referrals.length).toBeGreaterThan(0);
    expect(filteredBody.referrals.every((item) => item.referralStatus === "converted" && item.qualificationState === "approved" && item.reward !== null)).toBe(true);
    expect(denied.status).toBe(403);
    fixture.close();
  });

  it("returns owner-authorized detail contact from linked Person mobile before referral submission fallback", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    seedDashboardReferral(fixture.sqlite, 0, "accepted");
    await attachSubmittedMobile(fixture.sqlite, "referral_00", "9876543210");
    await attachLinkedProspectContact(fixture.sqlite, "referral_00", "9876501111");
    seedStaffRole(fixture.sqlite, "acct_student", "owner");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const app = staffReferralRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };

    const detail = await app.request("https://portal.samyaksion.com/api/staff/referrals/referral_00", { headers: { Cookie: sessionCookie } }, workerEnv);
    expect(detail.status).toBe(200);
    const body = await detail.json() as { referral: { prospectContact: { mobile: string; mobileDisplay: string; whatsappUrl: string; callUrl: string } } };
    expect(body.referral.prospectContact).toMatchObject({
      mobile: "9876501111",
      mobileDisplay: "+91 98765 01111",
      callUrl: "tel:+919876501111",
    });
    expect(body.referral.prospectContact.whatsappUrl).toContain("https://wa.me/919876501111?text=");
    expect(JSON.stringify(body)).not.toContain("9876543210");
    expect(JSON.stringify(body)).not.toContain("contact_prospect");
    fixture.close();
  });

  it("handles missing staff referral contact and keeps public/referrer surfaces private", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    seedDashboardReferral(fixture.sqlite, 0, "accepted");
    seedStaffRole(fixture.sqlite, "acct_student", "counsellor", "branch_sion");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const staffApp = staffReferralRouteApp();
    const publicApp = publicReferralApp();
    const studentApp = studentRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };

    const list = await staffApp.request("https://portal.samyaksion.com/api/staff/referrals", { headers: { Cookie: sessionCookie } }, workerEnv);
    const listBody = await list.json() as { referrals: Array<{ prospectContact: Record<string, string | null> }> };
    expect(listBody.referrals[0].prospectContact).toEqual({ mobile: null, mobileDisplay: null, whatsappUrl: null, callUrl: null });

    const issued = await issueReferralLink(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", referrerProfileId: "refprof_student", loginAccountId: "acct_student", personId: "person_student", now: NOW });
    const resolved = await publicApp.request(`https://go.samyaksion.com/api/public/referrals/resolve/${issued.rawToken}`, { headers: { Origin: "https://go.samyaksion.com" } }, workerEnv);
    const submitted = await publicApp.request("https://go.samyaksion.com/api/public/referrals/submit", {
      method: "POST",
      headers: { Origin: "https://go.samyaksion.com", "Content-Type": "application/json", "Idempotency-Key": "public-privacy" },
      body: JSON.stringify({ token: issued.rawToken, name: "Future Learner", mobile: "9876543210", courseId: "course_fsd", consent: true }),
    }, workerEnv);
    const referrerDashboard = await studentApp.request("https://portal.samyaksion.com/api/student/referrals", { headers: { Cookie: sessionCookie } }, workerEnv);
    expect(JSON.stringify(await resolved.json())).not.toContain("9876543210");
    expect(JSON.stringify(await submitted.json())).not.toContain("9876543210");
    expect(JSON.stringify(await referrerDashboard.json())).not.toContain("9876543210");
    fixture.close();
  });

  it("keeps admitted referral validity separate from missing payment qualification", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    seedDashboardReferral(fixture.sqlite, 0, "converted");
    seedDashboardReferral(fixture.sqlite, 1, "converted");
    seedRewardSnapshot(fixture.sqlite, 0);
    seedAdmittedOperationReferral(fixture.sqlite, 0, {
      submittedAt: "2025-01-01T10:00:00.000Z",
      validUntil: "2025-04-01T10:00:00.000Z",
      admissionDate: "2025-03-12T10:00:00.000Z",
    });
    seedAdmittedOperationReferral(fixture.sqlite, 1, {
      submittedAt: "2025-01-01T10:00:00.000Z",
      validUntil: "2025-04-01T10:00:00.000Z",
      admissionDate: "2025-04-02T10:00:00.000Z",
    });
    seedStaffRole(fixture.sqlite, "acct_student", "owner");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const app = staffReferralRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };

    const validAdmission = await app.request("https://portal.samyaksion.com/api/staff/referrals/referral_00", { headers: { Cookie: sessionCookie } }, workerEnv);
    const lateAdmission = await app.request("https://portal.samyaksion.com/api/staff/referrals/referral_01", { headers: { Cookie: sessionCookie } }, workerEnv);

    expect(validAdmission.status).toBe(200);
    expect(lateAdmission.status).toBe(200);
    const validBody = await validAdmission.json() as { referral: { validityState: string; admissionStatus: string; qualificationState: string; rewardStatus: string; fee: { finalAgreedFeePaise: number; receivedAmountPaise: number; receivedAmountAvailable: boolean } | null; reward: unknown; linkedEnrolment: { studentNumber: string; enrolmentNumber: string; admissionDate: string; joiningDate: string } | null } };
    const lateBody = await lateAdmission.json() as { referral: { validityState: string; admissionStatus: string; qualificationState: string } };
    expect(validBody.referral.validityState).toBe("valid_admission");
    expect(validBody.referral.admissionStatus).toBe("done");
    expect(validBody.referral.qualificationState).toBe("approved");
    expect(validBody.referral.rewardStatus).toBe("Approved");
    expect(validBody.referral.linkedEnrolment).toMatchObject({ studentNumber: "STU-REWARD-00", enrolmentNumber: "ENR-00", admissionDate: "2025-03-12T10:00:00.000Z", joiningDate: "2025-03-12T10:00:00.000Z" });
    expect(validBody.referral.fee).toMatchObject({ finalAgreedFeePaise: 900000, receivedAmountPaise: 0, receivedAmountAvailable: true });
    expect(validBody.referral.reward).toMatchObject({ cashRewardPaise: 10000, status: "approved" });
    expect(JSON.stringify(validBody)).not.toContain("qualified_pending_approval");
    expect(lateBody.referral.validityState).toBe("admission_after_expiry");
    expect(lateBody.referral.admissionStatus).toBe("outside_validity");
    expect(lateBody.referral.qualificationState).toBe("admission_outside_validity");
    fixture.close();
  });

  it("approves and pays referral rewards from canonical admission, fee and receipt data", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    seedDashboardReferral(fixture.sqlite, 0, "converted");
    seedDashboardReferral(fixture.sqlite, 1, "converted");
    seedAdmittedOperationReferral(fixture.sqlite, 0, {
      submittedAt: "2025-01-01T10:00:00.000Z",
      validUntil: "2025-04-01T10:00:00.000Z",
      admissionDate: "2025-03-12T10:00:00.000Z",
    });
    seedAdmittedOperationReferral(fixture.sqlite, 1, {
      submittedAt: "2025-01-01T10:00:00.000Z",
      validUntil: "2025-04-01T10:00:00.000Z",
      admissionDate: "2025-03-12T10:00:00.000Z",
    });
    fixture.sqlite.prepare("update enrolments set status = 'confirmed' where id in ('enrolment_00', 'enrolment_01')").run();
    addReceipt(fixture.sqlite, 0, 450000);
    seedStaffRole(fixture.sqlite, "acct_student", "counsellor", "branch_sion");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const app = staffReferralRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };

    const qualified = await app.request("https://portal.samyaksion.com/api/staff/referrals/referral_00", { headers: { Cookie: sessionCookie } }, workerEnv);
    expect(qualified.status).toBe(200);
    expect(await qualified.json()).toMatchObject({ referral: { qualificationState: "qualified", reward: { cashRewardPaise: 50000, courseCreditPaise: 75000 } } });

    const denied = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/reward/approve",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie } },
      workerEnv,
    );
    expect(denied.status).toBe(403);
    fixture.sqlite.prepare("delete from login_account_roles where login_account_id = 'acct_student'").run();
    seedStaffRole(fixture.sqlite, "acct_student", "owner");

    const [approval, approvalReplay] = await Promise.all([0, 1].map(() => app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/reward/approve",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie } },
      workerEnv,
    )));
    expect(approval.status).toBe(200);
    expect(approvalReplay.status).toBe(200);
    const approvalBodies = await Promise.all([approval.json(), approvalReplay.json()]) as Array<{ idempotent: boolean; qualificationState: string; reward: { cashRewardPaise: number; status: string } }>;
    expect(approvalBodies.every((body) => body.qualificationState === "approved" && body.reward.cashRewardPaise === 50000 && body.reward.status === "approved")).toBe(true);
    expect(approvalBodies.filter((body) => body.idempotent).length).toBe(1);
    expect(count(fixture.sqlite, "referral_reward_snapshots")).toBe(1);
    expect(count(fixture.sqlite, "audit_logs where action = 'referral_reward_approved'")).toBe(1);

    fixture.sqlite.prepare("delete from login_account_roles where login_account_id = 'acct_student'").run();
    seedStaffRole(fixture.sqlite, "acct_student", "counsellor", "branch_sion");
    const nonOwnerPayout = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/reward/payout",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ paymentDate: "2025-03-15", paymentMode: "cash", idempotencyKey: "non-owner-cash-1" }) },
      workerEnv,
    );
    expect(nonOwnerPayout.status).toBe(403);
    fixture.sqlite.prepare("delete from login_account_roles where login_account_id = 'acct_student'").run();
    seedStaffRole(fixture.sqlite, "acct_student", "owner");

    const unapprovedPayout = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_01/reward/payout",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ paymentDate: "2025-03-15", paymentMode: "cash", idempotencyKey: "unapproved-cash-1" }) },
      workerEnv,
    );
    expect(unapprovedPayout.status).toBe(409);

    const futurePayout = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/reward/payout",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ paymentDate: "2999-03-15", paymentMode: "cash", idempotencyKey: "future-cash-1" }) },
      workerEnv,
    );
    expect(futurePayout.status).toBe(400);

    const payoutBody = { paymentDate: "2025-03-15", paymentMode: "upi", paymentReference: "UPI-123", notes: "paid privately", idempotencyKey: "reward-pay-1" };
    const [payout, payoutReplay] = await Promise.all([0, 1].map(() => app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/reward/payout",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify(payoutBody) },
      workerEnv,
    )));
    const payoutConflict = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/reward/payout",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ ...payoutBody, paymentReference: "UPI-999" }) },
      workerEnv,
    );
    const paidAgainWithFreshKey = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/reward/payout",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ paymentDate: "2025-03-15", paymentMode: "cash", idempotencyKey: "fresh-paid-key" }) },
      workerEnv,
    );
    expect(payout.status).toBe(200);
    expect(payoutReplay.status).toBe(200);
    const payoutBodies = await Promise.all([payout.json(), payoutReplay.json()]) as Array<{ idempotent: boolean; qualificationState: string; payout: { amountPaise: number; paymentMode: string } }>;
    expect(payoutBodies.every((body) => body.qualificationState === "paid" && body.payout.amountPaise === 50000 && body.payout.paymentMode === "upi")).toBe(true);
    expect(payoutBodies.filter((body) => body.idempotent).length).toBe(1);
    expect(payoutConflict.status).toBe(409);
    expect(paidAgainWithFreshKey.status).toBe(409);
    expect(count(fixture.sqlite, "referral_reward_payouts")).toBe(1);
    const paidAudit = row(fixture.sqlite, "select metadata_json from audit_logs where action = 'referral_reward_paid' limit 1");
    expect(String(paidAudit?.metadata_json || "")).toContain('"amountPaise":50000');
    expect(String(paidAudit?.metadata_json || "")).not.toContain("UPI-123");
    expect(String(paidAudit?.metadata_json || "")).not.toContain("paid privately");
    fixture.close();
  });

  it("derives reward slabs, validity boundaries and receipt thresholds from canonical facts", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    for (let index = 0; index < 7; index += 1) {
      seedDashboardReferral(fixture.sqlite, index, "converted");
      seedAdmittedOperationReferral(fixture.sqlite, index, {
        submittedAt: "2025-01-01T10:00:00.000Z",
        validUntil: "2025-04-01T10:00:00.000Z",
        admissionDate: index === 5 ? "2025-04-01T10:00:00.000Z" : index === 6 ? "2025-04-01T10:00:01.000Z" : "2025-03-31T10:00:00.000Z",
      });
    }
    fixture.sqlite.prepare("update enrolments set status = 'confirmed'").run();
    const fees = [999999, 1000000, 2000000, 3000000, 10001, 900000, 900000];
    for (let index = 0; index < fees.length; index += 1) {
      const suffix = String(index).padStart(2, "0");
      fixture.sqlite.prepare("update fee_agreements set final_agreed_fee_paise = ? where id = ?").run(fees[index], `fee_${suffix}`);
    }
    addReceipt(fixture.sqlite, 0, 500000);
    addReceipt(fixture.sqlite, 1, 500000);
    addReceipt(fixture.sqlite, 2, 1000000);
    addReceipt(fixture.sqlite, 3, 1500000);
    addReceipt(fixture.sqlite, 4, 5000);
    addReceipt(fixture.sqlite, 5, 450000, "2025-05-01T10:00:00.000Z");
    addReceipt(fixture.sqlite, 6, 450000);
    addReceipt(fixture.sqlite, 1, 999999, "2025-03-15T11:00:00.000Z", "wrong-student");
    fixture.sqlite.prepare("update receipts set enrolment_id = 'enrolment_00', fee_agreement_id = 'fee_00' where id = 'receipt_01_wrong-student'").run();
    seedStaffRole(fixture.sqlite, "acct_student", "owner");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const app = staffReferralRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };

    const detailResponses = [0, 1, 2, 3, 4, 5, 6].map((index) =>
      app.request(`https://portal.samyaksion.com/api/staff/referrals/referral_${String(index).padStart(2, "0")}`, { headers: { Cookie: sessionCookie } }, workerEnv),
    );
    const details = await Promise.all((await Promise.all(detailResponses)).map((response) => response.json())) as Array<{ referral: { qualificationState: string; reward: { cashRewardPaise: number; courseCreditPaise: number } | null; fee: { minimumQualifyingPaymentPaise: number; receivedAmountPaise: number } } }>;

    expect(details[0].referral).toMatchObject({ qualificationState: "qualified", reward: { cashRewardPaise: 50000, courseCreditPaise: 75000 } });
    expect(details[1].referral).toMatchObject({ qualificationState: "qualified", reward: { cashRewardPaise: 75000, courseCreditPaise: 100000 } });
    expect(details[2].referral).toMatchObject({ qualificationState: "qualified", reward: { cashRewardPaise: 100000, courseCreditPaise: 150000 } });
    expect(details[3].referral).toMatchObject({ qualificationState: "qualified", reward: { cashRewardPaise: 150000, courseCreditPaise: 200000 } });
    expect(details[4].referral).toMatchObject({ qualificationState: "awaiting_payment", fee: { minimumQualifyingPaymentPaise: 5001, receivedAmountPaise: 5000 } });
    expect(details[5].referral).toMatchObject({ qualificationState: "qualified", fee: { receivedAmountPaise: 450000 } });
    expect(details[6].referral).toMatchObject({ qualificationState: "admission_outside_validity" });
    expect(details[1].referral.fee.receivedAmountPaise).toBe(500000);
    addReceipt(fixture.sqlite, 4, 1, "2025-03-15T12:00:00.000Z", "plus-one");
    const thresholdExact = await app.request("https://portal.samyaksion.com/api/staff/referrals/referral_04", { headers: { Cookie: sessionCookie } }, workerEnv);
    expect(await thresholdExact.json()).toMatchObject({ referral: { qualificationState: "qualified", fee: { minimumQualifyingPaymentPaise: 5001, receivedAmountPaise: 5001 } } });
    fixture.close();
  });

  it("enforces reward and payout uniqueness at the database layer", () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    seedDashboardReferral(fixture.sqlite, 0, "converted");
    seedRewardSnapshot(fixture.sqlite, 0);
    expect(() =>
      fixture.sqlite.prepare(
        `insert into referral_reward_snapshots
          (id, referral_id, enrolment_id, fee_agreement_id, reward_rule_set_id, slab_id,
           final_agreed_fee_paise, minimum_fee_percentage, minimum_qualifying_payment_paise,
           cash_reward_paise, course_credit_paise, snapshot_version, snapshot_json, created_at)
         values ('reward_duplicate', 'referral_00', 'enrolment_00', 'fee_00', 'rrs_samyak_skill_circle_v1', null,
           900000, 50, 450000, 50000, 75000, 1, '{}', ?)`,
      ).run(NOW),
    ).toThrow();
    fixture.sqlite.prepare(
      `insert into referral_reward_payouts
        (id, organisation_id, branch_id, reward_snapshot_id, referral_id, amount_paise,
         payment_date, payment_mode, status, paid_by_login_account_id, idempotency_key,
         payload_fingerprint, created_at, updated_at)
       values ('payout_1', 'org_samyak', 'branch_sion', 'reward_00', 'referral_00', 50000,
         ?, 'cash', 'paid', 'acct_student', 'payout-key-1', 'fp-1', ?, ?)`,
    ).run(NOW, NOW, NOW);
    expect(() =>
      fixture.sqlite.prepare(
        `insert into referral_reward_payouts
          (id, organisation_id, branch_id, reward_snapshot_id, referral_id, amount_paise,
           payment_date, payment_mode, status, paid_by_login_account_id, idempotency_key,
           payload_fingerprint, created_at, updated_at)
         values ('payout_2', 'org_samyak', 'branch_sion', 'reward_00', 'referral_00', 50000,
           ?, 'cash', 'paid', 'acct_student', 'payout-key-2', 'fp-2', ?, ?)`,
      ).run(NOW, NOW, NOW),
    ).toThrow();
    fixture.close();
  });

  it("lets owner inherit referral operations detail and only allows administrative closure status transitions", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    seedDashboardReferral(fixture.sqlite, 0, "accepted");
    seedStaffRole(fixture.sqlite, "acct_student", "owner");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const app = staffReferralRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };

    const detail = await app.request("https://portal.samyaksion.com/api/staff/referrals/referral_00", { headers: { Cookie: sessionCookie } }, workerEnv);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as { referral: { qualificationState: string; rewardSlabs: unknown[]; linkedEnquiry: unknown } };
    expect(detailBody.referral.qualificationState).toBe("awaiting_admission");
    expect(detailBody.referral.rewardSlabs.length).toBe(4);
    expect(detailBody.referral.linkedEnquiry).toBeNull();

    const crmLikeTransition = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/status",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ status: "active", note: "Counselling started" }) },
      workerEnv,
    );
    expect(crmLikeTransition.status).toBe(400);
    expect(row(fixture.sqlite, "select status from referrals where id = 'referral_00'")).toMatchObject({ status: "accepted" });

    const updated = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/status",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ status: "closed", note: "Administrative closure" }) },
      workerEnv,
    );
    expect(updated.status).toBe(200);
    expect(row(fixture.sqlite, "select status from referrals where id = 'referral_00'")).toMatchObject({ status: "closed" });
    expect(row(fixture.sqlite, "select from_status, to_status, event_type, internal_note from referral_status_events where referral_id = 'referral_00' order by created_at desc limit 1")).toMatchObject({
      from_status: "accepted",
      to_status: "closed",
      event_type: "staff_admin_closure",
      internal_note: "Administrative closure",
    });
    expect(count(fixture.sqlite, "audit_logs where action = 'referral_status_updated'")).toBe(1);

    const invalid = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/status",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ status: "submitted" }) },
      workerEnv,
    );
    expect(invalid.status).toBe(400);
    const manualConverted = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/status",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ status: "converted" }) },
      workerEnv,
    );
    const computedState = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/status",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ status: "qualified_pending_approval" }) },
      workerEnv,
    );
    const ownerPayoutBypass = await app.request(
      "https://portal.samyaksion.com/api/staff/referrals/referral_00/status",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie, "Content-Type": "application/json" }, body: JSON.stringify({ status: "fulfilled" }) },
      workerEnv,
    );
    expect(manualConverted.status).toBe(400);
    expect(computedState.status).toBe(400);
    expect(ownerPayoutBypass.status).toBe(400);
    fixture.close();
  });

  it("serves authenticated referral-link generation, encrypted recovery reload, and denies self-service rotation", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const app = studentRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };

    const generated = await app.request(
      "https://portal.samyaksion.com/api/referrals/link",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie } },
      workerEnv,
    );
    expect(generated.status).toBe(201);
    const generatedBody = await generated.json() as { created: true; link: string; lastFour: string };
    expect(generatedBody).toMatchObject({ created: true, shownOnce: true });
    expect(generatedBody.link).toMatch(/^https:\/\/go\.samyaksion\.com\/r\/[A-Za-z0-9_-]{43}$/);
    const oldToken = generatedBody.link.split("/").at(-1)!;
    expect(row(fixture.sqlite, "select token_hash, token_last_four from referral_links")).toMatchObject({
      token_hash: await hashReferralToken(oldToken, TEST_REFERRAL_TOKEN_PEPPER),
      token_last_four: generatedBody.lastFour,
    });
    expect(JSON.stringify(all(fixture.sqlite, "select * from referral_links"))).not.toContain(oldToken);
    expect(count(fixture.sqlite, "referral_link_secrets")).toBe(1);

    const existing = await app.request(
      "https://portal.samyaksion.com/api/referrals/link",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie } },
      workerEnv,
    );
    expect(existing.status).toBe(200);
    await expect(existing.json()).resolves.toMatchObject({ created: false, hasActiveLink: true, lastFour: generatedBody.lastFour });

    const dashboard = await app.request(
      "https://portal.samyaksion.com/api/student/referrals",
      { headers: { Cookie: sessionCookie } },
      workerEnv,
    );
    expect(dashboard.status).toBe(200);
    const dashboardBody = await dashboard.json() as { linkStatus: { hasActiveLink: boolean; lastFour: string; publicUrl: string; recoverable: boolean; canRotate: boolean }; profile: { personalLink: string } };
    expect(dashboardBody.linkStatus).toMatchObject({
      hasActiveLink: true,
      lastFour: generatedBody.lastFour,
      publicUrl: generatedBody.link,
      recoverable: true,
      canRotate: false,
    });
    expect(dashboardBody.profile.personalLink).toBe("");
    expect(JSON.stringify(dashboardBody)).not.toContain("token_hash");
    expect(JSON.stringify(dashboardBody)).not.toContain("token_ciphertext");

    const csrf = await app.request(
      "https://portal.samyaksion.com/api/referrals/link/rotate",
      { method: "POST", headers: { Origin: "https://evil.test", Cookie: sessionCookie } },
      workerEnv,
    );
    expect(csrf.status).toBe(403);

    const denied = await app.request(
      "https://portal.samyaksion.com/api/referrals/link/rotate",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie } },
      workerEnv,
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ success: false, error: { code: "self_rotation_disabled" } });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: oldToken, now: NOW })).toMatchObject({ valid: true });
    expect(count(fixture.sqlite, "referral_links where status = 'active'")).toBe(1);
    expect(count(fixture.sqlite, "referral_links where status = 'revoked'")).toBe(0);
    const auditJson = JSON.stringify(all(fixture.sqlite, "select action, metadata_json from audit_logs"));
    expect(auditJson).not.toContain(oldToken);
    expect(auditJson).not.toContain("/r/");
    fixture.close();
  });

  it("lets owners replace student referral links while denying non-owner staff", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    fixture.sqlite.prepare(
      `insert into students
        (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since,
         current_status, portal_status, created_at, updated_at)
       values ('student_route_owner', 'org_samyak', 'person_student', 'branch_sion', 'SYK-SION-9999', 9999,
        '2026-01-01', 'active', 'active', ?, ?)`,
    ).run(NOW, NOW);
    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_skill_circle",
      referrerProfileId: "refprof_student",
      loginAccountId: "acct_student",
      personId: "person_student",
      now: NOW,
    });
    if (!issued.rawToken) throw new Error("Expected student token");
    seedReferrer(fixture.sqlite, { suffix: "staff" });
    seedStaffRole(fixture.sqlite, "acct_staff", "counsellor", "branch_sion");
    const staffCookie = await seedSession(fixture.sqlite, "acct_staff", "person_staff", "sess_staff_owner_route", "staff-owner-route-token");
    const app = staffAdmissionRouteApp();
    const workerEnv = { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER };

    const denied = await app.request(
      "https://portal.samyaksion.com/api/staff/students/student_route_owner/referral-link/replace",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: staffCookie } },
      workerEnv,
    );
    expect(denied.status).toBe(403);

    seedStaffRole(fixture.sqlite, "acct_student", "owner", "branch_sion");
    const ownerCookie = await seedSession(fixture.sqlite, "acct_student", "person_student", "sess_owner_route", "owner-route-token");
    const replaced = await app.request(
      "https://portal.samyaksion.com/api/staff/students/student_route_owner/referral-link/replace",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: ownerCookie } },
      workerEnv,
    );
    expect(replaced.status).toBe(201);
    const replacedBody = await replaced.json() as { link: string; previousLinkId: string };
    const newToken = replacedBody.link.split("/").at(-1)!;
    expect(replacedBody.previousLinkId).toBe(issued.link.id);
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: issued.rawToken, now: NOW })).toEqual({ valid: false, reason: "invalid_link" });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: newToken, now: NOW })).toMatchObject({ valid: true });
    expect(count(fixture.sqlite, "referral_links where status = 'active'")).toBe(1);
    expect(count(fixture.sqlite, "referral_links where status = 'revoked'")).toBe(1);
    expect(count(fixture.sqlite, "referral_link_secrets")).toBe(2);
    const profile = await app.request(
      "https://portal.samyaksion.com/api/staff/students/student_route_owner",
      { headers: { Cookie: ownerCookie } },
      workerEnv,
    );
    expect(profile.status).toBe(200);
    await expect(profile.json()).resolves.toMatchObject({
      canReplaceReferralLink: true,
      referralLink: {
        hasActiveLink: true,
        publicUrl: replacedBody.link,
        recoverable: true,
      },
    });
    fixture.close();
  });

  it("returns recoverable education partner active links to owners after reload", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedStaffRole(fixture.sqlite, "acct_student", "owner");
    seedEducationPartner(fixture.sqlite, { commissionBps: 1000 });
    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_education_partners",
      referrerProfileId: "refprof_partner",
      loginAccountId: "acct_student",
      now: PARTNER_NOW,
    });
    if (!issued.rawToken) throw new Error("Expected partner token");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const app = staffEducationPartnerRouteApp();

    const response = await app.request(
      "https://portal.samyaksion.com/api/staff/education-partners/epartner_one",
      { headers: { Cookie: sessionCookie } },
      { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { partner: { activeLink: { publicUrl: string; recoverable: boolean; lastFour: string } } };

    expect(body.partner.activeLink).toMatchObject({
      publicUrl: `https://go.samyaksion.com/r/${issued.rawToken}`,
      recoverable: true,
      lastFour: issued.rawToken.slice(-4),
    });
    expect(JSON.stringify(body)).not.toContain("token_hash");
    expect(JSON.stringify(body)).not.toContain("token_ciphertext");
    fixture.close();
  });

  it("keeps education partner full links owner-only and legacy links replacement-only", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedReferrer(fixture.sqlite, { suffix: "staff" });
    seedStaffRole(fixture.sqlite, "acct_staff", "counsellor");
    seedEducationPartner(fixture.sqlite, { commissionBps: 1000 });
    const legacyToken = "LEGACY-PARTNER-TOKEN-1234567890ABCDE";
    const legacyHash = await hashReferralToken(legacyToken, TEST_REFERRAL_TOKEN_PEPPER);
    fixture.sqlite.prepare(
      `insert into referral_links
        (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four,
         link_version, status, activated_at, created_at, updated_at)
       values ('rlink_legacy_partner', 'org_samyak', 'rprog_samyak_education_partners',
        'refprof_partner', ?, 'OKEN', 1, 'active', ?, ?, ?)`,
    ).run(legacyHash, PARTNER_NOW, PARTNER_NOW, PARTNER_NOW);
    const staffCookie = await seedSession(fixture.sqlite, "acct_staff", "person_staff", "sess_staff", "staff-session-token");
    const app = staffEducationPartnerRouteApp();

    const staffResponse = await app.request(
      "https://portal.samyaksion.com/api/staff/education-partners/epartner_one",
      { headers: { Cookie: staffCookie } },
      { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER },
    );
    expect(staffResponse.status).toBe(200);
    const staffBody = await staffResponse.json() as { partner: { activeLink: { publicUrl: string | null; recoverable: boolean; lastFour: string } } };
    expect(staffBody.partner.activeLink).toMatchObject({ publicUrl: null, recoverable: false, lastFour: "OKEN" });

    seedStaffRole(fixture.sqlite, "acct_student", "owner");
    const ownerCookie = await seedSession(fixture.sqlite, "acct_student", "person_student", "sess_owner", "owner-session-token");
    const ownerResponse = await app.request(
      "https://portal.samyaksion.com/api/staff/education-partners/epartner_one",
      { headers: { Cookie: ownerCookie } },
      { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER },
    );
    expect(ownerResponse.status).toBe(200);
    const ownerBody = await ownerResponse.json() as { partner: { activeLink: { publicUrl: string | null; recoverable: boolean; lastFour: string } } };
    expect(ownerBody.partner.activeLink).toMatchObject({ publicUrl: null, recoverable: false, lastFour: "OKEN" });
    expect(JSON.stringify(ownerBody)).not.toContain("legacy-partner-token");
    fixture.close();
  });

  it("replaces education partner links by revoking the old link and preserving historical referrals", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedStaffRole(fixture.sqlite, "acct_student", "owner");
    seedEducationPartner(fixture.sqlite, { commissionBps: 1000 });
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    addPartnerProgrammeCourse(fixture.sqlite, "course_fsd");
    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_education_partners",
      referrerProfileId: "refprof_partner",
      loginAccountId: "acct_student",
      now: PARTNER_NOW,
    });
    if (!issued.rawToken) throw new Error("Expected partner token");
    const historical = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(issued.rawToken, {
      rawReferralToken: issued.rawToken,
      prospectMobile: "9876543200",
      now: PARTNER_NOW,
    }));
    if (!historical.ok) throw new Error("Expected historical referral");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const app = staffEducationPartnerRouteApp();

    const replaced = await app.request(
      "https://portal.samyaksion.com/api/staff/education-partners/epartner_one/referral-link/replace",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie } },
      { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER },
    );
    expect(replaced.status).toBe(201);
    const replacedBody = await replaced.json() as { link: string; previousLinkId: string };
    const newToken = replacedBody.link.split("/").at(-1)!;

    expect(replacedBody.previousLinkId).toBe(issued.link.id);
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: issued.rawToken, now: PARTNER_NOW })).toEqual({ valid: false, reason: "invalid_link" });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: newToken, now: PARTNER_NOW })).toMatchObject({ valid: true });
    expect(row(fixture.sqlite, "select referral_link_id from referrals where id = ?", historical.referralId)).toMatchObject({ referral_link_id: issued.link.id });
    expect(count(fixture.sqlite, "referral_links where status = 'active' and referrer_profile_id = 'refprof_partner'")).toBe(1);
    expect(count(fixture.sqlite, "referral_links where status = 'revoked' and id = '" + issued.link.id + "'")).toBe(1);
    expect(count(fixture.sqlite, "referral_link_secrets")).toBe(2);
    expect(JSON.stringify(all(fixture.sqlite, "select action, metadata_json from audit_logs"))).not.toContain(newToken);
    fixture.close();
  });

  it("creates a referral, enquiry, initial event, immutable attribution, and safe audit metadata atomically", async () => {
    const fixture = testFixture();
    const rawToken = await issuedReadyLink(fixture);

    const result = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "submit-1" }));

    expect(result).toMatchObject({ ok: true, idempotent: false });
    if (!result.ok) throw new Error("submission failed");
    const referral = row(fixture.sqlite, "select * from referrals where id = ?", result.referralId);
    const enquiry = row(fixture.sqlite, "select * from enquiries where id = ?", result.enquiryId);
    expect(referral).toMatchObject({
      organisation_id: "org_samyak",
      branch_id: "branch_sion",
      referral_programme_id: "rprog_samyak_skill_circle",
      referral_link_id: expect.any(String),
      referrer_profile_id: "refprof_student",
      enquiry_id: result.enquiryId,
      course_interest_id: "course_fsd",
      source: "personal_link",
      status: "accepted",
      valid_until: "2026-11-04T10:00:00.000Z",
      attributed_at: NOW,
      prospect_name: "Future Learner",
      prospect_person_id: null,
      prospect_mobile_last_four: "3210",
    });
    expect(enquiry).toMatchObject({
      source: "referral",
      mobile_used: await mobileLookupHash("9876543210"),
      course_interest_id: "course_fsd",
    });
    expect(String(enquiry?.source_detail)).toContain(`samyak_skill_circle:${result.referralId}`);
    expect(columns(fixture.sqlite, "enquiries")).not.toContain("prospect_name");
    expect(count(fixture.sqlite, "people")).toBe(1);
    expect(count(fixture.sqlite, "referral_status_events where referral_id = '" + result.referralId + "' and to_status = 'accepted'")).toBe(1);
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from audit_logs"))).not.toContain("9876543210");
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from audit_logs"))).not.toContain("Future Learner");
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from referral_status_events"))).not.toContain("learner@example.com");
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from referral_status_events"))).not.toContain("Future Learner");
    fixture.close();
  });

  it("snapshots education partner commission and GST terms per referral submission", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedEducationPartner(fixture.sqlite, { commissionBps: 1000 });
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    addPartnerProgrammeCourse(fixture.sqlite, "course_fsd");
    const issued = await issueReferralLink(fixture.env, {
      organisationId: "org_samyak",
      referralProgrammeId: "rprog_samyak_education_partners",
      referrerProfileId: "refprof_partner",
      loginAccountId: "acct_partner_owner",
      now: "2026-08-24T10:00:00.000Z",
    });
    if (!issued.rawToken) throw new Error("Expected partner token");

    const first = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(issued.rawToken, {
      rawReferralToken: issued.rawToken,
      prospectMobile: "9876543210",
      now: "2026-08-24T10:00:00.000Z",
    }));
    expect(first).toMatchObject({ ok: true });
    fixture.sqlite.prepare("update education_partners set current_commission_basis_points = 1200, updated_at = ? where id = 'epartner_one'").run(NOW);
    const second = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(issued.rawToken, {
      rawReferralToken: issued.rawToken,
      prospectMobile: "9876543211",
      now: "2026-08-24T10:01:00.000Z",
    }));
    expect(second).toMatchObject({ ok: true });

    expect(all(fixture.sqlite, "select education_partner_id, partner_commission_basis_points, gst_basis_points_applicable from referrals order by submitted_at")).toEqual([
      { education_partner_id: "epartner_one", partner_commission_basis_points: 1000, gst_basis_points_applicable: 1800 },
      { education_partner_id: "epartner_one", partner_commission_basis_points: 1200, gst_basis_points_applicable: 1800 },
    ]);

    if (!first.ok) throw new Error("Expected first partner referral to succeed");
    seedPartnerAdmissionForReferral(fixture.sqlite, first.referralId, 2360000, 1180000);
    seedStaffRole(fixture.sqlite, "acct_student", "owner");
    const sessionCookie = await seedSession(fixture.sqlite, "acct_student", "person_student");
    const approval = await staffReferralRouteApp().request(
      `https://portal.samyaksion.com/api/staff/referrals/${first.referralId}/reward/approve`,
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie } },
      { ...fixture.env, REFERRAL_TOKEN_PEPPER: TEST_REFERRAL_TOKEN_PEPPER },
    );
    expect(approval.status).toBe(200);
    expect(await approval.json()).toMatchObject({
      qualificationState: "approved",
      reward: {
        cashRewardPaise: 200000,
        courseCreditPaise: 0,
        rewardModelType: "partner_percentage",
        partnerCommissionBasisPoints: 1000,
        gstBasisPointsApplicable: 1800,
        preGstFinalFeePaise: 2000000,
      },
    });
    expect(row(fixture.sqlite, "select cash_reward_paise, course_credit_paise, partner_commission_basis_points, gst_basis_points_applicable, pre_gst_final_fee_paise from referral_reward_snapshots where referral_id = ?", first.referralId)).toMatchObject({
      cash_reward_paise: 200000,
      course_credit_paise: 0,
      partner_commission_basis_points: 1000,
      gst_basis_points_applicable: 1800,
      pre_gst_final_fee_paise: 2000000,
    });

    fixture.sqlite.prepare("update education_partners set status = 'inactive' where id = 'epartner_one'").run();
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(issued.rawToken, {
      rawReferralToken: issued.rawToken,
      prospectMobile: "9876543212",
      now: "2026-08-24T10:02:00.000Z",
    }))).toEqual({ ok: false, code: "invalid_link" });
    fixture.close();
  });

  it("enforces education partner financial invariants at the database boundary", () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    seedEducationPartner(fixture.sqlite, { commissionBps: 1000 });
    seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
    addPartnerProgrammeCourse(fixture.sqlite, "course_fsd");

    expect(() =>
      fixture.sqlite.prepare(
        `insert into education_partners
          (id, organisation_id, home_branch_id, partner_type, business_name, contact_person_name,
           status, current_commission_basis_points, created_at, updated_at)
         values ('epartner_zero', 'org_samyak', 'branch_sion', 'college', 'Zero Partner', 'Zero Owner',
           'active', 0, ?, ?)`,
      ).run(NOW, NOW),
    ).toThrow();

    fixture.sqlite.prepare(
      `insert into referrer_profiles
        (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at)
       values ('refprof_partner_duplicate', 'org_samyak', null, 'education_partner:duplicate', 'partner-duplicate', '', 1, ?, ?)`,
    ).run(NOW, NOW);
    expect(() =>
      fixture.sqlite.prepare("insert into education_partner_referrer_profiles (education_partner_id, referrer_profile_id, created_at) values ('epartner_one', 'refprof_partner_duplicate', ?)")
        .run(NOW),
    ).toThrow();

    fixture.sqlite.prepare(
      `insert into education_partners
        (id, organisation_id, home_branch_id, partner_type, business_name, contact_person_name,
         status, current_commission_basis_points, created_at, updated_at)
       values ('epartner_two', 'org_samyak', 'branch_sion', 'college', 'Second Partner', 'Second Owner',
         'active', 1000, ?, ?)`,
    ).run(NOW, NOW);
    expect(() =>
      fixture.sqlite.prepare("insert into education_partner_referrer_profiles (education_partner_id, referrer_profile_id, created_at) values ('epartner_two', 'refprof_student', ?)")
        .run(NOW),
    ).toThrow();

    expect(() =>
      fixture.sqlite.prepare(
        `insert into referral_reward_rule_sets
          (id, organisation_id, referral_programme_id, version, name, status, created_at, updated_at, reward_model_type)
         values ('rrs_bad_model', 'org_samyak', 'rprog_samyak_skill_circle', 99, 'Bad model', 'inactive', ?, ?, 'bad_model')`,
      ).run(NOW, NOW),
    ).toThrow();

    expect(() =>
      insertPartnerReferralRow(fixture.sqlite, "ref_bad_partner_snapshot", {
        partnerCommissionBasisPoints: null,
        gstBasisPointsApplicable: null,
      }),
    ).toThrow();

    insertPartnerReferralRow(fixture.sqlite, "ref_good_partner_snapshot", {
      partnerCommissionBasisPoints: 1000,
      gstBasisPointsApplicable: 1800,
    });
    expect(() =>
      fixture.sqlite.prepare("update referrals set partner_commission_basis_points = 1200 where id = 'ref_good_partner_snapshot'").run(),
    ).toThrow();

    seedPartnerAdmissionForReferral(fixture.sqlite, "ref_good_partner_snapshot", 2360000, 1180000, "shape");
    expect(() =>
      fixture.sqlite.prepare(
        `insert into referral_reward_snapshots
          (id, referral_id, enrolment_id, fee_agreement_id, reward_rule_set_id, slab_id,
           final_agreed_fee_paise, minimum_fee_percentage, minimum_qualifying_payment_paise,
           cash_reward_paise, course_credit_paise, reward_model_type, education_partner_id,
           partner_commission_basis_points, gst_basis_points_applicable, pre_gst_final_fee_paise,
           snapshot_version, snapshot_json, created_at)
         values ('reward_bad_partner_shape', 'ref_good_partner_snapshot', 'enrolment_partner_shape', 'fee_partner_shape',
           'rrs_samyak_education_partners_v1', 'slab_1', 2360000, 50, 1180000, 200000, 0,
           'partner_percentage', 'epartner_one', 1000, 1800, 2000000, 1, '{}', ?)`,
      ).run(NOW),
    ).toThrow();

    fixture.close();
  });

  it("keeps idempotent retries stable and rejects the same key with a different payload", async () => {
    const fixture = testFixture();
    const rawToken = await issuedReadyLink(fixture);

    const first = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1" }));
    const retry = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1" }));
    const whitespaceRetry = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1", prospectName: "  Future   Learner  " }));
    const nameConflict = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1", prospectName: "Changed Learner" }));
    const courseConflict = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { idempotencyKey: "idem-1", courseId: "course_data" }));

    expect(first.ok && retry.ok && retry.referralId === first.referralId && retry.enquiryId === first.enquiryId && retry.idempotent).toBe(true);
    expect(first.ok && whitespaceRetry.ok && whitespaceRetry.referralId === first.referralId && whitespaceRetry.enquiryId === first.enquiryId && whitespaceRetry.idempotent).toBe(true);
    expect(nameConflict).toEqual({ ok: false, code: "idempotency_conflict" });
    expect(courseConflict).toEqual({ ok: false, code: "idempotency_conflict" });
    expect(count(fixture.sqlite, "referrals")).toBe(1);
    expect(count(fixture.sqlite, "enquiries")).toBe(1);
    expect(count(fixture.sqlite, "referral_status_events")).toBe(1);
    fixture.close();
  });

  it("normalizes submitted referral names and rejects unsafe values", async () => {
    const fixture = testFixture();
    const rawToken = await issuedReadyLink(fixture);

    expect(normalizeSubmittedReferralName("  Asha   S.   Nair  ")).toBe("Asha S. Nair");
    expect(normalizeSubmittedReferralName("")).toBeNull();
    expect(normalizeSubmittedReferralName("A".repeat(101))).toBeNull();
    expect(normalizeSubmittedReferralName("Asha\u0007Nair")).toBeNull();
    expect(normalizeSubmittedReferralName("आर्या अय्यर")).toBe("आर्या अय्यर");

    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectName: "   " }))).toEqual({ ok: false, code: "invalid_name" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectName: "A".repeat(101) }))).toEqual({ ok: false, code: "invalid_name" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectName: "Asha\u0007Nair" }))).toEqual({ ok: false, code: "invalid_name" });

    const accepted = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectName: "  आर्या   अय्यर  ", prospectMobile: "9876500040" }));
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error("unicode submission failed");
    expect(row(fixture.sqlite, "select prospect_name, prospect_person_id from referrals where id = ?", accepted.referralId)).toMatchObject({
      prospect_name: "आर्या अय्यर",
      prospect_person_id: null,
    });
    expect(count(fixture.sqlite, "people")).toBe(1);
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from audit_logs"))).not.toContain("आर्या अय्यर");
    expect(JSON.stringify(all(fixture.sqlite, "select metadata_json from referral_status_events"))).not.toContain("आर्या अय्यर");
    fixture.close();
  });

  it("classifies existing enquiries, students, duplicates, consent, mobile, course, and branch rejections", async () => {
    const fixture = testFixture();
    const rawToken = await issuedReadyLink(fixture);
    const existingHash = await mobileLookupHash("9876500000");
    fixture.sqlite.prepare(
      `insert into enquiries (id, organisation_id, branch_id, enquiry_number, mobile_used, course_interest_id, source, status, created_at, updated_at)
       values ('enq_existing', 'org_samyak', 'branch_sion', 'ENQ-EXISTING', ?, 'course_fsd', 'walk_in', 'lost', ?, ?)`,
    ).run(existingHash, NOW, NOW);
    await seedProspectStudent(fixture.sqlite, "current", "9876500001", "active");
    await seedProspectStudent(fixture.sqlite, "former", "9876500002", "alumni");

    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500000" }))).toEqual({ ok: false, code: "existing_enquiry" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500001" }))).toEqual({ ok: false, code: "current_student" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500002" }))).toEqual({ ok: false, code: "former_student" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { consentAccepted: false }))).toEqual({ ok: false, code: "consent_missing" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "12345" }))).toEqual({ ok: false, code: "invalid_mobile" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { courseId: "missing_course" }))).toEqual({ ok: false, code: "ineligible_course" });
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { branchId: "branch_other" }))).toEqual({ ok: false, code: "invalid_link" });

    const first = await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500003" }));
    expect(first.ok).toBe(true);
    expect(await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500003", idempotencyKey: "new-key" }))).toEqual({ ok: false, code: "active_duplicate" });
    fixture.sqlite.prepare("update referrals set submitted_at = ?, valid_until = ?, active_duplicate_key = null where prospect_mobile_last_four = '0003'")
      .run("2026-07-01T00:00:00.000Z", "2026-08-05T00:00:00.000Z");
    expect((await submitReferralAndCreateEnquiry(fixture.env, validSubmission(rawToken, { prospectMobile: "9876500003", idempotencyKey: "after-expiry" }))).ok).toBe(true);
    fixture.close();
  });

  it("enforces service integrity indexes through migrated SQLite", async () => {
    const fixture = testFixture();
    seedReferrer(fixture.sqlite);
    const first = await issueReferralLink(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", referrerProfileId: "refprof_student", now: NOW });
    expect(first.rawToken).toBeTruthy();
    expect(() =>
      fixture.sqlite.prepare(
        `insert into referral_links
          (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four, link_version, status, activated_at, created_at, updated_at)
         values ('manual_link', 'org_samyak', 'rprog_samyak_skill_circle', 'refprof_student', 'manual_hash', 'hash', 1, 'active', ?, ?, ?)`,
      ).run(NOW, NOW, NOW),
    ).toThrow();
    expect(columns(fixture.sqlite, "referral_links")).not.toEqual(expect.arrayContaining(["token", "raw_token", "personal_link", "public_url"]));
    expect(columns(fixture.sqlite, "referrals")).toContain("prospect_name");
    expect(columns(fixture.sqlite, "referral_reward_snapshots")).toEqual(expect.arrayContaining(["status", "approved_by_login_account_id", "approved_at"]));
    expect(columns(fixture.sqlite, "referral_reward_payouts")).toEqual(expect.arrayContaining(["reward_snapshot_id", "amount_paise", "payment_date", "payment_mode", "idempotency_key", "payload_fingerprint"]));
    expect(all(fixture.sqlite, "pragma table_info(referrals)").find((item) => item.name === "prospect_name")).toMatchObject({ notnull: 1 });
    expect(indexes(fixture.sqlite)).toEqual(expect.arrayContaining([
      "referral_links_one_active_referrer_programme_unique",
      "referrals_active_duplicate_unique",
      "referrals_idempotency_payload_idx",
      "referral_reward_payouts_reward_unique",
      "referral_reward_payouts_idempotency_unique",
      "enquiries_organisation_mobile_idx",
      "person_contacts_type_value_idx",
    ]));
    fixture.close();
  });
});

function testFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("pragma foreign_keys = on");
  applyMigrations(sqlite);
  const db = new SqliteD1(sqlite) as unknown as ReferralDb;
  const env: ReferralServiceEnv = { DB: db, SESSION_PEPPER, referralTokenPepper: TEST_REFERRAL_TOKEN_PEPPER };
  return { sqlite, env, close: () => sqlite.close() };
}

function publicReferralApp() {
  const app = new Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>();
  registerPublicReferralRoutes(app);
  return app;
}

function studentRouteApp() {
  const app = new Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>();
  registerStudentRoutes(app);
  return app;
}

function staffReferralRouteApp() {
  const app = new Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>();
  registerStaffReferralRoutes(app);
  return app;
}

function staffEducationPartnerRouteApp() {
  const app = new Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>();
  registerStaffEducationPartnerRoutes(app);
  return app;
}

function staffAdmissionRouteApp() {
  const app = new Hono<{ Bindings: WorkerBindings; Variables: WorkerVariables }>();
  registerStaffAdmissionRoutes(app);
  return app;
}

async function seedSession(db: DatabaseSync, loginAccountId: string, activePersonId: string, sessionId = "sess_student", token = "test-session-token") {
  const tokenHash = await hmacHex(SESSION_PEPPER, "session", token);
  const lastSeenAt = new Date().toISOString();
  db.prepare(
    `insert into user_sessions
      (id, login_account_id, active_person_id, token_hash, created_at, expires_at, last_seen_at, revoked_at, ip_hash, user_agent_hash)
     values (?, ?, ?, ?, ?, '2999-01-01T00:00:00.000Z', ?, null, 'ip_hash', 'ua_hash')`,
  ).run(sessionId, loginAccountId, activePersonId, tokenHash, NOW, lastSeenAt);
  return `__Host-samyak_session=${token}`;
}

function applyMigrations(db: DatabaseSync) {
  for (const file of readdirSync(join(process.cwd(), "migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    if (file === "0012_d1_referral_foundation.sql") {
      seedBase(db);
    }
    applyMigrationFile(db, file);
  }
}

function applyMigrationFile(db: DatabaseSync, file: string) {
  const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
}

function seedBase(db: DatabaseSync) {
  db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_samyak', 'Samyak', 'samyak', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_other', 'Other', 'other', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_other', 'org_other', 'Other', 'OTHR', 'Asia/Kolkata', 'active', ?, ?)").run(NOW, NOW);
  db.prepare("insert into roles (id, organisation_id, code, name, created_at) values ('role_student', 'org_samyak', 'student', 'Student', ?)").run(NOW);
  db.prepare("insert into roles (id, organisation_id, code, name, created_at) values ('role_alumni', 'org_samyak', 'alumni', 'Alumni', ?)").run(NOW);
}

function seedReferrer(db: DatabaseSync, options: { suffix?: string; organisationId?: string; loginAccessType?: string; roleId?: string } = {}) {
  const suffix = options.suffix || "student";
  const organisationId = options.organisationId || "org_samyak";
  const branchId = organisationId === "org_samyak" ? "branch_sion" : "branch_other";
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, ?, ?, ?, ?, 'active', ?, ?)")
    .run(`person_${suffix}`, organisationId, branchId, `${suffix} Referrer`, `${title(suffix)} Referrer`, NOW, NOW);
  db.prepare("insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 1, ?, ?)")
    .run(`refprof_${suffix}`, organisationId, `person_${suffix}`, `EXT-${suffix}`, `legacy-${suffix}`, `https://legacy/${suffix}`, NOW, NOW);
  if (organisationId === "org_samyak") {
    db.prepare("insert into person_roles (person_id, role_id, branch_id, branch_key, created_at) values (?, ?, null, '', ?)")
      .run(`person_${suffix}`, options.roleId || "role_student", NOW);
    db.prepare("insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at) values (?, ?, ?, ?, '0000', 1, 'active', ?, ?)")
      .run(`acct_${suffix}`, organisationId, `acct_hash_${suffix}`, `acct_hash_${suffix}`, NOW, NOW);
    db.prepare("insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values (?, ?, ?, 1, 1, ?)")
      .run(`acct_${suffix}`, `person_${suffix}`, options.loginAccessType || "self", NOW);
  }
}

function seedStaffRole(db: DatabaseSync, loginAccountId = "acct_student", role = "counsellor", branchId: string | null = null) {
  const roleId = `role_${role}`;
  db.prepare("insert or ignore into roles (id, organisation_id, code, name, created_at) values (?, 'org_samyak', ?, ?, ?)")
    .run(roleId, role, title(role), NOW);
  db.prepare("insert into login_account_roles (login_account_id, role_id, branch_id, created_at) values (?, ?, ?, ?)")
    .run(loginAccountId, roleId, branchId, NOW);
}

function seedCourse(db: DatabaseSync, id: string, code: string, name: string, status: string, categoryId: string | null = "ccat_wdd", organisationId = "org_samyak") {
  db.prepare(
    `insert into courses
      (id, organisation_id, category_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
     values (?, ?, ?, ?, ?, '6 months', 6, 5000000, 4000000, 1, 1, ?, ?, ?)`,
  ).run(id, organisationId, categoryId, code, name, status, NOW, NOW);
}

function addProgrammeCourse(db: DatabaseSync, courseId: string, active = 1) {
  db.prepare("insert into referral_programme_courses (referral_programme_id, course_id, is_active, created_at, updated_at) values ('rprog_samyak_skill_circle', ?, ?, ?, ?)")
    .run(courseId, active, NOW, NOW);
}

function addPartnerProgrammeCourse(db: DatabaseSync, courseId: string, active = 1) {
  db.prepare("insert into referral_programme_courses (referral_programme_id, course_id, is_active, created_at, updated_at) values ('rprog_samyak_education_partners', ?, ?, ?, ?)")
    .run(courseId, active, NOW, NOW);
}

function seedEducationPartner(db: DatabaseSync, options: { commissionBps: number }) {
  db.prepare("insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at) values ('acct_partner_owner', 'org_samyak', 'acct_hash_partner_owner', 'acct_hash_partner_owner', '0000', 1, 'active', ?, ?)")
    .run(NOW, NOW);
  db.prepare(
    `insert into education_partners
      (id, organisation_id, home_branch_id, partner_type, business_name, contact_person_name,
       mobile_hash, mobile_last_four, mobile_ciphertext, status, current_commission_basis_points,
       created_by_login_account_id, created_at, updated_at)
     values ('epartner_one', 'org_samyak', 'branch_sion', 'college', 'Partner College', 'Partner Owner',
       'partner_mobile_hash', '4321', 'ciphertext', 'active', ?, 'acct_partner_owner', ?, ?)`,
  ).run(options.commissionBps, NOW, NOW);
  db.prepare(
    `insert into referrer_profiles
      (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at)
     values ('refprof_partner', 'org_samyak', null, 'education_partner:epartner_one', 'partner-legacy', '', 1, ?, ?)`,
  ).run(NOW, NOW);
  db.prepare("insert into education_partner_referrer_profiles (education_partner_id, referrer_profile_id, created_at) values ('epartner_one', 'refprof_partner', ?)")
    .run(NOW);
}

async function issuedReadyLink(fixture: ReturnType<typeof testFixture>) {
  seedReferrer(fixture.sqlite);
  seedCourse(fixture.sqlite, "course_fsd", "FSD", "Full Stack", "active");
  seedCourse(fixture.sqlite, "course_data", "DATA", "Data Analytics", "active");
  addProgrammeCourse(fixture.sqlite, "course_fsd");
  addProgrammeCourse(fixture.sqlite, "course_data");
  const issued = await issueReferralLink(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", referrerProfileId: "refprof_student", now: NOW });
  if (!issued.rawToken) throw new Error("Expected fresh token");
  return issued.rawToken;
}

function validSubmission(rawToken: string, overrides: Partial<Parameters<typeof submitReferralAndCreateEnquiry>[1]> = {}) {
  return {
    organisationId: "org_samyak",
    rawReferralToken: rawToken,
    branchId: "branch_sion",
    prospectName: "Future Learner",
    prospectMobile: "9876543210",
    prospectEmail: "learner@example.com",
    courseId: "course_fsd",
    consentAccepted: true,
    source: "personal_link" as const,
    now: NOW,
    ...overrides,
  };
}

async function seedProspectStudent(db: DatabaseSync, suffix: string, mobile: string, status: string) {
  const mobileHash = await mobileLookupHash(mobile);
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', ?, ?, 'active', ?, ?)")
    .run(`person_${suffix}_prospect`, `${suffix} Prospect`, `${suffix} Prospect`, NOW, NOW);
  db.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values (?, ?, 'mobile', ?, ?, 1, 1, ?, ?)")
    .run(`contact_${suffix}`, `person_${suffix}_prospect`, mobileHash, mobile.slice(-4), NOW, NOW);
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values (?, 'org_samyak', ?, 'branch_sion', ?, ?, ?, ?, 'active', ?, ?)")
    .run(`student_${suffix}`, `person_${suffix}_prospect`, `STU-${suffix}`, suffix === "current" ? 1 : 2, NOW, status, NOW, NOW);
}

function seedDashboardReferral(db: DatabaseSync, index: number, status: string) {
  const suffix = String(index).padStart(2, "0");
  const submittedAt = `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`;
  db.prepare(
    `insert into referrals
      (id, organisation_id, branch_id, referral_programme_id, referral_link_id, referrer_profile_id,
       prospect_person_id, enquiry_id, course_interest_id, source, status, submitted_at, valid_until,
       attributed_at, prospect_mobile_hash, prospect_mobile_last_four, prospect_name, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', 'rprog_samyak_skill_circle', null, 'refprof_student',
       null, null, 'course_fsd', 'personal_link', ?, ?, '2026-12-31T10:00:00.000Z',
       ?, ?, ?, ?, ?, ?)`,
  ).run(`referral_${suffix}`, status, submittedAt, submittedAt, `mobile_hash_${suffix}`, suffix, `Prospect ${suffix}`, submittedAt, submittedAt);
}

async function attachSubmittedMobile(db: DatabaseSync, referralId: string, mobile: string) {
  const mobileHash = await mobileLookupHash(mobile);
  const linkId = `link_${referralId}`;
  const ciphertext = await encryptText(SESSION_PEPPER, `referral-mobile:${linkId}:${mobileHash}`, mobile);
  db.prepare(
    `insert into referral_links
      (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four, link_version, status, activated_at, created_at, updated_at)
     values (?, 'org_samyak', 'rprog_samyak_skill_circle', 'refprof_student', ?, 'hash', 1, 'active', ?, ?, ?)`,
  ).run(linkId, `token_hash_${referralId}`, NOW, NOW, NOW);
  db.prepare(
    `update referrals
     set referral_link_id = ?, prospect_mobile_hash = ?, prospect_mobile_last_four = ?, prospect_mobile_ciphertext = ?
     where id = ?`,
  ).run(linkId, mobileHash, mobile.slice(-4), ciphertext, referralId);
}

async function attachLinkedProspectContact(db: DatabaseSync, referralId: string, mobile: string) {
  const mobileHash = await mobileLookupHash(mobile);
  const personId = `person_${referralId}_prospect`;
  const contactId = `contact_${referralId}_prospect`;
  const ciphertext = await encryptText(SESSION_PEPPER, `contact:${contactId}`, mobile);
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', 'Linked Prospect', 'Linked Prospect', 'active', ?, ?)")
    .run(personId, NOW, NOW);
  db.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values (?, ?, 'mobile', ?, ?, 1, 1, ?, ?)")
    .run(contactId, personId, mobileHash, mobile.slice(-4), NOW, NOW);
  db.prepare("insert into person_contact_details (contact_id, belongs_to, is_whatsapp, status, created_at, updated_at) values (?, 'student', 1, 'active', ?, ?)")
    .run(contactId, NOW, NOW);
  db.prepare("insert into person_contact_secrets (contact_id, value_ciphertext, encryption_version, created_at, updated_at) values (?, ?, 'v1', ?, ?)")
    .run(contactId, ciphertext, NOW, NOW);
  db.prepare("update referrals set prospect_person_id = ? where id = ?").run(personId, referralId);
}

function seedRewardSnapshot(db: DatabaseSync, index: number) {
  const suffix = String(index).padStart(2, "0");
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', ?, ?, 'active', ?, ?)")
    .run(`person_reward_${suffix}`, `Reward Student ${suffix}`, `Reward Student ${suffix}`, NOW, NOW);
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values (?, 'org_samyak', ?, 'branch_sion', ?, ?, ?, 'active', 'active', ?, ?)")
    .run(`student_reward_${suffix}`, `person_reward_${suffix}`, `STU-REWARD-${suffix}`, 1000 + index, NOW, NOW, NOW);
  db.prepare(
    `insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode,
       admission_date, joining_date, status, nsdc_preference, referrer_profile_id, referral_id, created_at, updated_at)
     values (?, ?, 'branch_sion', 'course_fsd', null, ?, 'classroom',
       ?, ?, 'active', 'decide_later', 'refprof_student', ?, ?, ?)`,
  ).run(`enrolment_${suffix}`, `student_reward_${suffix}`, `ENR-${suffix}`, NOW, NOW, `referral_${suffix}`, NOW, NOW);
  db.prepare(
    `insert into fee_agreements
      (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, gst_rate_basis_points,
       payment_plan_type, number_of_instalments, initial_payment_expected_paise, status, created_at, updated_at)
     values (?, ?, 1000000, 900000, 100000, 0, 'single', 1, 900000, 'active', ?, ?)`,
  ).run(`fee_${suffix}`, `enrolment_${suffix}`, NOW, NOW);
  db.prepare(
    `insert into referral_reward_snapshots
      (id, referral_id, enrolment_id, fee_agreement_id, reward_rule_set_id, slab_id,
       final_agreed_fee_paise, minimum_fee_percentage, minimum_qualifying_payment_paise,
       cash_reward_paise, course_credit_paise, snapshot_version, snapshot_json, created_at)
     values (?, ?, ?, ?, 'rrs_samyak_skill_circle_v1', null,
       900000, 50, 450000, 10000, 5000, 1, '{}', ?)`,
  ).run(`reward_${suffix}`, `referral_${suffix}`, `enrolment_${suffix}`, `fee_${suffix}`, NOW);
}

function seedAdmittedOperationReferral(db: DatabaseSync, index: number, dates: { submittedAt: string; validUntil: string; admissionDate: string }) {
  const suffix = String(index).padStart(2, "0");
  db.prepare("update referrals set submitted_at = ?, valid_until = ?, updated_at = ? where id = ?")
    .run(dates.submittedAt, dates.validUntil, dates.submittedAt, `referral_${suffix}`);
  if (!row(db, "select id from people where id = ?", `person_reward_${suffix}`)) {
    db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', ?, ?, 'active', ?, ?)")
      .run(`person_reward_${suffix}`, `Reward Student ${suffix}`, `Reward Student ${suffix}`, dates.admissionDate, dates.admissionDate);
    db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values (?, 'org_samyak', ?, 'branch_sion', ?, ?, ?, 'active', 'active', ?, ?)")
      .run(`student_reward_${suffix}`, `person_reward_${suffix}`, `STU-REWARD-${suffix}`, 2000 + index, dates.admissionDate, dates.admissionDate, dates.admissionDate);
  }
  db.prepare(
    `insert or ignore into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode,
       admission_date, joining_date, status, nsdc_preference, referrer_profile_id, referral_id, created_at, updated_at)
     values (?, ?, 'branch_sion', 'course_fsd', null, ?, 'classroom',
       ?, ?, 'active', 'decide_later', 'refprof_student', ?, ?, ?)`,
  ).run(`enrolment_${suffix}`, `student_reward_${suffix}`, `ENR-${suffix}`, dates.admissionDate, dates.admissionDate, `referral_${suffix}`, dates.admissionDate, dates.admissionDate);
  db.prepare("update enrolments set admission_date = ?, joining_date = ?, updated_at = ? where id = ?")
    .run(dates.admissionDate, dates.admissionDate, dates.admissionDate, `enrolment_${suffix}`);
  db.prepare(
    `insert or ignore into fee_agreements
      (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, gst_rate_basis_points,
       payment_plan_type, number_of_instalments, initial_payment_expected_paise, status, created_at, updated_at)
     values (?, ?, 1000000, 900000, 100000, 0, 'single', 1, 900000, 'active', ?, ?)`,
  ).run(`fee_${suffix}`, `enrolment_${suffix}`, dates.admissionDate, dates.admissionDate);
}

function addReceipt(db: DatabaseSync, index: number, amountPaise: number, receivedAt = "2025-03-15T10:00:00.000Z", idSuffix = "main") {
  const suffix = String(index).padStart(2, "0");
  const receiptId = `receipt_${suffix}_${idSuffix}`;
  db.prepare(
    `insert into receipts
      (id, organisation_id, branch_id, receipt_number, receipt_year, enquiry_id, admission_draft_id,
       person_id, student_id, enrolment_id, fee_agreement_id, amount_paise, received_at, payment_mode,
       payment_reference, notes, status, created_by_login_account_id, idempotency_key, payload_fingerprint,
       created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', ?, 2025, null, null,
       ?, ?, ?, ?, ?, ?, 'cash',
       null, null, 'recorded', 'acct_student', ?, ?, ?, ?)`,
  ).run(
    receiptId,
    `RCPT-${suffix}-${idSuffix}`,
    `person_reward_${suffix}`,
    `student_reward_${suffix}`,
    `enrolment_${suffix}`,
    `fee_${suffix}`,
    amountPaise,
    receivedAt,
    `receipt-key-${suffix}-${idSuffix}`,
    `receipt-fingerprint-${suffix}-${idSuffix}`,
    receivedAt,
    receivedAt,
  );
}

function insertPartnerReferralRow(
  db: DatabaseSync,
  referralId: string,
  options: { partnerCommissionBasisPoints: number | null; gstBasisPointsApplicable: number | null },
) {
  db.prepare(
    `insert into referrals
      (id, organisation_id, branch_id, referral_programme_id, referral_link_id, referrer_profile_id,
       prospect_person_id, enquiry_id, course_interest_id, source, status, submitted_at, valid_until,
       attributed_at, prospect_mobile_hash, prospect_mobile_last_four, prospect_name,
       education_partner_id, partner_commission_basis_points, gst_basis_points_applicable, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', 'rprog_samyak_education_partners', null, 'refprof_partner',
       null, null, 'course_fsd', 'personal_link', 'accepted', ?, '2026-12-31T10:00:00.000Z',
       ?, ?, ?, ?, 'epartner_one', ?, ?, ?, ?)`,
  ).run(
    referralId,
    NOW,
    NOW,
    `partner_mobile_${referralId}`,
    referralId.slice(-4),
    `Partner Prospect ${referralId}`,
    options.partnerCommissionBasisPoints,
    options.gstBasisPointsApplicable,
    NOW,
    NOW,
  );
}

function seedPartnerAdmissionForReferral(db: DatabaseSync, referralId: string, finalFeePaise: number, receiptPaise: number, suffix = "one") {
  db.prepare("insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'branch_sion', ?, ?, 'active', ?, ?)")
    .run(`person_partner_${suffix}`, `Partner Reward ${suffix}`, `Partner Reward ${suffix}`, NOW, NOW);
  db.prepare("insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values (?, 'org_samyak', ?, 'branch_sion', ?, ?, ?, 'active', 'active', ?, ?)")
    .run(`student_partner_${suffix}`, `person_partner_${suffix}`, `STU-PARTNER-${suffix}`, 3000 + suffix.length, NOW, NOW, NOW);
  db.prepare(
    `insert into enrolments
      (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode,
       admission_date, joining_date, status, nsdc_preference, referrer_profile_id, referral_id, created_at, updated_at)
     values (?, ?, 'branch_sion', 'course_fsd', null, ?, 'classroom',
       ?, ?, 'confirmed', 'decide_later', 'refprof_partner', ?, ?, ?)`,
  ).run(`enrolment_partner_${suffix}`, `student_partner_${suffix}`, `ENR-PARTNER-${suffix}`, NOW, NOW, referralId, NOW, NOW);
  db.prepare(
    `insert into fee_agreements
      (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, gst_rate_basis_points,
       payment_plan_type, number_of_instalments, initial_payment_expected_paise, status, created_at, updated_at)
     values (?, ?, ?, ?, 0, 1800, 'single', 1, ?, 'active', ?, ?)`,
  ).run(`fee_partner_${suffix}`, `enrolment_partner_${suffix}`, finalFeePaise, finalFeePaise, receiptPaise, NOW, NOW);
  db.prepare(
    `insert into receipts
      (id, organisation_id, branch_id, receipt_number, receipt_year, enquiry_id, admission_draft_id,
       person_id, student_id, enrolment_id, fee_agreement_id, amount_paise, received_at, payment_mode,
       payment_reference, notes, status, created_by_login_account_id, idempotency_key, payload_fingerprint,
       created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', ?, 2026, null, null,
       ?, ?, ?, ?, ?, ?, 'cash',
       null, null, 'recorded', 'acct_student', ?, ?, ?, ?)`,
  ).run(
    `receipt_partner_${suffix}`,
    `RCPT-PARTNER-${suffix}`,
    `person_partner_${suffix}`,
    `student_partner_${suffix}`,
    `enrolment_partner_${suffix}`,
    `fee_partner_${suffix}`,
    receiptPaise,
    NOW,
    `receipt-key-partner-${suffix}`,
    `receipt-fingerprint-partner-${suffix}`,
    NOW,
    NOW,
  );
}

async function mobileLookupHash(value: string) {
  const mobile = normalizeIndianMobile(value);
  if (!mobile) throw new Error("Invalid test mobile");
  return hmacHex(SESSION_PEPPER, "mobile", mobile);
}

function row(db: DatabaseSync, sql: string, ...values: SqlValue[]) {
  return db.prepare(sql).get(...values) as Record<string, unknown> | undefined;
}

function all(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Record<string, unknown>[];
}

function count(db: DatabaseSync, tableOrWhere: string) {
  return Number(row(db, `select count(*) as count from ${tableOrWhere}`)?.count || 0);
}

function columns(db: DatabaseSync, tableName: string) {
  return all(db, `pragma table_info(${tableName})`).map((item) => String(item.name));
}

function indexes(db: DatabaseSync) {
  return all(db, "select name from sqlite_master where type = 'index'").map((item) => String(item.name));
}

function title(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
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
