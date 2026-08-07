/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  assertReferralStatusTransition,
  assertSnapshotJsonSafe,
  calculateMinimumQualifyingPaymentPaise,
  calculateReferralValidUntil,
  canTransitionReferralStatus,
  classifyProspectRejection,
  findActiveDuplicateReferral,
  publicSafeReferralStatus,
  referralTokenLastFour,
  referralTokenLookupHash,
  selectRewardSlab,
  validateReferralRelationshipScope,
  validateRewardSlabNonOverlap,
  type RewardSlab,
} from "./referral-domain";

type Row = Record<string, unknown>;

const canonicalSlabs: RewardSlab[] = [
  { id: "slab_1", minFinalFeePaise: 0, maxFinalFeePaise: 999999, cashRewardPaise: 50000, courseCreditPaise: 75000, sortOrder: 10 },
  { id: "slab_2", minFinalFeePaise: 1000000, maxFinalFeePaise: 1999999, cashRewardPaise: 75000, courseCreditPaise: 100000, sortOrder: 20 },
  { id: "slab_3", minFinalFeePaise: 2000000, maxFinalFeePaise: 2999999, cashRewardPaise: 100000, courseCreditPaise: 150000, sortOrder: 30 },
  { id: "slab_4", minFinalFeePaise: 3000000, maxFinalFeePaise: null, cashRewardPaise: 150000, courseCreditPaise: 200000, sortOrder: 40 },
];

describe("D1 referral foundation migration", () => {
  it("applies through 0012 and creates the canonical programme and reward slabs", () => {
    const db = testDb();

    expect(row(db, "select code, name, validity_days, minimum_fee_percentage, status from referral_programmes where id = 'rprog_samyak_skill_circle'")).toMatchObject({
      code: "samyak_skill_circle",
      name: "Samyak Skill Circle",
      validity_days: 90,
      minimum_fee_percentage: 50,
      status: "active",
    });
    expect(all(db, "select referrer_type from referral_programme_referrer_types where referral_programme_id = 'rprog_samyak_skill_circle' order by referrer_type")).toEqual([
      { referrer_type: "alumni" },
      { referrer_type: "student" },
    ]);
    expect(row(db, "select version, status from referral_reward_rule_sets where id = 'rrs_samyak_skill_circle_v1'")).toMatchObject({
      version: 1,
      status: "active",
    });
    expect(all(db, "select cash_reward_paise, course_credit_paise from referral_reward_slabs order by sort_order")).toEqual([
      { cash_reward_paise: 50000, course_credit_paise: 75000 },
      { cash_reward_paise: 75000, course_credit_paise: 100000 },
      { cash_reward_paise: 100000, course_credit_paise: 150000 },
      { cash_reward_paise: 150000, course_credit_paise: 200000 },
    ]);
    db.close();
  });

  it("leaves other organisations untouched by canonical referral defaults", () => {
    const db = new DatabaseSync(":memory:");
    applyMigrations(db, "0011_admission_configuration_defaults.sql");
    seedOrganisation(db, "org_other");
    applyMigrationFile(db, "0012_d1_referral_foundation.sql");

    expect(count(db, "referral_programmes where organisation_id = 'org_other'")).toBe(0);
    expect(count(db, "referral_programme_referrer_types")).toBe(0);
    expect(count(db, "referral_reward_rule_sets where organisation_id = 'org_other'")).toBe(0);
    db.close();
  });

  it("keeps canonical seed data idempotent when defaults are run again", () => {
    const db = testDb();

    applySeedOnlyStatements(db);

    expect(count(db, "referral_programmes where organisation_id = 'org_samyak' and code = 'samyak_skill_circle'")).toBe(1);
    expect(count(db, "referral_programme_referrer_types where referral_programme_id = 'rprog_samyak_skill_circle'")).toBe(2);
    expect(count(db, "referral_reward_rule_sets where referral_programme_id = 'rprog_samyak_skill_circle'")).toBe(1);
    expect(count(db, "referral_reward_slabs where reward_rule_set_id = 'rrs_samyak_skill_circle_v1'")).toBe(4);
    db.close();
  });

  it("rejects unsupported and duplicate programme referrer type eligibility rows", () => {
    const db = testDb();

    expect(() =>
      db.prepare("insert into referral_programme_referrer_types (referral_programme_id, referrer_type, created_at) values ('rprog_samyak_skill_circle', 'institute_partner', '2026-08-05T00:00:00.000Z')").run(),
    ).toThrow();
    expect(() =>
      db.prepare("insert into referral_programme_referrer_types (referral_programme_id, referrer_type, created_at) values ('rprog_samyak_skill_circle', 'student', '2026-08-05T00:00:00.000Z')").run(),
    ).toThrow();
    db.close();
  });

  it("enforces token hash uniqueness and stores no raw token or public URL column in referral_links", () => {
    const db = testDb();
    seedPersonAndReferrer(db);

    insertReferralLink(db, "link_one", "hash_same", "1111");
    expect(() => insertReferralLink(db, "link_two", "hash_same", "2222")).toThrow();
    expect(columns(db, "referral_links")).not.toEqual(expect.arrayContaining(["token", "raw_token", "personal_link", "public_url"]));
    db.close();
  });

  it("enforces one enquiry attribution across referrals", () => {
    const db = testDb();
    seedPersonAndReferrer(db);
    seedCourse(db);
    seedEnquiry(db, "enq_one");
    insertReferralLink(db, "link_one", "hash_one", "1111");
    insertReferral(db, "ref_one", "link_one", "enq_one");

    expect(() => insertReferral(db, "ref_two", "link_one", "enq_one")).toThrow();
    db.close();
  });

  it("keeps referral creation/linking idempotent by organisation idempotency key", () => {
    const db = testDb();
    seedPersonAndReferrer(db);
    seedCourse(db);
    seedEnquiry(db, "enq_one");
    insertReferralLink(db, "link_one", "hash_one", "1111");
    insertReferral(db, "ref_one", "link_one", "enq_one", "idem_hash");

    expect(() => insertReferral(db, "ref_retry", "link_one", "enq_one", "idem_hash")).toThrow();
    expect(count(db, "referrals where idempotency_key_hash = 'idem_hash'")).toBe(1);
    db.close();
  });

  it("does not add an enquiries.referral_id mirror column", () => {
    const db = testDb();

    expect(columns(db, "enquiries")).not.toContain("referral_id");
    expect(columns(db, "referrals")).toContain("enquiry_id");
    db.close();
  });

  it("exposes the expected indexes and foreign keys for lookup-heavy paths", () => {
    const db = testDb();
    const indexNames = all(db, "select name from sqlite_master where type = 'index'").map((item) => String(item.name));

    expect(indexNames).toEqual(expect.arrayContaining([
      "referral_links_organisation_token_hash_unique",
      "referral_programme_referrer_types_programme_idx",
      "referral_programme_referrer_types_type_idx",
      "referrals_mobile_status_valid_idx",
      "referrals_referrer_submitted_idx",
      "referrals_branch_status_idx",
      "referrals_enquiry_id_idx",
      "referrals_enquiry_unique",
      "referrals_valid_until_idx",
      "enrolments_referral_id_idx",
      "enrolments_referrer_profile_id_idx",
      "referral_reward_snapshots_enrolment_idx",
    ]));
    expect(foreignKeys(db, "referrals")).toEqual(expect.arrayContaining(["organisations", "branches", "referral_programmes", "referral_links", "referrer_profiles", "enquiries"]));
    expect(foreignKeys(db, "enrolments")).toContain("referrals");
    db.close();
  });

  it("rejects duplicate active reward-rule sets in SQLite", () => {
    const db = testDb();
    expect(() =>
      db.prepare(
        `insert into referral_reward_rule_sets
          (id, organisation_id, referral_programme_id, version, name, status, created_at, updated_at)
         values ('rrs_second_active', 'org_samyak', 'rprog_samyak_skill_circle', 2, 'Second active', 'active', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
      ).run(),
    ).toThrow();
    db.close();
  });
});

describe("referral domain helpers", () => {
  it("calculates referral validity dates without mutating the submission time", () => {
    expect(calculateReferralValidUntil("2026-08-05T10:00:00.000Z", 90)).toBe("2026-11-03T10:00:00.000Z");
    expect(() => calculateReferralValidUntil("2026-08-05T10:00:00.000Z", 0)).toThrow("Invalid referral validity days");
  });

  it("blocks duplicate mobile hashes only for active unexpired referrals", () => {
    const now = "2026-08-05T10:00:00.000Z";
    const referrals = [
      { prospectMobileHash: "hash_a", status: "accepted" as const, validUntil: "2026-08-06T00:00:00.000Z" },
      { prospectMobileHash: "hash_b", status: "accepted" as const, validUntil: "2026-08-04T00:00:00.000Z" },
      { prospectMobileHash: "hash_c", status: "rejected" as const, validUntil: "2026-08-06T00:00:00.000Z" },
    ];

    expect(findActiveDuplicateReferral(referrals, "hash_a", now)).toBe(referrals[0]);
    expect(findActiveDuplicateReferral(referrals, "hash_b", now)).toBeNull();
    expect(findActiveDuplicateReferral(referrals, "hash_c", now)).toBeNull();
  });

  it.each([
    [999999, "slab_1", 50000, 75000],
    [1000000, "slab_2", 75000, 100000],
    [1999999, "slab_2", 75000, 100000],
    [2000000, "slab_3", 100000, 150000],
    [2999999, "slab_3", 100000, 150000],
    [3000000, "slab_4", 150000, 200000],
  ])("selects the expected reward slab for %s paise", (fee, slabId, cash, credit) => {
    expect(selectRewardSlab(canonicalSlabs, fee)).toMatchObject({ id: slabId, cashRewardPaise: cash, courseCreditPaise: credit });
  });

  it("calculates the 50 percent minimum qualifying payment in paise", () => {
    expect(calculateMinimumQualifyingPaymentPaise(3500000, 50)).toBe(1750000);
    expect(calculateMinimumQualifyingPaymentPaise(1, 50)).toBe(1);
  });

  it("rejects overlapping reward slabs at service level", () => {
    expect(validateRewardSlabNonOverlap(canonicalSlabs)).toMatchObject({ ok: true, errors: [] });
    expect(validateRewardSlabNonOverlap([...canonicalSlabs, { id: "overlap", minFinalFeePaise: 999999, maxFinalFeePaise: 1200000, cashRewardPaise: 1, courseCreditPaise: 1, sortOrder: 15 }])).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringContaining("overlaps")]),
    });
  });

  it("maps public-safe statuses without exposing rejection reasons", () => {
    expect(publicSafeReferralStatus("submitted")).toBe("Enquiry Received");
    expect(publicSafeReferralStatus("active")).toBe("Enquiry Received");
    expect(publicSafeReferralStatus("converted")).toBe("Admission Confirmed");
    expect(publicSafeReferralStatus("rejected")).toBe("Closed");
  });

  it("allows only the conservative referral status transitions", () => {
    expect(canTransitionReferralStatus("submitted", "accepted")).toBe(true);
    expect(canTransitionReferralStatus("active", "converted")).toBe(true);
    expect(canTransitionReferralStatus("closed", "active")).toBe(false);
    expect(() => assertReferralStatusTransition("submitted", "converted")).toThrow("Invalid referral status transition");
  });

  it("uses keyed HMAC for referral token lookup and keeps only support-safe last four", async () => {
    const rawToken = "token_ABCD1234567890abcdEFGHijklMNOP";
    const first = await referralTokenLookupHash("secret-referral-pepper", rawToken);
    const second = await referralTokenLookupHash("secret-referral-pepper", rawToken);

    expect(first).toBe(second);
    expect(first).not.toContain(rawToken);
    expect(referralTokenLastFour(rawToken)).toBe("MNOP");
    await expect(referralTokenLookupHash("secret", "short")).rejects.toThrow("Invalid referral token shape");
  });

  it.each([
    [{ mobileValid: false, consentRecorded: true, linkValid: true, programmeActive: true, courseEligible: true, hasActiveDuplicate: false }, "invalid_mobile"],
    [{ mobileValid: true, consentRecorded: true, linkValid: true, programmeActive: true, courseEligible: true, existingRecordType: "existing_enquiry", hasActiveDuplicate: false }, "existing_enquiry"],
    [{ mobileValid: true, consentRecorded: true, linkValid: true, programmeActive: true, courseEligible: true, existingRecordType: "current_student", hasActiveDuplicate: false }, "current_student"],
    [{ mobileValid: true, consentRecorded: true, linkValid: true, programmeActive: true, courseEligible: true, existingRecordType: "former_student", hasActiveDuplicate: false }, "former_student"],
  ] as const)("classifies prospect rejection as %s", (input, expected) => {
    expect(classifyProspectRejection(input)).toBe(expected);
  });

  it("rejects cross-organisation and mismatched link relationships at service level", () => {
    expect(
      validateReferralRelationshipScope({
        referralOrganisationId: "org_samyak",
        branchOrganisationId: "org_samyak",
        programmeOrganisationId: "org_samyak",
        linkOrganisationId: "org_samyak",
        linkProgrammeId: "programme_one",
        referrerProfileOrganisationId: "org_samyak",
        referrerProfileId: "profile_one",
        linkReferrerProfileId: "profile_one",
        referralProgrammeId: "programme_one",
      }),
    ).toMatchObject({ ok: true });

    expect(
      validateReferralRelationshipScope({
        referralOrganisationId: "org_samyak",
        branchOrganisationId: "org_other",
        programmeOrganisationId: "org_samyak",
        linkOrganisationId: "org_samyak",
        linkProgrammeId: "programme_two",
        referrerProfileOrganisationId: "org_samyak",
        referrerProfileId: "profile_one",
        linkReferrerProfileId: "profile_two",
        referralProgrammeId: "programme_one",
      }).errors,
    ).toEqual(["branch_organisation_mismatch", "link_programme_mismatch", "link_referrer_profile_mismatch"]);
  });

  it("rejects sensitive fields in reward snapshot JSON", () => {
    expect(() => assertSnapshotJsonSafe(JSON.stringify({ finalAgreedFeePaise: 3500000, cashRewardPaise: 75000 }))).not.toThrow();
    expect(() => assertSnapshotJsonSafe(JSON.stringify({ finalAgreedFeePaise: 3500000, prospectMobile: "9999999999" }))).toThrow("sensitive field");
    expect(() => assertSnapshotJsonSafe(JSON.stringify({ reward: { upiReference: "hidden" } }))).toThrow("sensitive field");
  });
});

function testDb() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  seedOrganisation(db, "org_samyak");
  applyMigrationFile(db, "0012_d1_referral_foundation.sql");
  applyMigrationFile(db, "0013_referral_service_integrity.sql");
  return db;
}

function applyMigrations(db: DatabaseSync, throughFile?: string) {
  const migrationsDir = join(process.cwd(), "migrations");
  for (const file of readdirSync(migrationsDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    if (file === "0012_d1_referral_foundation.sql" || file === "0013_referral_service_integrity.sql" || file === "0014_course_master_and_referral_courses.sql") continue;
    if (throughFile && file > throughFile) continue;
    applyMigrationFile(db, file);
  }
}

function applyMigrationFile(db: DatabaseSync, file: string) {
  const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}

function applySeedOnlyStatements(db: DatabaseSync) {
  const sql = readFileSync(join(process.cwd(), "migrations", "0012_d1_referral_foundation.sql"), "utf8");
  const statements = sql.split("--> statement-breakpoint").map((part) => part.trim()).filter((statement) => statement.startsWith("WITH programme_defaults") || statement.startsWith("WITH referrer_type_defaults") || statement.startsWith("WITH rule_defaults") || statement.startsWith("WITH slab_defaults"));
  for (const statement of statements) db.exec(statement);
}

function seedOrganisation(db: DatabaseSync, id: string) {
  db.prepare(
    `insert into organisations (id, name, slug, status, created_at, updated_at)
     values (?, ?, ?, 'active', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
  ).run(id, id, id);
  if (id === "org_samyak") {
    db.prepare(
      `insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
       values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
    ).run();
  }
}

function seedPersonAndReferrer(db: DatabaseSync) {
  db.exec(`
    insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at)
    values ('person_referrer', 'org_samyak', 'branch_sion', 'Asha Referrer', 'Asha R.', 'active', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
    insert into referrer_profiles
      (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at)
    values ('refprof_one', 'org_samyak', 'person_referrer', 'LEGACY-1', 'legacy-token', 'https://go.samyaksion.com/r/legacy-token', 1, '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
  `);
}

function seedCourse(db: DatabaseSync) {
  db.prepare(
    `insert into courses
       (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
     values ('course_full_stack', 'org_samyak', 'FSD', 'Full Stack Development', '6 months', 6, 5000000, 4000000, 1, 1, 'active', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
  ).run();
}

function seedEnquiry(db: DatabaseSync, id: string) {
  db.prepare(
    `insert into enquiries
      (id, organisation_id, branch_id, enquiry_number, mobile_used, course_interest_id, source, status, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', ?, 'mobile_hash', 'course_full_stack', 'walk_in', 'new', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
  ).run(id, id.toUpperCase());
}

function insertReferralLink(db: DatabaseSync, id: string, tokenHash: string, lastFour: string) {
  db.prepare(
    `insert into referral_links
      (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four, link_version, status, activated_at, created_at, updated_at)
     values (?, 'org_samyak', 'rprog_samyak_skill_circle', 'refprof_one', ?, ?, 1, 'active', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
  ).run(id, tokenHash, lastFour);
}

function insertReferral(db: DatabaseSync, id: string, linkId: string, enquiryId: string, idempotencyKeyHash: string | null = null) {
  db.prepare(
    `insert into referrals
      (id, organisation_id, branch_id, referral_programme_id, referral_link_id, referrer_profile_id, enquiry_id, course_interest_id, source, status, submitted_at, valid_until, prospect_name, prospect_mobile_hash, prospect_mobile_last_four, consent_recorded_at, idempotency_key_hash, created_at, updated_at)
     values (?, 'org_samyak', 'branch_sion', 'rprog_samyak_skill_circle', ?, 'refprof_one', ?, 'course_full_stack', 'personal_link', 'accepted', '2026-08-05T00:00:00.000Z', '2026-11-03T00:00:00.000Z', 'Prospect Name', 'mobile_hash', '1234', '2026-08-05T00:00:00.000Z', ?, '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z')`,
  ).run(id, linkId, enquiryId, idempotencyKeyHash);
}

function row(db: DatabaseSync, sql: string) {
  return db.prepare(sql).get() as Row | undefined;
}

function all(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Row[];
}

function count(db: DatabaseSync, tableOrSql: string) {
  const source = tableOrSql.trim().toLowerCase().startsWith("select") ? `(${tableOrSql})` : tableOrSql;
  return Number(row(db, `select count(*) as count from ${source}`)?.count || 0);
}

function columns(db: DatabaseSync, tableName: string) {
  return all(db, `pragma table_info(${tableName})`).map((item) => String(item.name));
}

function foreignKeys(db: DatabaseSync, tableName: string) {
  return all(db, `pragma foreign_key_list(${tableName})`).map((item) => String(item.table));
}
