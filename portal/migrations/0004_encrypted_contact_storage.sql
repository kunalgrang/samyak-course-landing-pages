PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `person_contact_secrets` (
  `contact_id` text PRIMARY KEY NOT NULL,
  `value_ciphertext` text NOT NULL,
  `encryption_version` text DEFAULT 'v1' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`contact_id`) REFERENCES `person_contacts`(`id`) ON UPDATE no action ON DELETE no action
);
