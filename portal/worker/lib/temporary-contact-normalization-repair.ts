import type { AppContext } from "./http";
import { createOpaqueId, decryptText, encryptText, hmacHex } from "./crypto";
import { normalizeIndianMobile } from "./mobile";
import { ORG_ID } from "./auth-store";
import type { StaffContext } from "./staff-auth";

export const IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED = 56;
export const IMPORTED_CONTACT_REPAIR_CONFIRMATION = "REGENERATE_IMPORTED_CONTACT_CRYPTOGRAPHY";

export type ImportedContactRepairMode = "dry_run" | "apply";

export type ImportedContactRecoveryEntry = {
  sourceRowNumbers: number[];
  mobile: string;
};

export type ImportedContactRepairResult = {
  mode: ImportedContactRepairMode;
  examined: number;
  mapped: number;
  readyForReplacement: number;
  alreadyProductionCompatible: number;
  invalidSourceMobiles: number;
  missingMappings: number;
  ambiguousMappings: number;
  missingContacts: number;
  missingSecrets: number;
  unsafeCollisions: number;
  sharedMobileContacts: number;
  changed: number;
  safeToApply: boolean;
};

type ImportedContactMappingRow = {
  source_row_number: number;
  legacy_student_ref: string;
  person_id: string;
  contact_id: string | null;
  contact_type: string | null;
  normalized_value: string | null;
  value_ciphertext: string | null;
  encryption_version: string | null;
};

type PreparedRecovery = {
  result: ImportedContactRepairResult;
  replacements: Array<{
    sourceRowNumbers: number[];
    canonicalMobile: string;
    personId: string;
    contactId: string;
    expectedHash: string;
    ciphertext: string;
    alreadyCompatible: boolean;
  }>;
};

type D1RunResult = {
  meta?: {
    changes?: number;
    rows_written?: number;
  };
};

export async function runTemporaryImportedContactNormalizationRepair(
  c: AppContext,
  mode: ImportedContactRepairMode,
  entries: ImportedContactRecoveryEntry[],
  staff?: StaffContext,
): Promise<ImportedContactRepairResult> {
  const prepared = await prepareRecovery(c, mode, entries);
  const result = prepared.result;
  if (mode === "dry_run") return result;
  if (!isImportedContactRepairSafeForApply(result)) return result;

  const corrections = prepared.replacements.filter((replacement) => !replacement.alreadyCompatible);
  if (corrections.length > 0) {
    const now = new Date().toISOString();
    const statements = corrections.flatMap((row) => [
      c.env.DB.prepare(
        "update person_contacts set normalized_value = ?, updated_at = ? where id = ? and person_id = ? and contact_type = 'mobile'",
      ).bind(row.expectedHash, now, row.contactId, row.personId),
      c.env.DB.prepare(
        "update person_contact_secrets set value_ciphertext = ?, updated_at = ? where contact_id = ? and encryption_version = 'v1'",
      ).bind(row.ciphertext, now, row.contactId),
    ]);
    const updateResults = await c.env.DB.batch(statements);
    result.changed = updateResults.reduce((sum, updateResult) => sum + changed(updateResult as D1RunResult), 0);
  }

  if (staff && result.changed > 0) await auditApply(c, staff, result);
  return result;
}

export function isImportedContactRepairSafeForApply(result: ImportedContactRepairResult) {
  return (
    result.examined === IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED &&
    result.mapped === IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED &&
    result.invalidSourceMobiles === 0 &&
    result.missingMappings === 0 &&
    result.ambiguousMappings === 0 &&
    result.missingContacts === 0 &&
    result.missingSecrets === 0 &&
    result.unsafeCollisions === 0 &&
    result.safeToApply
  );
}

async function prepareRecovery(c: AppContext, mode: ImportedContactRepairMode, entries: ImportedContactRecoveryEntry[]): Promise<PreparedRecovery> {
  const canonicalEntries = canonicalizeEntries(entries);
  const mappings = await importedContactMappings(c);
  const payloadSourceRowCounts = countBy(canonicalEntries.valid.flatMap((entry) => entry.sourceRowNumbers), String);
  const replacements: PreparedRecovery["replacements"] = [];
  const counts = {
    missingMappings: 0,
    ambiguousMappings: 0,
    missingContacts: 0,
    missingSecrets: 0,
    unsafeCollisions: 0,
    alreadyProductionCompatible: 0,
    readyForReplacement: 0,
  };

  for (const entry of canonicalEntries.valid) {
    const matches = mappings.filter((row) => entry.sourceRowNumbers.includes(row.source_row_number));
    if (entry.sourceRowNumbers.some((sourceRowNumber) => payloadSourceRowCounts.get(String(sourceRowNumber))! > 1)) {
      counts.ambiguousMappings += 1;
      continue;
    }
    if (matches.length === 0) {
      counts.missingMappings += 1;
      continue;
    }
    const matchedSourceRows = new Set(matches.map((row) => row.source_row_number));
    if (matchedSourceRows.size !== entry.sourceRowNumbers.length) {
      counts.missingMappings += 1;
      continue;
    }
    const legacyStudentRefs = new Set(matches.map((row) => row.legacy_student_ref));
    const personIds = new Set(matches.map((row) => row.person_id));
    const contactIds = new Set(matches.map((row) => row.contact_id));
    if (legacyStudentRefs.size !== 1 || personIds.size !== 1 || contactIds.size !== 1 || matches.length !== entry.sourceRowNumbers.length) {
      counts.ambiguousMappings += 1;
      continue;
    }

    const row = matches[0];
    if (!row.contact_id || row.contact_type !== "mobile") {
      counts.missingContacts += 1;
      continue;
    }
    if (!row.value_ciphertext || row.encryption_version !== "v1") {
      counts.missingSecrets += 1;
      continue;
    }

    const expectedHash = await hmacHex(c.env.SESSION_PEPPER, "mobile", entry.canonicalMobile);
    if (await wouldCollideWithinSamePerson(c, row.person_id, row.contact_id, expectedHash)) {
      counts.unsafeCollisions += 1;
      continue;
    }

    const currentPlaintext = await decryptText(c.env.SESSION_PEPPER, `contact:${row.contact_id}`, row.value_ciphertext).catch(() => null);
    const currentCanonical = currentPlaintext ? normalizeIndianMobile(currentPlaintext) : null;
    const alreadyCompatible = currentCanonical === entry.canonicalMobile && row.normalized_value === expectedHash;
    if (alreadyCompatible) counts.alreadyProductionCompatible += 1;
    else counts.readyForReplacement += 1;
    const ciphertext = alreadyCompatible ? "" : await encryptText(c.env.SESSION_PEPPER, `contact:${row.contact_id}`, entry.canonicalMobile);

    replacements.push({
      sourceRowNumbers: entry.sourceRowNumbers,
      canonicalMobile: entry.canonicalMobile,
      personId: row.person_id,
      contactId: row.contact_id,
      expectedHash,
      ciphertext,
      alreadyCompatible,
    });
  }

  const mapped = replacements.length;
  const sharedMobileContacts = countSharedMobileContacts(canonicalEntries.valid);
  const result: ImportedContactRepairResult = {
    mode,
    examined: canonicalEntries.valid.length,
    mapped,
    readyForReplacement: counts.readyForReplacement,
    alreadyProductionCompatible: counts.alreadyProductionCompatible,
    invalidSourceMobiles: canonicalEntries.invalid,
    missingMappings: counts.missingMappings,
    ambiguousMappings: counts.ambiguousMappings,
    missingContacts: counts.missingContacts,
    missingSecrets: counts.missingSecrets,
    unsafeCollisions: counts.unsafeCollisions,
    sharedMobileContacts,
    changed: 0,
    safeToApply:
      canonicalEntries.valid.length === IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED &&
      mapped === IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED &&
      counts.readyForReplacement + counts.alreadyProductionCompatible === IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED &&
      canonicalEntries.invalid === 0 &&
      counts.missingMappings === 0 &&
      counts.ambiguousMappings === 0 &&
      counts.missingContacts === 0 &&
      counts.missingSecrets === 0 &&
      counts.unsafeCollisions === 0,
  };
  return { result, replacements };
}

function canonicalizeEntries(entries: ImportedContactRecoveryEntry[]) {
  const valid: Array<{ sourceRowNumbers: number[]; canonicalMobile: string }> = [];
  let invalid = 0;
  for (const entry of entries) {
    const sourceRowNumbers = [...new Set(entry.sourceRowNumbers || [])].sort((left, right) => left - right);
    const canonicalMobile = normalizeIndianMobile(entry.mobile);
    if (sourceRowNumbers.length === 0 || !canonicalMobile) {
      invalid += 1;
      continue;
    }
    valid.push({ sourceRowNumbers, canonicalMobile });
  }
  return { valid, invalid };
}

async function importedContactMappings(c: AppContext) {
  const rows = await c.env.DB.prepare(
    `select
       legacy_import_rows.source_row_number,
       legacy_import_rows.legacy_student_ref,
       legacy_import_entity_mappings.target_entity_id as person_id,
       person_contacts.id as contact_id,
       person_contacts.contact_type,
       person_contacts.normalized_value,
       person_contact_secrets.value_ciphertext,
       person_contact_secrets.encryption_version
     from legacy_import_rows
     join legacy_import_batches on legacy_import_batches.id = legacy_import_rows.batch_id
       and legacy_import_batches.status = 'applied'
     join legacy_import_entity_mappings on legacy_import_entity_mappings.batch_id = legacy_import_rows.batch_id
       and legacy_import_entity_mappings.organisation_id = legacy_import_batches.organisation_id
       and legacy_import_entity_mappings.source_system = legacy_import_batches.source_system
       and legacy_import_entity_mappings.source_entity_ref = legacy_import_rows.legacy_student_ref
       and legacy_import_entity_mappings.source_entity_type = 'person'
       and legacy_import_entity_mappings.target_entity_type = 'person'
     left join person_contacts on person_contacts.person_id = legacy_import_entity_mappings.target_entity_id
       and person_contacts.contact_type = 'mobile'
       and person_contacts.is_primary = 1
     left join person_contact_secrets on person_contact_secrets.contact_id = person_contacts.id
     where legacy_import_batches.organisation_id = ?
       and legacy_import_batches.source_system = 'legacy_student_workbook'
     order by legacy_import_rows.source_row_number, person_contacts.id`,
  )
    .bind(ORG_ID)
    .all<ImportedContactMappingRow>();
  return rows.results || [];
}

async function wouldCollideWithinSamePerson(c: AppContext, personId: string, contactId: string, expectedHash: string) {
  const row = await c.env.DB.prepare(
    `select 1 as collision
     from person_contacts
     where person_id = ?
       and contact_type = 'mobile'
       and normalized_value = ?
       and id != ?
     limit 1`,
  )
    .bind(personId, expectedHash, contactId)
    .first<{ collision: number }>();
  return Boolean(row);
}

function countBy<T>(values: T[], key: (value: T) => string) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(key(value), (counts.get(key(value)) || 0) + 1);
  return counts;
}

function countSharedMobileContacts(entries: Array<{ canonicalMobile: string }>) {
  let shared = 0;
  for (const count of countBy(entries, (entry) => entry.canonicalMobile).values()) {
    if (count > 1) shared += count;
  }
  return shared;
}

async function auditApply(c: AppContext, staff: StaffContext, result: ImportedContactRepairResult) {
  await c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, null, ?, ?, 'temporary_imported_contact_crypto_regeneration', 'maintenance', ?, ?, ?)`,
  )
    .bind(
      createOpaqueId("audit"),
      ORG_ID,
      staff.loginAccountId,
      staff.activePersonId,
      "imported-contact-normalization",
      JSON.stringify({
        operation: "temporary_imported_contact_crypto_regeneration",
        mode: result.mode,
        examined: result.examined,
        mapped: result.mapped,
        changed: result.changed,
        readyForReplacement: result.readyForReplacement,
        alreadyProductionCompatible: result.alreadyProductionCompatible,
        invalidSourceMobiles: result.invalidSourceMobiles,
        missingMappings: result.missingMappings,
        ambiguousMappings: result.ambiguousMappings,
        missingContacts: result.missingContacts,
        missingSecrets: result.missingSecrets,
        unsafeCollisions: result.unsafeCollisions,
        sharedMobileContacts: result.sharedMobileContacts,
      }),
      new Date().toISOString(),
    )
    .run();
}

function changed(result: D1RunResult) {
  return Number(result.meta?.changes ?? result.meta?.rows_written ?? 0);
}
