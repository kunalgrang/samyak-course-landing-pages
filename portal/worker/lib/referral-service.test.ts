/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { hmacHex } from "./crypto";
import { normalizeIndianMobile } from "./mobile";
import { issueReferralLink, listEligibleReferralCourses, normalizeSubmittedReferralName, resolveReferralLink, rotateReferralLink, submitReferralAndCreateEnquiry, type ReferralServiceEnv } from "./referral-service";
import { hashReferralToken } from "./referral-token";
import type { ReferralDb } from "./referral-repository";
import { groupEligibleCourses, registerPublicReferralRoutes } from "../routes/public-referrals";
import type { WorkerBindings, WorkerVariables } from "../bindings";
import { registerStudentRoutes } from "../routes/student";

const NOW = "2026-08-06T10:00:00.000Z";
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
] as const;

describe("native referral services", () => {
  it("issues a strong one-time referral token and stores only hash plus last four", async () => {
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
    expect(JSON.stringify(all(fixture.sqlite, "select * from referral_links"))).not.toContain(issued.rawToken);
    expect(JSON.stringify(all(fixture.sqlite, "select * from audit_logs"))).not.toContain(issued.rawToken);
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
    expect(eligibleCourses).toHaveLength(41);
    expect(eligibleCourses.map((course) => course.code)).toContain("SYK-WDD-001");
    expect(eligibleCourses.map((course) => course.code)).toContain("SYK-DSAI-003");
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

  it("seeds the owner-approved canonical Course Master and explicit 41-course referral eligibility", async () => {
    const fixture = testFixture();
    expect(count(fixture.sqlite, "course_categories where organisation_id = 'org_samyak'")).toBe(13);
    expect(count(fixture.sqlite, "courses where organisation_id = 'org_samyak'")).toBe(41);
    expect(new Set(WORKBOOK_COURSES.map(([code]) => code)).size).toBe(41);
    expect(count(fixture.sqlite, "courses where organisation_id = 'org_samyak' and status = 'active' and admission_configuration_complete = 1")).toBe(41);
    expect(count(fixture.sqlite, "referral_programme_courses where referral_programme_id = 'rprog_samyak_skill_circle' and is_active = 1")).toBe(41);
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
    expect(eligibleCodes).toHaveLength(41);
    expect(eligibleCodes).not.toContain("FUTURE");
    expect(eligibleCodes).not.toContain("INACTIVE");
    expect(eligibleCodes).not.toContain("OTHER");
    fixture.close();
  });

  it("groups eligible courses by active categories for the public API without pricing fields", async () => {
    const fixture = testFixture();
    const grouped = groupEligibleCourses(await listEligibleReferralCourses(fixture.env, { organisationId: "org_samyak", referralProgrammeId: "rprog_samyak_skill_circle", now: NOW }));
    expect(grouped).toHaveLength(13);
    expect(grouped.flatMap((category) => category.courses)).toHaveLength(41);
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
    expect(courseBody.categories.flatMap((category) => category.courses)).toHaveLength(41);
    expect(courseBody.categories.flatMap((category) => category.courses).map((course) => course.id)).toContain("course_syk_wdd_001");
    expect(JSON.stringify(courseBody)).not.toContain("default_fee_paise");

    expect((await app.request(
      `https://evil.test/api/public/referrals/resolve/${issued.rawToken}`,
      { headers: { Origin: "https://evil.test" } },
      workerEnv,
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

  it("serves authenticated referral-link generation, metadata-only reload, rotation, CSRF, and replay limits", async () => {
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
    const dashboardBody = await dashboard.json() as { linkStatus: { hasActiveLink: boolean; lastFour: string }; profile: { personalLink: string } };
    expect(dashboardBody.linkStatus).toMatchObject({ hasActiveLink: true, lastFour: generatedBody.lastFour });
    expect(dashboardBody.profile.personalLink).toBe("");
    expect(JSON.stringify(dashboardBody)).not.toContain(oldToken);

    const csrf = await app.request(
      "https://portal.samyaksion.com/api/referrals/link/rotate",
      { method: "POST", headers: { Origin: "https://evil.test", Cookie: sessionCookie } },
      workerEnv,
    );
    expect(csrf.status).toBe(403);

    const rotated = await app.request(
      "https://portal.samyaksion.com/api/referrals/link/rotate",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie } },
      workerEnv,
    );
    expect(rotated.status).toBe(201);
    const rotatedBody = await rotated.json() as { link: string; lastFour: string; previousLinkId: string };
    const newToken = rotatedBody.link.split("/").at(-1)!;
    expect(newToken).not.toBe(oldToken);
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: oldToken, now: NOW })).toEqual({ valid: false, reason: "invalid_link" });
    expect(await resolveReferralLink(fixture.env, { organisationId: "org_samyak", rawToken: newToken, now: NOW })).toMatchObject({ valid: true });
    expect(count(fixture.sqlite, "referral_links where status = 'active'")).toBe(1);
    expect(count(fixture.sqlite, "referral_links where status = 'revoked'")).toBe(1);

    const doubleClick = await app.request(
      "https://portal.samyaksion.com/api/referrals/link/rotate",
      { method: "POST", headers: { Origin: "https://portal.samyaksion.com", Cookie: sessionCookie } },
      workerEnv,
    );
    expect(doubleClick.status).toBe(429);
    expect(doubleClick.headers.get("Retry-After")).toBe("10");
    const auditJson = JSON.stringify(all(fixture.sqlite, "select action, metadata_json from audit_logs"));
    expect(auditJson).not.toContain(oldToken);
    expect(auditJson).not.toContain(newToken);
    expect(auditJson).not.toContain("/r/");
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
    expect(all(fixture.sqlite, "pragma table_info(referrals)").find((item) => item.name === "prospect_name")).toMatchObject({ notnull: 1 });
    expect(indexes(fixture.sqlite)).toEqual(expect.arrayContaining([
      "referral_links_one_active_referrer_programme_unique",
      "referrals_active_duplicate_unique",
      "referrals_idempotency_payload_idx",
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

async function seedSession(db: DatabaseSync, loginAccountId: string, activePersonId: string) {
  const token = "test-session-token";
  const tokenHash = await hmacHex(SESSION_PEPPER, "session", token);
  db.prepare(
    `insert into user_sessions
      (id, login_account_id, active_person_id, token_hash, created_at, expires_at, last_seen_at, revoked_at, ip_hash, user_agent_hash)
     values ('sess_student', ?, ?, ?, ?, '2999-01-01T00:00:00.000Z', ?, null, 'ip_hash', 'ua_hash')`,
  ).run(loginAccountId, activePersonId, tokenHash, NOW, NOW);
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

function seedCourse(db: DatabaseSync, id: string, code: string, name: string, status: string, categoryId: string | null = null, organisationId = "org_samyak") {
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
