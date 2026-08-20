import { createOpaqueId, encryptText } from "./crypto";

type ContactContext = {
  env: {
    DB: D1Database;
    SESSION_PEPPER: string;
  };
};

export async function addMobileIfMissing(
  c: ContactContext,
  personId: string,
  normalizedMobile: string,
  lookupHash: string,
  now: string,
  makePrimary = false,
) {
  const contact = await c.env.DB.prepare(
    "select id from person_contacts where person_id = ? and contact_type = 'mobile' and normalized_value = ?",
  )
    .bind(personId, lookupHash)
    .first<{ id: string }>();
  if (contact) return;

  const contactId = createOpaqueId("contact");
  const ciphertext = await encryptText(c.env.SESSION_PEPPER, `contact:${contactId}`, normalizedMobile);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `insert into person_contacts
         (id, person_id, contact_type, normalized_value, display_value, last_four, is_primary, is_verified, created_at, updated_at)
       values (?, ?, 'mobile', ?, null, ?, ?, 0, ?, ?)`,
    ).bind(contactId, personId, lookupHash, normalizedMobile.slice(-4), makePrimary ? 1 : 0, now, now),
    c.env.DB.prepare(
      `insert into person_contact_details
         (contact_id, belongs_to, is_whatsapp, status, created_at, updated_at)
       values (?, 'student', 1, 'active', ?, ?)`,
    ).bind(contactId, now, now),
    c.env.DB.prepare(
      `insert into person_contact_secrets
         (contact_id, value_ciphertext, encryption_version, created_at, updated_at)
       values (?, ?, 'v1', ?, ?)`,
    ).bind(contactId, ciphertext, now, now),
  ]);
}
