import type { AppContext } from "./http";
import { createOpaqueId, decryptText, hmacHex } from "./crypto";
import { normalizeIndianMobile } from "./mobile";
import { ORG_ID } from "./auth-store";
import type { StaffContext } from "./staff-auth";

export const IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED = 56;
export const IMPORTED_CONTACT_REPAIR_CONFIRMATION = "REPAIR_IMPORTED_CONTACT_LOOKUP_HASHES";

export type ImportedContactRepairMode = "dry_run" | "apply";

export type ImportedContactRepairResult = {
  mode: ImportedContactRepairMode;
  examined: number;
  alreadyCompatible: number;
  requiresCorrection: number;
  decryptFailures: number;
  invalidMobiles: number;
  missingSecrets: number;
  unsafeCollisions: number;
  changed: number;
  safeToApply: boolean;
};

type ImportedContactRow = {
  contact_id: string;
  person_id: string;
  normalized_value: string;
  value_ciphertext: string | null;
};

type RepairCandidate = ImportedContactRow & {
  expectedHash: string;
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
  staff?: StaffContext,
): Promise<ImportedContactRepairResult> {
  const rows = await importedMobileContactRows(c);
  const compatible = new Set<string>();
  const corrections: RepairCandidate[] = [];
  const counts = {
    decryptFailures: 0,
    invalidMobiles: 0,
    missingSecrets: 0,
    unsafeCollisions: 0,
  };

  for (const row of rows) {
    if (!row.value_ciphertext) {
      counts.missingSecrets += 1;
      continue;
    }

    const plaintext = await decryptText(c.env.SESSION_PEPPER, `contact:${row.contact_id}`, row.value_ciphertext).catch(() => null);
    if (!plaintext) {
      counts.decryptFailures += 1;
      continue;
    }

    const canonicalMobile = normalizeIndianMobile(plaintext);
    if (!canonicalMobile) {
      counts.invalidMobiles += 1;
      continue;
    }

    const expectedHash = await hmacHex(c.env.SESSION_PEPPER, "mobile", canonicalMobile);
    if (expectedHash === row.normalized_value) {
      compatible.add(row.contact_id);
      continue;
    }

    if (await wouldCollideWithinSamePerson(c, row.person_id, row.contact_id, expectedHash)) {
      counts.unsafeCollisions += 1;
      continue;
    }

    corrections.push({ ...row, expectedHash });
  }

  const result: ImportedContactRepairResult = {
    mode,
    examined: rows.length,
    alreadyCompatible: compatible.size,
    requiresCorrection: corrections.length,
    decryptFailures: counts.decryptFailures,
    invalidMobiles: counts.invalidMobiles,
    missingSecrets: counts.missingSecrets,
    unsafeCollisions: counts.unsafeCollisions,
    changed: 0,
    safeToApply: isSafeToApply(rows.length, counts),
  };

  if (mode === "dry_run") return result;
  if (!result.safeToApply || result.examined !== IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED) return result;

  if (corrections.length > 0) {
    const now = new Date().toISOString();
    const statements = corrections.map((row) =>
      c.env.DB.prepare("update person_contacts set normalized_value = ?, updated_at = ? where id = ? and person_id = ? and contact_type = 'mobile'")
        .bind(row.expectedHash, now, row.contact_id, row.person_id),
    );
    const updateResults = await c.env.DB.batch(statements);
    result.changed = updateResults.reduce((sum, updateResult) => sum + changed(updateResult as D1RunResult), 0);
  }

  if (staff && result.changed > 0) await auditApply(c, staff, result);
  return result;
}

export function isImportedContactRepairSafeForApply(result: ImportedContactRepairResult) {
  return (
    result.examined === IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED &&
    result.decryptFailures === 0 &&
    result.invalidMobiles === 0 &&
    result.missingSecrets === 0 &&
    result.unsafeCollisions === 0
  );
}

async function importedMobileContactRows(c: AppContext) {
  const rows = await c.env.DB.prepare(
    `select distinct
       person_contacts.id as contact_id,
       person_contacts.person_id,
       person_contacts.normalized_value,
       person_contact_secrets.value_ciphertext
     from legacy_import_entity_mappings
     join legacy_import_batches on legacy_import_batches.id = legacy_import_entity_mappings.batch_id
       and legacy_import_batches.organisation_id = legacy_import_entity_mappings.organisation_id
       and legacy_import_batches.source_system = legacy_import_entity_mappings.source_system
       and legacy_import_batches.status = 'applied'
     join person_contacts on person_contacts.person_id = legacy_import_entity_mappings.target_entity_id
       and person_contacts.contact_type = 'mobile'
     left join person_contact_secrets on person_contact_secrets.contact_id = person_contacts.id
     where legacy_import_entity_mappings.organisation_id = ?
       and legacy_import_entity_mappings.source_system = 'legacy_student_workbook'
       and legacy_import_entity_mappings.source_entity_type = 'person'
       and legacy_import_entity_mappings.target_entity_type = 'person'
     order by person_contacts.id`,
  )
    .bind(ORG_ID)
    .all<ImportedContactRow>();
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

function isSafeToApply(
  examined: number,
  counts: Pick<ImportedContactRepairResult, "decryptFailures" | "invalidMobiles" | "missingSecrets" | "unsafeCollisions">,
) {
  return examined === IMPORTED_CONTACT_REPAIR_EXPECTED_EXAMINED &&
    counts.decryptFailures === 0 &&
    counts.invalidMobiles === 0 &&
    counts.missingSecrets === 0 &&
    counts.unsafeCollisions === 0;
}

async function auditApply(c: AppContext, staff: StaffContext, result: ImportedContactRepairResult) {
  await c.env.DB.prepare(
    `insert into audit_logs
       (id, organisation_id, branch_id, actor_login_account_id, actor_person_id, action, entity_type, entity_id, metadata_json, created_at)
     values (?, ?, null, ?, ?, 'temporary_imported_contact_normalization_repair', 'maintenance', ?, ?, ?)`,
  )
    .bind(
      createOpaqueId("audit"),
      ORG_ID,
      staff.loginAccountId,
      staff.activePersonId,
      "imported-contact-normalization",
      JSON.stringify({
        operation: "temporary_imported_contact_normalization_repair",
        mode: result.mode,
        examined: result.examined,
        changed: result.changed,
        alreadyCompatible: result.alreadyCompatible,
        requiresCorrection: result.requiresCorrection,
        decryptFailures: result.decryptFailures,
        invalidMobiles: result.invalidMobiles,
        missingSecrets: result.missingSecrets,
        unsafeCollisions: result.unsafeCollisions,
      }),
      new Date().toISOString(),
    )
    .run();
}

function changed(result: D1RunResult) {
  return Number(result.meta?.changes ?? result.meta?.rows_written ?? 0);
}
