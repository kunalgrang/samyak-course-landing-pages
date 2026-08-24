import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const migrationsDir = join(root, "migrations");
const workRoot = join(root, ".tmp", "d1-0021-local-check");
const databaseName = "samyak-student-portal";
const wranglerBin = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const migration0021 = readFileSync(join(migrationsDir, "0021_education_partner_referrals_v1.sql"), "utf8");
const oldMigration0021 = migration0021
  .replace("PRAGMA defer_foreign_keys=ON;", "PRAGMA foreign_keys=OFF;")
  .replace("PRAGMA defer_foreign_keys=OFF;", "PRAGMA foreign_keys=ON;");

const productionShapeSeed = `
insert into organisations (id, name, slug, status, created_at, updated_at) values ('org_samyak', 'Samyak', 'samyak', 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into roles (id, organisation_id, code, name, created_at) values ('role_student', 'org_samyak', 'student', 'Student', '2026-08-24T00:00:00.000Z');
insert into roles (id, organisation_id, code, name, created_at) values ('role_alumni', 'org_samyak', 'alumni', 'Alumni', '2026-08-24T00:00:00.000Z');
insert into roles (id, organisation_id, code, name, created_at) values ('role_owner', 'org_samyak', 'owner', 'Owner', '2026-08-24T00:00:00.000Z');
insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at) values ('acct_owner', 'org_samyak', 'owner_hash', 'owner_hash', '0000', 1, 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into referral_programmes (id, organisation_id, code, name, validity_days, minimum_fee_percentage, status, starts_at, ends_at, created_at, updated_at) values ('rprog_samyak_skill_circle', 'org_samyak', 'samyak_skill_circle', 'Samyak Skill Circle', 90, 50, 'active', '2026-08-05T00:00:00.000Z', null, '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
insert into referral_programme_referrer_types (referral_programme_id, referrer_type, created_at) values ('rprog_samyak_skill_circle', 'student', '2026-08-05T00:00:00.000Z');
insert into referral_programme_referrer_types (referral_programme_id, referrer_type, created_at) values ('rprog_samyak_skill_circle', 'alumni', '2026-08-05T00:00:00.000Z');
insert into referral_reward_rule_sets (id, organisation_id, referral_programme_id, version, name, status, effective_from, effective_until, created_by_login_account_id, created_at, updated_at) values ('rrs_samyak_skill_circle_v1', 'org_samyak', 'rprog_samyak_skill_circle', 1, 'Samyak Skill Circle Rewards v1', 'active', '2026-08-05T00:00:00.000Z', null, null, '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
insert into referral_reward_slabs (id, reward_rule_set_id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order, created_at, updated_at) values ('rrs_samyak_skill_circle_v1_slab_1', 'rrs_samyak_skill_circle_v1', 0, 999999, 50000, 75000, 10, '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
insert into referral_reward_slabs (id, reward_rule_set_id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order, created_at, updated_at) values ('rrs_samyak_skill_circle_v1_slab_2', 'rrs_samyak_skill_circle_v1', 1000000, 1999999, 75000, 100000, 20, '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
insert into referral_reward_slabs (id, reward_rule_set_id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order, created_at, updated_at) values ('rrs_samyak_skill_circle_v1_slab_3', 'rrs_samyak_skill_circle_v1', 2000000, 2999999, 100000, 150000, 30, '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
insert into referral_reward_slabs (id, reward_rule_set_id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order, created_at, updated_at) values ('rrs_samyak_skill_circle_v1_slab_4', 'rrs_samyak_skill_circle_v1', 3000000, null, 150000, 200000, 40, '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z');
insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_student_ref', 'org_samyak', 'branch_sion', 'Student Referrer', 'Student Referrer', 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_alumni_ref', 'org_samyak', 'branch_sion', 'Alumni Referrer', 'Alumni Referrer', 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into person_roles (person_id, role_id, branch_id, branch_key, created_at) values ('person_student_ref', 'role_student', null, '', '2026-08-24T00:00:00.000Z');
insert into person_roles (person_id, role_id, branch_id, branch_key, created_at) values ('person_alumni_ref', 'role_alumni', null, '', '2026-08-24T00:00:00.000Z');
insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values ('refprof_student_preserve', 'org_samyak', 'person_student_ref', 'STUDENT-PRESERVE', 'legacy-student', 'https://go/r/student', 1, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values ('refprof_alumni_preserve', 'org_samyak', 'person_alumni_ref', 'ALUMNI-PRESERVE', 'legacy-alumni', 'https://go/r/alumni', 1, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into courses (id, organisation_id, code, name, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at) values ('course_preserve', 'org_samyak', 'FSD', 'Full Stack', '6 months', 6, 5000000, 4000000, 1, 1, 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into referral_programme_courses (referral_programme_id, course_id, is_active, created_at, updated_at) values ('rprog_samyak_skill_circle', 'course_preserve', 1, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into enquiries (id, organisation_id, branch_id, enquiry_number, mobile_used, course_interest_id, source, status, created_at, updated_at) values ('enq_preserve', 'org_samyak', 'branch_sion', 'ENQ-PRESERVE', 'mobile_hash', 'course_preserve', 'referral', 'new', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into referral_links (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four, link_version, status, activated_at, created_at, updated_at) values ('link_student_preserve', 'org_samyak', 'rprog_samyak_skill_circle', 'refprof_student_preserve', 'hash_student', '1111', 1, 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into referral_links (id, organisation_id, referral_programme_id, referrer_profile_id, token_hash, token_last_four, link_version, status, activated_at, created_at, updated_at) values ('link_alumni_preserve', 'org_samyak', 'rprog_samyak_skill_circle', 'refprof_alumni_preserve', 'hash_alumni', '2222', 1, 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into referrals (id, organisation_id, branch_id, referral_programme_id, referral_link_id, referrer_profile_id, enquiry_id, course_interest_id, source, status, submitted_at, valid_until, attributed_at, prospect_name, prospect_mobile_hash, prospect_mobile_last_four, consent_recorded_at, created_at, updated_at) values ('ref_preserve', 'org_samyak', 'branch_sion', 'rprog_samyak_skill_circle', 'link_student_preserve', 'refprof_student_preserve', 'enq_preserve', 'course_preserve', 'personal_link', 'converted', '2026-08-24T00:00:00.000Z', '2026-11-22T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 'Preserve Prospect', 'prospect_hash', '1234', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values ('person_admitted', 'org_samyak', 'branch_sion', 'Admitted Student', 'Admitted Student', 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into students (id, organisation_id, person_id, home_branch_id, student_number, sequence_number, student_since, current_status, portal_status, created_at, updated_at) values ('student_admitted', 'org_samyak', 'person_admitted', 'branch_sion', 'STU-PRESERVE', 9001, '2026-08-24T00:00:00.000Z', 'active', 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into enrolments (id, student_id, branch_id, course_id, enquiry_id, enrolment_number, training_mode, admission_date, joining_date, status, nsdc_preference, referrer_profile_id, referral_id, created_at, updated_at) values ('enrol_preserve', 'student_admitted', 'branch_sion', 'course_preserve', 'enq_preserve', 'ENR-PRESERVE', 'classroom', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 'active', 'decide_later', 'refprof_student_preserve', 'ref_preserve', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into fee_agreements (id, enrolment_id, standard_fee_paise, final_agreed_fee_paise, discount_paise, gst_rate_basis_points, payment_plan_type, number_of_instalments, initial_payment_expected_paise, status, created_at, updated_at) values ('fee_preserve', 'enrol_preserve', 1000000, 900000, 100000, 0, 'single', 1, 450000, 'active', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into referral_reward_snapshots (id, referral_id, enrolment_id, fee_agreement_id, reward_rule_set_id, slab_id, final_agreed_fee_paise, minimum_fee_percentage, minimum_qualifying_payment_paise, cash_reward_paise, course_credit_paise, snapshot_version, snapshot_json, status, approved_by_login_account_id, approved_at, created_at) values ('reward_preserve', 'ref_preserve', 'enrol_preserve', 'fee_preserve', 'rrs_samyak_skill_circle_v1', null, 900000, 50, 450000, 10000, 5000, 1, '{}', 'approved', 'acct_owner', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into referral_reward_payouts (id, organisation_id, branch_id, reward_snapshot_id, referral_id, amount_paise, payment_date, payment_mode, payment_reference, notes, status, paid_by_login_account_id, idempotency_key, payload_fingerprint, created_at, updated_at) values ('payout_preserve', 'org_samyak', 'branch_sion', 'reward_preserve', 'ref_preserve', 10000, '2026-08-24', 'cash', null, null, 'paid', 'acct_owner', 'idem-payout-preserve', 'fingerprint-payout-preserve', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
`;

const assertionsSql = `
select 'referrer_profiles' as key, count(*) as value from referrer_profiles;
select 'referrer_profiles_null_person' as key, count(*) as value from referrer_profiles where person_id is null;
select 'student_person' as key, person_id as value from referrer_profiles where id = 'refprof_student_preserve';
select 'alumni_person' as key, person_id as value from referrer_profiles where id = 'refprof_alumni_preserve';
select 'links' as key, count(*) as value from referral_links where id in ('link_student_preserve', 'link_alumni_preserve');
select 'link_referrer' as key, referrer_profile_id as value from referral_links where id = 'link_student_preserve';
select 'referrals' as key, count(*) as value from referrals where id = 'ref_preserve';
select 'referral_referrer' as key, referrer_profile_id as value from referrals where id = 'ref_preserve';
select 'enrolment_referrer' as key, referrer_profile_id as value from enrolments where id = 'enrol_preserve';
select 'enrolment_referral' as key, referral_id as value from enrolments where id = 'enrol_preserve';
select 'reward_snapshots' as key, count(*) as value from referral_reward_snapshots where id = 'reward_preserve';
select 'payouts' as key, count(*) as value from referral_reward_payouts where id = 'payout_preserve';
select 'skill_circle_programmes' as key, count(*) as value from referral_programmes where id = 'rprog_samyak_skill_circle' and code = 'samyak_skill_circle' and status = 'active';
select 'skill_circle_types' as key, count(*) as value from referral_programme_referrer_types where referral_programme_id = 'rprog_samyak_skill_circle' and referrer_type in ('student', 'alumni');
select 'skill_circle_rule_model' as key, reward_model_type as value from referral_reward_rule_sets where id = 'rrs_samyak_skill_circle_v1';
select 'skill_circle_slabs' as key, count(*) as value from referral_reward_slabs where reward_rule_set_id = 'rrs_samyak_skill_circle_v1';
select 'education_partner_programmes' as key, count(*) as value from referral_programmes where id = 'rprog_samyak_education_partners' and status = 'active';
select 'education_partner_type' as key, count(*) as value from referral_programme_referrer_types where referral_programme_id = 'rprog_samyak_education_partners' and referrer_type = 'education_partner';
select 'education_partner_rule_model' as key, reward_model_type as value from referral_reward_rule_sets where id = 'rrs_samyak_education_partners_v1';
select 'education_partners' as key, count(*) as value from education_partners;
select 'partner_bridge_indexes' as key, count(*) as value from sqlite_master where type = 'index' and name in ('education_partner_referrer_profiles_profile_unique', 'education_partner_referrer_profiles_partner_unique');
select 'partner_triggers' as key, count(*) as value from sqlite_master where type = 'trigger' and name in ('education_partner_bridge_personless_insert_check', 'referrer_profiles_partner_person_update_check', 'referrals_partner_snapshot_insert_check', 'referrals_partner_snapshot_update_check', 'referral_reward_snapshots_model_insert_check', 'referral_reward_snapshots_model_update_check');
select 'cheque_supported' as key, count(*) as value from sqlite_master where type = 'table' and name = 'referral_reward_payouts' and sql like '%cheque%';
select 'payout_unique_indexes' as key, count(*) as value from sqlite_master where type = 'index' and name in ('referral_reward_payouts_reward_unique', 'referral_reward_payouts_idempotency_unique');
select 'fk_violations' as key, count(*) as value from pragma_foreign_key_check;
`;

const invariantsSql = `
insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values ('refprof_partner_null_ok', 'org_samyak', null, 'education_partner:null-ok', 'partner-null-ok', '', 1, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into education_partners (id, organisation_id, home_branch_id, partner_type, business_name, contact_person_name, status, current_commission_basis_points, created_at, updated_at) values ('epartner_local', 'org_samyak', 'branch_sion', 'college', 'Local Partner', 'Partner Owner', 'active', 1000, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
insert into education_partner_referrer_profiles (education_partner_id, referrer_profile_id, created_at) values ('epartner_local', 'refprof_partner_null_ok', '2026-08-24T00:00:00.000Z');
`;

const negativeDeferredFkMigration = `
PRAGMA defer_foreign_keys=ON;
DROP TABLE referrer_profiles;
`;

rmSync(workRoot, { recursive: true, force: true });
mkdirSync(workRoot, { recursive: true });

const results = {
  oldFailureReproduced: false,
  freshCorrected: false,
  productionShapeCorrected: false,
  deferredFkNegative: false,
  corrected: {},
};

runFreshCorrected();
runOldFailure();
runProductionShapeCorrected();
runDeferredFkNegative();

console.log(JSON.stringify(results, null, 2));
if (!process.env.KEEP_D1_0021_CHECK_TMP) rmSync(workRoot, { recursive: true, force: true });

function runFreshCorrected() {
  const project = prepareProject("fresh-corrected", "corrected");
  wrangler(project, ["d1", "migrations", "apply", databaseName, "--local", "--persist-to", persist(project)]);
  const fk = firstValue(execute(project, "select count(*) as count from pragma_foreign_key_check;"));
  assertEqual(fk, 0, "fresh corrected FK check");
  results.freshCorrected = true;
}

function runOldFailure() {
  const project = prepareProject("old-production-shaped", "through-0020");
  wrangler(project, ["d1", "migrations", "apply", databaseName, "--local", "--persist-to", persist(project)]);
  executeFile(project, writeSql(project, "seed-production-shaped.sql", productionShapeSeed));
  copy0021(project, oldMigration0021);
  try {
    wrangler(project, ["d1", "migrations", "apply", databaseName, "--local", "--persist-to", persist(project)]);
  } catch (error) {
    results.oldFailureReproduced = String(error.stdout || "") .includes("FOREIGN KEY constraint failed")
      || String(error.stderr || "").includes("FOREIGN KEY constraint failed")
      || String(error.message).includes("FOREIGN KEY constraint failed");
  }
  assertEqual(results.oldFailureReproduced, true, "old migration should fail under local D1");
}

function runProductionShapeCorrected() {
  const project = prepareProject("production-shaped-corrected", "through-0020");
  wrangler(project, ["d1", "migrations", "apply", databaseName, "--local", "--persist-to", persist(project)]);
  executeFile(project, writeSql(project, "seed-production-shaped.sql", productionShapeSeed));
  const before = keyValues(execute(project, `
select 'referrer_profiles' as key, count(*) as value from referrer_profiles;
select 'links' as key, count(*) as value from referral_links;
select 'referrals' as key, count(*) as value from referrals;
select 'reward_snapshots' as key, count(*) as value from referral_reward_snapshots;
select 'payouts' as key, count(*) as value from referral_reward_payouts;
  `));
  copy0021(project, migration0021);
  wrangler(project, ["d1", "migrations", "apply", databaseName, "--local", "--persist-to", persist(project)]);
  const after = keyValues(execute(project, assertionsSql));
  assertEqual(after.referrer_profiles, before.referrer_profiles, "referrer profile count preserved");
  assertEqual(after.links, before.links, "links count preserved");
  assertEqual(after.referrals, before.referrals, "referrals count preserved");
  assertEqual(after.reward_snapshots, before.reward_snapshots, "reward snapshot count preserved");
  assertEqual(after.payouts, before.payouts, "payout count preserved");
  assertEqual(after.referrer_profiles_null_person, 0, "existing referrer profiles remain person-backed");
  assertEqual(after.student_person, "person_student_ref", "student person_id preserved");
  assertEqual(after.alumni_person, "person_alumni_ref", "alumni person_id preserved");
  assertEqual(after.link_referrer, "refprof_student_preserve", "link referrer preserved");
  assertEqual(after.referral_referrer, "refprof_student_preserve", "referral referrer preserved");
  assertEqual(after.enrolment_referrer, "refprof_student_preserve", "enrolment referrer preserved");
  assertEqual(after.enrolment_referral, "ref_preserve", "enrolment referral preserved");
  assertEqual(after.skill_circle_programmes, 1, "Skill Circle preserved");
  assertEqual(after.skill_circle_types, 2, "student/alumni types preserved");
  assertEqual(after.skill_circle_rule_model, "fee_slab", "Skill Circle model");
  assertEqual(after.skill_circle_slabs, 4, "slabs preserved");
  assertEqual(after.education_partner_programmes, 1, "Partner programme seeded");
  assertEqual(after.education_partner_type, 1, "Partner type seeded");
  assertEqual(after.education_partner_rule_model, "partner_percentage", "Partner model seeded");
  assertEqual(after.education_partners, 0, "No partners fabricated");
  assertEqual(after.partner_bridge_indexes, 2, "Partner bridge indexes");
  assertEqual(after.partner_triggers, 6, "Partner/reward triggers");
  assertEqual(after.cheque_supported, 1, "cheque payout support");
  assertEqual(after.payout_unique_indexes, 2, "payout uniqueness");
  assertEqual(after.fk_violations, 0, "post-migration FK check");
  executeFile(project, writeSql(project, "partner-invariants.sql", invariantsSql));
  let personBackedRejected = false;
  try {
    execute(project, "insert into education_partner_referrer_profiles (education_partner_id, referrer_profile_id, created_at) values ('epartner_local', 'refprof_student_preserve', '2026-08-24T00:00:00.000Z');");
  } catch {
    personBackedRejected = true;
  }
  assertEqual(personBackedRejected, true, "person-backed partner bridge rejected");
  const fkLists = {
    referral_links: execute(project, "pragma foreign_key_list(referral_links);")[0].results.map((row) => row.table),
    referrals: execute(project, "pragma foreign_key_list(referrals);")[0].results.map((row) => row.table),
    enrolments: execute(project, "pragma foreign_key_list(enrolments);")[0].results.map((row) => row.table),
    education_partner_referrer_profiles: execute(project, "pragma foreign_key_list(education_partner_referrer_profiles);")[0].results.map((row) => row.table),
    referral_reward_payouts: execute(project, "pragma foreign_key_list(referral_reward_payouts);")[0].results.map((row) => row.table),
  };
  assertEqual(fkLists.referral_links.includes("referrer_profiles"), true, "referral_links FK target");
  assertEqual(fkLists.referrals.includes("referrer_profiles"), true, "referrals FK target");
  assertEqual(fkLists.education_partner_referrer_profiles.includes("referrer_profiles"), true, "partner bridge FK target");
  results.corrected = { before, after, fkLists };
  results.productionShapeCorrected = true;
}

function runDeferredFkNegative() {
  const project = prepareProject("deferred-fk-negative", "through-0020");
  wrangler(project, ["d1", "migrations", "apply", databaseName, "--local", "--persist-to", persist(project)]);
  executeFile(project, writeSql(project, "seed-production-shaped.sql", productionShapeSeed));
  copy0021(project, negativeDeferredFkMigration);
  try {
    wrangler(project, ["d1", "migrations", "apply", databaseName, "--local", "--persist-to", persist(project)]);
  } catch (error) {
    results.deferredFkNegative = String(error.stdout || "").includes("FOREIGN KEY constraint failed")
      || String(error.stderr || "").includes("FOREIGN KEY constraint failed")
      || String(error.message).includes("FOREIGN KEY constraint failed");
  }
  assertEqual(results.deferredFkNegative, true, "unresolved deferred FK violation rejected");
}

function prepareProject(name, mode) {
  const project = join(workRoot, name);
  const projectMigrations = join(project, "migrations");
  mkdirSync(projectMigrations, { recursive: true });
  writeFileSync(join(project, "wrangler.jsonc"), JSON.stringify({
    name: "d1-0021-local-check",
    compatibility_date: "2026-07-21",
    d1_databases: [{ binding: "DB", database_name: databaseName, database_id: "00000000-0000-0000-0000-000000000021" }],
  }, null, 2));
  const files = readdirSync(migrationsDir).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    if (file === "0021_education_partner_referrals_v1.sql") continue;
    if (mode === "through-0020" && file > "0020_referral_reward_payout_v1.sql") continue;
    copyFileSync(join(migrationsDir, file), join(projectMigrations, file));
  }
  if (mode === "corrected") copy0021(project, migration0021);
  return project;
}

function copy0021(project, contents) {
  writeFileSync(join(project, "migrations", "0021_education_partner_referrals_v1.sql"), contents);
}

function persist(project) {
  return join(project, "persist");
}

function wrangler(project, args) {
  return execFileSync(process.execPath, [wranglerBin, "--cwd", project, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function execute(project, sql) {
  const output = wrangler(project, ["d1", "execute", databaseName, "--local", "--persist-to", persist(project), "--json", "--command", sql]);
  return JSON.parse(output);
}

function executeFile(project, file) {
  wrangler(project, ["d1", "execute", databaseName, "--local", "--persist-to", persist(project), "--file", file]);
}

function writeSql(project, name, sql) {
  const file = resolve(project, name);
  writeFileSync(file, sql);
  return file;
}

function firstValue(results) {
  return Object.values(results[0].results[0])[0];
}

function keyValues(results) {
  const values = {};
  for (const result of results) {
    const row = result.results[0];
    values[row.key] = row.value;
  }
  return values;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
