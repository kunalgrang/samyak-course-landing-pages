/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import app from "../index";
import type { WorkerBindings } from "../bindings";
import { encryptText, hmacHex } from "./crypto";
import {
  IMPORTED_CONTACT_REPAIR_CONFIRMATION,
  runTemporaryImportedContactNormalizationRepair,
} from "./temporary-contact-normalization-repair";

type AppEnv = { Bindings: WorkerBindings; Variables: { requestId: string } };

class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(private readonly db: SqliteD1, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return this.db.database.prepare(this.sql).get(...(this.values as never[])) as T | null;
  }

  async all<T>() {
    return { results: this.db.database.prepare(this.sql).all(...(this.values as never[])) } as T;
  }

  async run() {
    this.db.writes.push({ sql: this.sql, values: this.values });
    const result = this.db.database.prepare(this.sql).run(...(this.values as never[]));
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteD1 {
  writes: Array<{ sql: string; values: unknown[] }> = [];

  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SqliteD1Statement(this, sql);
  }

  async batch(statements: SqliteD1Statement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

describe("temporary imported contact normalization repair", () => {
  it("keeps already-canonical imported contacts unchanged", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "9876543210" }]);

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run");

    expect(result).toMatchObject({ examined: 1, alreadyCompatible: 1, requiresCorrection: 0, changed: 0, safeToApply: false });
    expect(fixture.db.writes).toHaveLength(0);
  });

  it("detects legacy +91-style stored hashes requiring correction", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "+91 98765 43210", storedAs: "+919876543210" }]);

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run");

    expect(result).toMatchObject({ examined: 1, alreadyCompatible: 0, requiresCorrection: 1, decryptFailures: 0, invalidMobiles: 0 });
  });

  it("canonicalizes 91-prefixed plaintext to the OTP login hash", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "919876543210", storedAs: "919876543210" }], { padTo56: true });

    const apply = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply");
    const expected = await hmacHex("test-pepper", "mobile", "9876543210");

    expect(apply).toMatchObject({ examined: 56, requiresCorrection: 1, changed: 1, safeToApply: true });
    expect(contactHash(fixture.sqlite, "contact_one")).toBe(expected);
  });

  it("preserves shared-mobile People as separate contacts", async () => {
    const fixture = await repairFixture([
      { id: "one", mobile: "9876543210", storedAs: "+919876543210" },
      { id: "two", mobile: "9876543210", storedAs: "+919876543210" },
    ], { padTo56: true });

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply");

    expect(result).toMatchObject({ examined: 56, requiresCorrection: 2, unsafeCollisions: 0, changed: 2 });
    expect(contactHash(fixture.sqlite, "contact_one")).toBe(contactHash(fixture.sqlite, "contact_two"));
    expect(count(fixture.sqlite, "people")).toBe(56);
    expect(count(fixture.sqlite, "person_contacts")).toBe(56);
  });

  it("blocks apply when a secret is missing", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "+919876543210", missingSecret: true }]);

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply");

    expect(result).toMatchObject({ missingSecrets: 1, safeToApply: false, changed: 0 });
    expect(fixture.db.writes).toHaveLength(0);
  });

  it("blocks apply when decrypting a contact secret fails", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "+919876543210", corruptSecret: true }]);

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply");

    expect(result).toMatchObject({ decryptFailures: 1, safeToApply: false, changed: 0 });
    expect(fixture.db.writes).toHaveLength(0);
  });

  it("blocks apply when decrypted plaintext is not a valid mobile", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "12345", storedAs: "12345" }]);

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply");

    expect(result).toMatchObject({ invalidMobiles: 1, safeToApply: false, changed: 0 });
    expect(fixture.db.writes).toHaveLength(0);
  });

  it("allows an Owner to dry-run the temporary endpoint", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "9876543210" }]);
    const cookie = await seedSession(fixture.sqlite, "owner");

    const response = await app.request(
      "http://localhost/api/staff/maintenance/imported-contact-normalization",
      { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ mode: "dry_run" }) },
      env(fixture.db),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, mode: "dry_run", examined: 1 });
  });

  it("rejects authenticated non-owner staff", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "9876543210" }]);
    const cookie = await seedSession(fixture.sqlite, "counsellor");

    const response = await app.request(
      "http://localhost/api/staff/maintenance/imported-contact-normalization",
      { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ mode: "dry_run" }) },
      env(fixture.db),
    );

    expect(response.status).toBe(403);
  });

  it("requires same-origin JSON requests", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "9876543210" }]);
    const cookie = await seedSession(fixture.sqlite, "owner");

    const response = await app.request(
      "http://localhost/api/staff/maintenance/imported-contact-normalization",
      { method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ mode: "dry_run" }) },
      env(fixture.db),
    );

    expect(response.status).toBe(403);
  });

  it("dry-run performs zero writes", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "+919876543210" }]);

    await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run");

    expect(fixture.db.writes).toHaveLength(0);
  });

  it("apply changes only person_contacts.normalized_value and its timestamp", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "+919876543210" }], { padTo56: true });

    await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply");

    expect(fixture.db.writes.map((write) => compact(write.sql))).toEqual([
      expect.stringContaining("update person_contacts set normalized_value = ?, updated_at = ?"),
    ]);
  });

  it("second apply is idempotent", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "+919876543210" }], { padTo56: true });

    await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply");
    fixture.db.writes = [];
    const second = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply");

    expect(second).toMatchObject({ alreadyCompatible: 56, requiresCorrection: 0, changed: 0 });
    expect(fixture.db.writes).toHaveLength(0);
  });

  it("returns no PII, hashes, ciphertext, or identifiers", async () => {
    const fixture = await repairFixture([{ id: "one", mobile: "9876543210", storedAs: "+919876543210" }]);

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run");
    const printed = JSON.stringify(result);

    expect(printed).not.toContain("9876543210");
    expect(printed).not.toContain("contact_one");
    expect(printed).not.toContain("person_one");
    expect(printed).not.toContain("v1:");
    expect(printed).not.toContain(await hmacHex("test-pepper", "mobile", "9876543210"));
  });

  it("does not affect referrer-only auth", async () => {
    const fixture = await repairFixture([{ id: "imported", mobile: "9876543210", storedAs: "9876543210" }], { padTo56: true });
    const referrerHash = await hmacHex("test-pepper", "mobile", "9123456789");
    fixture.sqlite.prepare("insert into people (id, organisation_id, full_name, public_name, status, created_at, updated_at) values ('person_referrer', 'org_samyak', 'Referrer Only', 'Referrer', 'active', ?, ?)").run(now(), now());
    fixture.sqlite.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values ('contact_referrer', 'person_referrer', 'mobile', ?, '6789', 1, 1, ?, ?)").run(referrerHash, now(), now());
    fixture.sqlite.prepare("insert into person_contact_details (contact_id, status, created_at, updated_at) values ('contact_referrer', 'active', ?, ?)").run(now(), now());
    fixture.sqlite.prepare("insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values ('ref_referrer', 'org_samyak', 'person_referrer', 'referrer-only', 'token', 'link', 1, ?, ?)").run(now(), now());
    fixture.sqlite.prepare("insert into person_roles (person_id, role_id, branch_id, branch_key, created_at) values ('person_referrer', 'role_student', null, '', ?)").run(now());
    const before = contactHash(fixture.sqlite, "contact_referrer");

    await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply");

    expect(contactHash(fixture.sqlite, "contact_referrer")).toBe(before);
  });
});

async function repairFixture(
  contacts: Array<{ id: string; mobile: string; storedAs: string; missingSecret?: boolean; corruptSecret?: boolean }>,
  options: { padTo56?: boolean } = {},
) {
  const sqlite = new DatabaseSync(":memory:");
  const db = new SqliteD1(sqlite);
  createSchema(sqlite);
  const padded = [...contacts];
  if (options.padTo56) {
    for (let index = padded.length + 1; index <= 56; index += 1) {
      const mobile = `98765${String(index).padStart(5, "0")}`;
      padded.push({ id: `pad_${index}`, mobile, storedAs: mobile });
    }
  }
  for (const contact of padded) await seedImportedContact(sqlite, contact);
  return { sqlite, db };
}

function createSchema(db: DatabaseSync) {
  db.exec(`
    create table legacy_import_batches (id text primary key, organisation_id text, source_system text, status text);
    create table legacy_import_entity_mappings (id text primary key, organisation_id text, source_system text, source_entity_type text, target_entity_type text, target_entity_id text, batch_id text);
    create table people (id text primary key, organisation_id text, full_name text, public_name text, status text, created_at text, updated_at text);
    create table person_contacts (id text primary key, person_id text, contact_type text, normalized_value text, last_four text, is_primary integer, is_verified integer, created_at text, updated_at text);
    create table person_contact_details (contact_id text primary key, status text, created_at text, updated_at text);
    create table person_contact_secrets (contact_id text primary key, value_ciphertext text, encryption_version text, created_at text, updated_at text);
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_accounts (id text primary key, organisation_id text, mobile_normalized text, mobile_last_four text, login_enabled integer, status text, created_at text, updated_at text);
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table user_sessions (id text primary key, login_account_id text, active_person_id text, token_hash text, created_at text, expires_at text, last_seen_at text, revoked_at text);
    create table audit_logs (id text primary key, organisation_id text, branch_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, metadata_json text, created_at text);
    create table auth_events (id text primary key, organisation_id text, login_account_id text, event_type text, result_code text, mobile_hash text, mobile_last_four text, ip_hash text, user_agent_hash text, metadata_json text, created_at text);
    create table referrer_profiles (id text primary key, organisation_id text, person_id text, external_referrer_id text, referral_token text, personal_link text, active integer, created_at text, updated_at text);
    create table person_roles (person_id text, role_id text, branch_id text, branch_key text, created_at text);
    insert into legacy_import_batches (id, organisation_id, source_system, status) values ('batch_imported', 'org_samyak', 'legacy_student_workbook', 'applied');
    insert into roles (id, organisation_id, code, name, created_at) values ('role_owner', 'org_samyak', 'owner', 'Owner', '${now()}');
    insert into roles (id, organisation_id, code, name, created_at) values ('role_counsellor', 'org_samyak', 'counsellor', 'Counsellor', '${now()}');
    insert into roles (id, organisation_id, code, name, created_at) values ('role_student', 'org_samyak', 'student', 'Student', '${now()}');
  `);
}

async function seedImportedContact(
  db: DatabaseSync,
  contact: { id: string; mobile: string; storedAs: string; missingSecret?: boolean; corruptSecret?: boolean },
) {
  const personId = `person_${contact.id}`;
  const contactId = `contact_${contact.id}`;
  const storedHash = await hmacHex("test-pepper", "mobile", contact.storedAs);
  db.prepare("insert into people (id, organisation_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'Imported Student', 'Imported', 'active', ?, ?)").run(personId, now(), now());
  db.prepare("insert into legacy_import_entity_mappings (id, organisation_id, source_system, source_entity_type, target_entity_type, target_entity_id, batch_id) values (?, 'org_samyak', 'legacy_student_workbook', 'person', 'person', ?, 'batch_imported')").run(`map_${contact.id}`, personId);
  db.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values (?, ?, 'mobile', ?, null, 1, 1, ?, ?)").run(contactId, personId, storedHash, now(), now());
  db.prepare("insert into person_contact_details (contact_id, status, created_at, updated_at) values (?, 'active', ?, ?)").run(contactId, now(), now());
  if (!contact.missingSecret) {
    const ciphertext = contact.corruptSecret ? "v1:broken:broken" : await encryptText("test-pepper", `contact:${contactId}`, contact.mobile);
    db.prepare("insert into person_contact_secrets (contact_id, value_ciphertext, encryption_version, created_at, updated_at) values (?, ?, 'v1', ?, ?)").run(contactId, ciphertext, now(), now());
  }
}

async function seedSession(db: DatabaseSync, role: "owner" | "counsellor") {
  const accountId = `acct_${role}`;
  const token = `${role}-token`;
  const tokenHash = await hmacHex("test-pepper", "session", token);
  db.prepare("insert into login_accounts (id, organisation_id, mobile_normalized, mobile_last_four, login_enabled, status, created_at, updated_at) values (?, 'org_samyak', ?, '0000', 1, 'active', ?, ?)").run(accountId, `${role}-hash`, now(), now());
  db.prepare("insert into login_account_roles (login_account_id, role_id, branch_id, created_at) values (?, ?, null, ?)").run(accountId, role === "owner" ? "role_owner" : "role_counsellor", now());
  db.prepare("insert into user_sessions (id, login_account_id, active_person_id, token_hash, created_at, expires_at, last_seen_at, revoked_at) values (?, ?, null, ?, ?, ?, ?, null)").run(`sess_${role}`, accountId, tokenHash, now(), "2999-01-01T00:00:00.000Z", now());
  return `samyak_session=${token}`;
}

function context(db: SqliteD1) {
  return { env: { DB: db, SESSION_PEPPER: "test-pepper" } } as unknown as Parameters<typeof runTemporaryImportedContactNormalizationRepair>[0];
}

function env(db: SqliteD1) {
  return { DB: db, SESSION_PEPPER: "test-pepper", ENVIRONMENT: "development", TURNSTILE_SITE_KEY: "test", TURNSTILE_SECRET_KEY: "test" } as unknown as AppEnv;
}

function count(db: DatabaseSync, table: string) {
  return (db.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count;
}

function contactHash(db: DatabaseSync, contactId: string) {
  return (db.prepare("select normalized_value from person_contacts where id = ?").get(contactId) as { normalized_value: string }).normalized_value;
}

function compact(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

function now() {
  return "2026-08-15T00:00:00.000Z";
}
