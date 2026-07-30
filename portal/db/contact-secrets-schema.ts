import { text, sqliteTable } from "drizzle-orm/sqlite-core";
import { personContacts } from "./schema";

export const personContactSecrets = sqliteTable("person_contact_secrets", {
  contactId: text("contact_id")
    .primaryKey()
    .references(() => personContacts.id),
  valueCiphertext: text("value_ciphertext").notNull(),
  encryptionVersion: text("encryption_version").notNull().default("v1"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
