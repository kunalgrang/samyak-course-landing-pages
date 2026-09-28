PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE `otp_challenges_new` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `login_account_id` text,
  `mobile_hash` text NOT NULL,
  `mobile_last_four` text,
  `mobile_ciphertext` text,
  `provider` text NOT NULL,
  `provider_request_id` text,
  `provider_challenge_id` text,
  `purpose` text NOT NULL,
  `status` text NOT NULL,
  `verification_attempts` integer DEFAULT 0 NOT NULL,
  `resend_count` integer DEFAULT 0 NOT NULL,
  `last_sent_at` text,
  `requested_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `verified_at` text,
  `ip_hash` text,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "otp_challenges_provider_check" CHECK(`provider` in ('msg91', 'development', 'none')),
  CONSTRAINT "otp_challenges_purpose_check" CHECK(`purpose` in ('login', 'signup')),
  CONSTRAINT "otp_challenges_status_check" CHECK(`status` in ('requested', 'sent', 'verified', 'expired', 'failed', 'blocked'))
);
--> statement-breakpoint
INSERT INTO `otp_challenges_new` (
  `id`,
  `organisation_id`,
  `login_account_id`,
  `mobile_hash`,
  `mobile_last_four`,
  `mobile_ciphertext`,
  `provider`,
  `provider_request_id`,
  `provider_challenge_id`,
  `purpose`,
  `status`,
  `verification_attempts`,
  `resend_count`,
  `last_sent_at`,
  `requested_at`,
  `expires_at`,
  `verified_at`,
  `ip_hash`
)
SELECT
  `id`,
  `organisation_id`,
  `login_account_id`,
  `mobile_hash`,
  `mobile_last_four`,
  `mobile_ciphertext`,
  `provider`,
  `provider_request_id`,
  `provider_challenge_id`,
  `purpose`,
  `status`,
  `verification_attempts`,
  `resend_count`,
  `last_sent_at`,
  `requested_at`,
  `expires_at`,
  `verified_at`,
  `ip_hash`
FROM `otp_challenges`;
--> statement-breakpoint
DROP TABLE `otp_challenges`;
--> statement-breakpoint
ALTER TABLE `otp_challenges_new` RENAME TO `otp_challenges`;
--> statement-breakpoint
CREATE INDEX `otp_challenges_mobile_hash_requested_at_idx` ON `otp_challenges` (`mobile_hash`, `requested_at`);
--> statement-breakpoint
CREATE INDEX `otp_challenges_ip_hash_requested_at_idx` ON `otp_challenges` (`ip_hash`, `requested_at`);
--> statement-breakpoint
CREATE INDEX `otp_challenges_login_account_id_idx` ON `otp_challenges` (`login_account_id`);
--> statement-breakpoint
CREATE INDEX `otp_challenges_expires_at_idx` ON `otp_challenges` (`expires_at`);
--> statement-breakpoint
PRAGMA foreign_keys = ON;
