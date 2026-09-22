/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const NOW = "2026-08-25T10:00:00.000Z";

describe("global identity and organisation membership migration", () => {
  it("backfills existing tenant-local accounts without rewriting actor mappings", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("pragma foreign_keys = on");
    try {
      applyMigrationFile(db, "0000_sturdy_xavin.sql");
      applyMigrationFile(db, "0001_student_portal_auth.sql");
      applyMigrationFile(db, "0002_auth_hardening.sql");
      seedTwoOrganisationSameMobileFixture(db);

      applyMigrationFile(db, "0033_global_identity_memberships.sql");

      expect(count(db, "global_identities")).toBe(1);
      expect(count(db, "organisation_memberships")).toBe(2);
      expect(rows(db, "select id from login_accounts order by id").map((row) => row.id)).toEqual(["acct_other", "acct_samyak"]);
      expect(row(db, "select count(*) as count from login_account_people where login_account_id = 'acct_samyak'")?.count).toBe(1);
      expect(row(db, "select count(*) as count from login_account_roles where login_account_id = 'acct_samyak'")?.count).toBe(1);

      const memberships = rows(db, "select global_identity_id, organisation_id, login_account_id, status from organisation_memberships order by organisation_id");
      expect(new Set(memberships.map((item) => item.global_identity_id)).size).toBe(1);
      expect(memberships).toEqual([
        expect.objectContaining({ organisation_id: "org_other", login_account_id: "acct_other", status: "active" }),
        expect.objectContaining({ organisation_id: "org_samyak", login_account_id: "acct_samyak", status: "active" }),
      ]);
      expect(row(db, "select organisation_membership_id from user_sessions where id = 'sess_samyak'")?.organisation_membership_id).toBe(
        row(db, "select id from organisation_memberships where login_account_id = 'acct_samyak'")?.id,
      );
    } finally {
      db.close();
    }
  });
});

function applyMigrationFile(db: DatabaseSync, file: string) {
  const sql = readFileSync(join(process.cwd(), "migrations", file), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) db.exec(statement);
}

function seedTwoOrganisationSameMobileFixture(db: DatabaseSync) {
  db.exec(`
    insert into organisations (id, name, slug, status, created_at, updated_at) values
      ('org_samyak', 'Samyak', 'samyak', 'active', '${NOW}', '${NOW}'),
      ('org_other', 'Other Institute', 'other', 'active', '${NOW}', '${NOW}');
    insert into branches (id, organisation_id, name, code, timezone, status, created_at, updated_at) values
      ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '${NOW}', '${NOW}'),
      ('branch_other', 'org_other', 'Other', 'OTHER', 'Asia/Kolkata', 'active', '${NOW}', '${NOW}');
    insert into roles (id, organisation_id, code, name, created_at) values
      ('role_owner', 'org_samyak', 'owner', 'Owner', '${NOW}');
    insert into people (id, organisation_id, home_branch_id, full_name, public_name, status, created_at, updated_at) values
      ('person_owner', 'org_samyak', 'branch_sion', 'Owner User', 'Owner', 'active', '${NOW}', '${NOW}');
    insert into login_accounts (id, organisation_id, mobile_normalized, mobile_hash, mobile_last_four, login_enabled, status, created_at, updated_at) values
      ('acct_samyak', 'org_samyak', 'mobile_hash_shared', 'mobile_hash_shared', '3210', 1, 'active', '${NOW}', '${NOW}'),
      ('acct_other', 'org_other', 'mobile_hash_shared', 'mobile_hash_shared', '3210', 1, 'active', '${NOW}', '${NOW}');
    insert into login_account_people (login_account_id, person_id, access_type, is_default, is_available, created_at) values
      ('acct_samyak', 'person_owner', 'staff', 1, 1, '${NOW}');
    insert into login_account_roles (login_account_id, role_id, branch_id, created_at) values
      ('acct_samyak', 'role_owner', 'branch_sion', '${NOW}');
    insert into user_sessions (id, login_account_id, active_person_id, token_hash, created_at, expires_at, last_seen_at) values
      ('sess_samyak', 'acct_samyak', 'person_owner', 'session_hash', '${NOW}', '2099-01-01T00:00:00.000Z', '${NOW}');
  `);
}

function row(db: DatabaseSync, sql: string) {
  return db.prepare(sql).get() as Record<string, string | number> | undefined;
}

function rows(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all() as Array<Record<string, string | number>>;
}

function count(db: DatabaseSync, table: string) {
  return Number(row(db, `select count(*) as count from ${table}`)?.count || 0);
}
