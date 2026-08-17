/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import app from "../index";
import type { WorkerBindings } from "../bindings";
import { decryptText, encryptText, hmacHex } from "./crypto";
import {
  IMPORTED_CONTACT_REPAIR_CONFIRMATION,
  runTemporaryImportedContactNormalizationRepair,
  type ImportedContactRecoveryEntry,
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

describe("temporary imported contact crypto regeneration", () => {
  it("validates a 56-person source payload and marks bad production crypto ready for replacement", async () => {
    const fixture = await repairFixture({ badCrypto: true, sharedMobile: true, multiRowPerson: true });

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run", fixture.entries);

    expect(result).toMatchObject({
      examined: 56,
      mapped: 56,
      readyForReplacement: 56,
      alreadyProductionCompatible: 0,
      invalidSourceMobiles: 0,
      missingMappings: 0,
      ambiguousMappings: 0,
      missingContacts: 0,
      missingSecrets: 0,
      unsafeCollisions: 0,
      sharedMobileContacts: 2,
      changed: 0,
      safeToApply: true,
    });
    expect(fixture.db.writes).toHaveLength(0);
  });

  it("canonicalizes +91 payload mobiles to the OTP/login hash", async () => {
    const fixture = await repairFixture({ badCrypto: true });
    fixture.entries[0] = { ...fixture.entries[0], mobile: `+91 ${fixture.entries[0].mobile}` };

    await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply", fixture.entries);

    expect(contactHash(fixture.sqlite, "contact_001")).toBe(await hmacHex("prod-pepper", "mobile", fixture.entries[0].mobile.slice(-10)));
  });

  it("preserves two separate People sharing one canonical mobile", async () => {
    const fixture = await repairFixture({ badCrypto: true, sharedMobile: true });

    await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply", fixture.entries);

    expect(contactHash(fixture.sqlite, "contact_001")).toBe(contactHash(fixture.sqlite, "contact_002"));
    expect(count(fixture.sqlite, "people")).toBe(56);
    expect(count(fixture.sqlite, "person_contacts")).toBe(56);
  });

  it("does not require decrypting the old bad ciphertext", async () => {
    const fixture = await repairFixture({ badCrypto: true });

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run", fixture.entries);

    expect(result).toMatchObject({ readyForReplacement: 56, missingSecrets: 0, safeToApply: true });
  });

  it("blocks missing, duplicate, contact, secret, invalid mobile, and unsafe collision cases", async () => {
    await expectBlocked({ missingMappingFor: 1 }, { missingMappings: 1 });
    await expectBlocked({ duplicateMappingFor: 1 }, { ambiguousMappings: 1 });
    await expectBlocked({ missingContactFor: 1 }, { missingContacts: 1 });
    await expectBlocked({ missingSecretFor: 1 }, { missingSecrets: 1 });
    await expectBlocked({ invalidMobileFor: 1 }, { invalidSourceMobiles: 1 });
    await expectBlocked({ unsafeCollisionFor: 1 }, { unsafeCollisions: 1 });
  });

  it("rejects wrong source-row identifiers without fuzzy, ref, or mobile fallback", async () => {
    const fixture = await repairFixture({ badCrypto: true });
    fixture.entries[0] = { ...fixture.entries[0], sourceRowNumbers: [999] };

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run", fixture.entries);

    expect(result).toMatchObject({ mapped: 55, missingMappings: 1, safeToApply: false, changed: 0 });
    expect(fixture.db.writes).toHaveLength(0);
  });

  it("rejects source rows that are not from an applied import target", async () => {
    const fixture = await repairFixture({ badCrypto: true });
    fixture.sqlite.prepare("insert into legacy_import_batches (id, organisation_id, source_system, status) values ('batch_draft', 'org_samyak', 'legacy_student_workbook', 'draft')");
    fixture.sqlite.prepare("insert into legacy_import_rows (id, batch_id, source_row_number, legacy_student_ref) values ('row_draft', 'batch_draft', 999, 'LEG-STU-DRAFT000000')");
    fixture.sqlite.prepare("insert into legacy_import_entity_mappings (id, organisation_id, source_system, source_entity_type, source_entity_ref, target_entity_type, target_entity_id, batch_id) values ('map_draft', 'org_samyak', 'legacy_student_workbook', 'person', 'LEG-STU-DRAFT000000', 'person', 'person_001', 'batch_draft')");
    fixture.entries[0] = { ...fixture.entries[0], sourceRowNumbers: [999] };

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run", fixture.entries);

    expect(result).toMatchObject({ mapped: 55, missingMappings: 1, safeToApply: false });
  });

  it("rejects authenticated non-owner staff and allows owner dry-run", async () => {
    const fixture = await repairFixture({ badCrypto: true });
    const counsellor = await seedSession(fixture.sqlite, "counsellor");
    const owner = await seedSession(fixture.sqlite, "owner");

    const denied = await request(fixture.db, counsellor, { mode: "dry_run", entries: fixture.entries });
    const allowed = await request(fixture.db, owner, { mode: "dry_run", entries: fixture.entries });

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({ success: true, examined: 56, mapped: 56 });
  });

  it("requires same-origin JSON requests", async () => {
    const fixture = await repairFixture({ badCrypto: true });
    const owner = await seedSession(fixture.sqlite, "owner");

    const response = await app.request(
      "http://localhost/api/staff/maintenance/imported-contact-normalization",
      { method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/json", Cookie: owner }, body: JSON.stringify({ mode: "dry_run", entries: fixture.entries }) },
      env(fixture.db),
    );

    expect(response.status).toBe(403);
  });

  it("returns no PII, hashes, ciphertext, or identifiers", async () => {
    const fixture = await repairFixture({ badCrypto: true });

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run", fixture.entries);
    const printed = JSON.stringify(result);

    expect(printed).not.toContain(fixture.entries[0].mobile);
    expect(printed).not.toContain("contact_001");
    expect(printed).not.toContain("person_001");
    expect(printed).not.toContain("v1:");
    expect(printed).not.toContain(await hmacHex("prod-pepper", "mobile", fixture.entries[0].mobile));
  });

  it("apply updates only the contact hash, secret ciphertext, and timestamps", async () => {
    const fixture = await repairFixture({ badCrypto: true });

    const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply", fixture.entries);

    expect(result).toMatchObject({ changed: 112, safeToApply: true });
    const writtenSql = fixture.db.writes.map((write) => compact(write.sql));
    expect(writtenSql).toContain("update person_contacts set normalized_value = ?, updated_at = ? where id = ? and person_id = ? and contact_type = 'mobile'");
    expect(writtenSql).toContain("update person_contact_secrets set value_ciphertext = ?, updated_at = ? where contact_id = ? and encryption_version = 'v1'");
    const secret = fixture.sqlite.prepare("select value_ciphertext from person_contact_secrets where contact_id = 'contact_001'").get() as { value_ciphertext: string };
    await expect(decryptText("prod-pepper", "contact:contact_001", secret.value_ciphertext)).resolves.toBe(fixture.entries[0].mobile);
  });

  it("second run is semantically idempotent after repair", async () => {
    const fixture = await repairFixture({ badCrypto: true });

    await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply", fixture.entries);
    fixture.db.writes = [];
    const second = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply", fixture.entries);

    expect(second).toMatchObject({ alreadyProductionCompatible: 56, readyForReplacement: 0, changed: 0 });
    expect(fixture.db.writes).toHaveLength(0);
  });

  it("keeps referrer-only auth data outside the imported-contact scope", async () => {
    const fixture = await repairFixture({ badCrypto: true });
    const referrerHash = await hmacHex("prod-pepper", "mobile", "9123456789");
    fixture.sqlite.prepare("insert into people (id, organisation_id, full_name, public_name, status, created_at, updated_at) values ('person_referrer', 'org_samyak', 'Referrer Only', 'Referrer', 'active', ?, ?)").run(now(), now());
    fixture.sqlite.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values ('contact_referrer', 'person_referrer', 'mobile', ?, '6789', 1, 1, ?, ?)").run(referrerHash, now(), now());
    fixture.sqlite.prepare("insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values ('ref_referrer', 'org_samyak', 'person_referrer', 'referrer-only', 'token', 'link', 1, ?, ?)").run(now(), now());

    await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply", fixture.entries);

    expect(contactHash(fixture.sqlite, "contact_referrer")).toBe(referrerHash);
  });

  it("accepts an owner/referrer multi-role account for the owner-gated endpoint", async () => {
    const fixture = await repairFixture({ badCrypto: true });
    const cookie = await seedSession(fixture.sqlite, "owner_referrer");

    const response = await request(fixture.db, cookie, { mode: "dry_run", entries: fixture.entries });

    expect(response.status).toBe(200);
  });

  it("requires the explicit apply confirmation string", async () => {
    const fixture = await repairFixture({ badCrypto: true });
    const cookie = await seedSession(fixture.sqlite, "owner");

    const response = await request(fixture.db, cookie, { mode: "apply", confirmation: "WRONG", entries: fixture.entries });

    expect(response.status).toBe(400);
  });

  it("does not log source entries during dry-run", async () => {
    const spy = vi.spyOn(console, "log");
    const fixture = await repairFixture({ badCrypto: true });

    await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "dry_run", fixture.entries);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

async function expectBlocked(options: FixtureOptions, expected: Partial<Awaited<ReturnType<typeof runTemporaryImportedContactNormalizationRepair>>>) {
  const fixture = await repairFixture({ badCrypto: true, ...options });
  const result = await runTemporaryImportedContactNormalizationRepair(context(fixture.db), "apply", fixture.entries);
  expect(result).toMatchObject({ ...expected, safeToApply: false, changed: 0 });
  expect(fixture.db.writes).toHaveLength(0);
}

type FixtureOptions = {
  badCrypto?: boolean;
  sharedMobile?: boolean;
  multiRowPerson?: boolean;
  missingMappingFor?: number;
  duplicateMappingFor?: number;
  missingContactFor?: number;
  missingSecretFor?: number;
  invalidMobileFor?: number;
  unsafeCollisionFor?: number;
};

async function repairFixture(options: FixtureOptions = {}) {
  const sqlite = new DatabaseSync(":memory:");
  const db = new SqliteD1(sqlite);
  createSchema(sqlite);
  const entries: ImportedContactRecoveryEntry[] = [];
  for (let index = 1; index <= 56; index += 1) {
    const legacyStudentRef = ref(index);
    const mobile = options.sharedMobile && index === 2 ? mobileFor(1) : mobileFor(index);
    const sourceRowNumbers = options.multiRowPerson && index === 1 ? [2, 61] : [index + 1];
    entries.push({ sourceRowNumbers, mobile: options.invalidMobileFor === index ? "12345" : mobile });
    await seedImportedContact(sqlite, {
      index,
      legacyStudentRef,
      sourceRowNumbers,
      mobile,
      badCrypto: options.badCrypto,
      missingMapping: options.missingMappingFor === index,
      duplicateMapping: options.duplicateMappingFor === index,
      missingContact: options.missingContactFor === index,
      missingSecret: options.missingSecretFor === index,
      unsafeCollision: options.unsafeCollisionFor === index,
    });
  }
  return { sqlite, db, entries };
}

function createSchema(db: DatabaseSync) {
  db.exec(`
    create table legacy_import_batches (id text primary key, organisation_id text, source_system text, status text);
    create table legacy_import_rows (id text primary key, batch_id text, source_row_number integer, legacy_student_ref text);
    create table legacy_import_entity_mappings (id text primary key, organisation_id text, source_system text, source_entity_type text, source_entity_ref text, target_entity_type text, target_entity_id text, batch_id text);
    create table people (id text primary key, organisation_id text, full_name text, public_name text, status text, created_at text, updated_at text);
    create table person_contacts (id text primary key, person_id text, contact_type text, normalized_value text, last_four text, is_primary integer, is_verified integer, created_at text, updated_at text);
    create table person_contact_secrets (contact_id text primary key, value_ciphertext text, encryption_version text, created_at text, updated_at text);
    create table roles (id text primary key, organisation_id text, code text, name text, created_at text);
    create table login_accounts (id text primary key, organisation_id text, mobile_normalized text, mobile_last_four text, login_enabled integer, status text, created_at text, updated_at text);
    create table login_account_roles (login_account_id text, role_id text, branch_id text, created_at text);
    create table user_sessions (id text primary key, login_account_id text, active_person_id text, token_hash text, created_at text, expires_at text, last_seen_at text, revoked_at text);
    create table audit_logs (id text primary key, organisation_id text, branch_id text, actor_login_account_id text, actor_person_id text, action text, entity_type text, entity_id text, metadata_json text, created_at text);
    create table auth_events (id text primary key, organisation_id text, login_account_id text, event_type text, result_code text, mobile_hash text, mobile_last_four text, ip_hash text, user_agent_hash text, metadata_json text, created_at text);
    create table referrer_profiles (id text primary key, organisation_id text, person_id text, external_referrer_id text, referral_token text, personal_link text, active integer, created_at text, updated_at text);
    insert into legacy_import_batches (id, organisation_id, source_system, status) values ('batch_imported', 'org_samyak', 'legacy_student_workbook', 'applied');
    insert into roles (id, organisation_id, code, name, created_at) values ('role_owner', 'org_samyak', 'owner', 'Owner', '${now()}');
    insert into roles (id, organisation_id, code, name, created_at) values ('role_counsellor', 'org_samyak', 'counsellor', 'Counsellor', '${now()}');
  `);
}

async function seedImportedContact(db: DatabaseSync, input: {
  index: number;
  legacyStudentRef: string;
  sourceRowNumbers: number[];
  mobile: string;
  badCrypto?: boolean;
  missingMapping?: boolean;
  duplicateMapping?: boolean;
  missingContact?: boolean;
  missingSecret?: boolean;
  unsafeCollision?: boolean;
}) {
  const personId = `person_${String(input.index).padStart(3, "0")}`;
  const contactId = `contact_${String(input.index).padStart(3, "0")}`;
  const staleHash = await hmacHex("local-pepper", "mobile", `+91${input.mobile}`);
  db.prepare("insert into people (id, organisation_id, full_name, public_name, status, created_at, updated_at) values (?, 'org_samyak', 'Imported Student', 'Imported', 'active', ?, ?)").run(personId, now(), now());
  for (const sourceRowNumber of input.sourceRowNumbers) {
    db.prepare("insert into legacy_import_rows (id, batch_id, source_row_number, legacy_student_ref) values (?, 'batch_imported', ?, ?)").run(`row_${input.index}_${sourceRowNumber}`, sourceRowNumber, input.legacyStudentRef);
  }
  if (!input.missingMapping) {
    db.prepare("insert into legacy_import_entity_mappings (id, organisation_id, source_system, source_entity_type, source_entity_ref, target_entity_type, target_entity_id, batch_id) values (?, 'org_samyak', 'legacy_student_workbook', 'person', ?, 'person', ?, 'batch_imported')").run(`map_${input.index}`, input.legacyStudentRef, personId);
  }
  if (input.duplicateMapping) {
    db.prepare("insert into legacy_import_entity_mappings (id, organisation_id, source_system, source_entity_type, source_entity_ref, target_entity_type, target_entity_id, batch_id) values (?, 'org_samyak', 'legacy_student_workbook', 'person', ?, 'person', ?, 'batch_imported')").run(`map_dup_${input.index}`, input.legacyStudentRef, personId);
  }
  if (input.missingContact) return;
  db.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values (?, ?, 'mobile', ?, ?, 1, 1, ?, ?)").run(contactId, personId, staleHash, input.mobile.slice(-4), now(), now());
  if (input.unsafeCollision) {
    const expectedHash = await hmacHex("prod-pepper", "mobile", input.mobile);
    db.prepare("insert into person_contacts (id, person_id, contact_type, normalized_value, last_four, is_primary, is_verified, created_at, updated_at) values (?, ?, 'mobile', ?, ?, 0, 1, ?, ?)").run(`contact_collision_${input.index}`, personId, expectedHash, input.mobile.slice(-4), now(), now());
  }
  if (input.missingSecret) return;
  const pepper = input.badCrypto ? "local-pepper" : "prod-pepper";
  const plaintext = input.badCrypto ? `+91${input.mobile}` : input.mobile;
  const ciphertext = await encryptText(pepper, `contact:${contactId}`, plaintext);
  db.prepare("insert into person_contact_secrets (contact_id, value_ciphertext, encryption_version, created_at, updated_at) values (?, ?, 'v1', ?, ?)").run(contactId, ciphertext, now(), now());
}

async function seedSession(db: DatabaseSync, role: "owner" | "counsellor" | "owner_referrer") {
  const accountId = `acct_${role}`;
  const token = `${role}-token`;
  const tokenHash = await hmacHex("prod-pepper", "session", token);
  db.prepare("insert into login_accounts (id, organisation_id, mobile_normalized, mobile_last_four, login_enabled, status, created_at, updated_at) values (?, 'org_samyak', ?, '0000', 1, 'active', ?, ?)").run(accountId, `${role}-hash`, now(), now());
  if (role !== "counsellor") db.prepare("insert into login_account_roles (login_account_id, role_id, branch_id, created_at) values (?, 'role_owner', null, ?)").run(accountId, now());
  if (role === "counsellor") db.prepare("insert into login_account_roles (login_account_id, role_id, branch_id, created_at) values (?, 'role_counsellor', null, ?)").run(accountId, now());
  if (role === "owner_referrer") db.prepare("insert into referrer_profiles (id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at) values ('ref_owner', 'org_samyak', null, 'owner-referrer', 'token', 'link', 1, ?, ?)").run(now(), now());
  db.prepare("insert into user_sessions (id, login_account_id, active_person_id, token_hash, created_at, expires_at, last_seen_at, revoked_at) values (?, ?, null, ?, ?, ?, ?, null)").run(`sess_${role}`, accountId, tokenHash, now(), "2999-01-01T00:00:00.000Z", now());
  return `samyak_session=${token}`;
}

function request(db: SqliteD1, cookie: string, body: unknown) {
  return app.request(
    "http://localhost/api/staff/maintenance/imported-contact-normalization",
    { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) },
    env(db),
  );
}

function context(db: SqliteD1) {
  return { env: { DB: db, SESSION_PEPPER: "prod-pepper" } } as unknown as Parameters<typeof runTemporaryImportedContactNormalizationRepair>[0];
}

function env(db: SqliteD1) {
  return { DB: db, SESSION_PEPPER: "prod-pepper", ENVIRONMENT: "development", TURNSTILE_SITE_KEY: "test", TURNSTILE_SECRET_KEY: "test" } as unknown as AppEnv;
}

function ref(index: number) {
  return `LEG-STU-${String(index).padStart(12, "0")}`;
}

function mobileFor(index: number) {
  return `98765${String(index).padStart(5, "0")}`;
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
