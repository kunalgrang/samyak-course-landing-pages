import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = join(import.meta.dirname, "..");
const persistTo = mkdtempSync(join(tmpdir(), "samyak-d1-wrangler-"));
const wranglerBin = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

try {
  runWrangler([
    "d1",
    "migrations",
    "apply",
    "samyak-student-portal",
    "--local",
    "--persist-to",
    persistTo,
  ]);

  const schema = query("select name, type from sqlite_master where name in ('class_sessions','attendance_records','session_materials','collection_followups','fee_schedule_revisions','receipt_reversals','global_identities','organisation_memberships','user_sessions_active_subject_type_idx','class_sessions_batch_date_start_unique','attendance_records_session_membership_unique','session_materials_class_session_idx','session_materials_org_session_idx','session_materials_org_trainer_created_idx','person_roles_role_status_branch_idx','collection_followups_org_branch_next_idx','collection_followups_org_enrolment_created_idx','collection_followups_org_promise_idx','fee_schedule_revisions_fee_revision_unique','fee_schedule_revisions_enrolment_created_idx','receipt_reversals_receipt_unique','receipt_reversals_idempotency_unique','receipt_reversals_org_enrolment_created_idx','global_identities_mobile_normalized_unique','global_identities_mobile_hash_idx','organisation_memberships_identity_org_unique','organisation_memberships_login_account_unique','organisation_memberships_org_status_idx','login_accounts_global_identity_id_idx','login_accounts_organisation_membership_id_idx','user_sessions_organisation_membership_id_idx') order by type, name;");
  const columns = query("select name from pragma_table_info('user_sessions') where name = 'active_subject_type';");
  const sessionMembershipColumn = query("select name from pragma_table_info('user_sessions') where name = 'organisation_membership_id';");
  const accountIdentityColumn = query("select name from pragma_table_info('login_accounts') where name = 'global_identity_id';");
  const accountMembershipColumn = query("select name from pragma_table_info('login_accounts') where name = 'organisation_membership_id';");
  const personRoleStatus = query("select name from pragma_table_info('person_roles') where name = 'status';");
  const migrations = query("select name from d1_migrations where name = '0027_trainer_attendance_sessions.sql';");
  const materialMigration = query("select name from d1_migrations where name = '0028_session_materials_student_academic.sql';");
  const trainerManagementMigration = query("select name from d1_migrations where name = '0029_trainer_management_role_status.sql';");
  const collectionsMigration = query("select name from d1_migrations where name = '0030_payments_collections_v2.sql';");
  const scheduleRevisionMigration = query("select name from d1_migrations where name = '0031_fee_schedule_revisions.sql';");
  const receiptReversalMigration = query("select name from d1_migrations where name = '0032_receipt_reversals.sql';");
  const identityMembershipMigration = query("select name from d1_migrations where name = '0033_global_identity_memberships.sql';");
  const subjectTriggers = query("select name from sqlite_master where type = 'trigger' and name like 'user_sessions_active_subject_%';");
  const preconfirmIndex = query("select name from sqlite_master where type = 'index' and name = 'receipts_one_preconfirm_token_per_draft';");

  expectSome(columns, "active_subject_type column");
  expectSome(sessionMembershipColumn, "user_sessions.organisation_membership_id column");
  expectSome(accountIdentityColumn, "login_accounts.global_identity_id column");
  expectSome(accountMembershipColumn, "login_accounts.organisation_membership_id column");
  expectSome(personRoleStatus, "person_roles.status column");
  expectSome(migrations, "0027 migration record");
  expectSome(materialMigration, "0028 migration record");
  expectSome(trainerManagementMigration, "0029 migration record");
  expectSome(collectionsMigration, "0030 migration record");
  expectSome(scheduleRevisionMigration, "0031 migration record");
  expectSome(receiptReversalMigration, "0032 migration record");
  expectSome(identityMembershipMigration, "0033 migration record");
  expectNames(schema, [
    "attendance_records",
    "class_sessions",
    "collection_followups",
    "fee_schedule_revisions",
    "global_identities",
    "organisation_memberships",
    "receipt_reversals",
    "session_materials",
    "attendance_records_session_membership_unique",
    "class_sessions_batch_date_start_unique",
    "collection_followups_org_branch_next_idx",
    "collection_followups_org_enrolment_created_idx",
    "collection_followups_org_promise_idx",
    "fee_schedule_revisions_enrolment_created_idx",
    "fee_schedule_revisions_fee_revision_unique",
    "receipt_reversals_idempotency_unique",
    "receipt_reversals_org_enrolment_created_idx",
    "receipt_reversals_receipt_unique",
    "global_identities_mobile_hash_idx",
    "global_identities_mobile_normalized_unique",
    "login_accounts_global_identity_id_idx",
    "login_accounts_organisation_membership_id_idx",
    "organisation_memberships_identity_org_unique",
    "organisation_memberships_login_account_unique",
    "organisation_memberships_org_status_idx",
    "session_materials_class_session_idx",
    "session_materials_org_session_idx",
    "session_materials_org_trainer_created_idx",
    "person_roles_role_status_branch_idx",
    "user_sessions_active_subject_type_idx",
    "user_sessions_organisation_membership_id_idx",
  ]);
  if (subjectTriggers.length !== 0) {
    throw new Error("0027 should not create user_sessions_active_subject_* triggers through Wrangler migrations.");
  }
  if (preconfirmIndex.length !== 0) {
    throw new Error("0032 should drop receipts_one_preconfirm_token_per_draft; effective pre-confirm token protection is guarded against receipt_reversals.");
  }

  console.log("Wrangler local D1 migration apply passed through 0033.");
} finally {
  rmSync(persistTo, { recursive: true, force: true });
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (result.error) process.stderr.write(`${result.error.message}\n`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`wrangler ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function query(command) {
  const output = runWrangler([
    "d1",
    "execute",
    "samyak-student-portal",
    "--local",
    "--persist-to",
    persistTo,
    "--json",
    "--command",
    command,
  ]);
  const jsonStart = output.indexOf("[");
  if (jsonStart === -1) throw new Error(`Wrangler JSON output not found: ${output}`);
  const parsed = JSON.parse(output.slice(jsonStart));
  return parsed.flatMap((result) => result.results || []);
}

function expectSome(rows, label) {
  if (rows.length === 0) throw new Error(`Missing ${label}.`);
}

function expectNames(rows, expected) {
  const actual = new Set(rows.map((row) => row.name));
  const missing = expected.filter((name) => !actual.has(name));
  if (missing.length > 0) throw new Error(`Missing schema objects: ${missing.join(", ")}`);
}
