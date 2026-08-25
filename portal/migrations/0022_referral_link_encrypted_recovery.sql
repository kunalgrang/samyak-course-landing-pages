CREATE TABLE IF NOT EXISTS `referral_link_secrets` (
  `referral_link_id` text PRIMARY KEY NOT NULL,
  `token_ciphertext` text NOT NULL,
  `encryption_version` text DEFAULT 'v1' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`referral_link_id`) REFERENCES `referral_links`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_link_secrets_ciphertext_check` CHECK(`token_ciphertext` like 'v1:%')
);
