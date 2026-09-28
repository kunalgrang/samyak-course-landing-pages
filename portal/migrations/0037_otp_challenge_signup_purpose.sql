ALTER TABLE `otp_challenges` ADD COLUMN `challenge_purpose` text DEFAULT 'login' NOT NULL CHECK(`challenge_purpose` in ('login', 'signup'));
--> statement-breakpoint
CREATE INDEX `otp_challenges_mobile_hash_challenge_purpose_requested_at_idx` ON `otp_challenges` (`mobile_hash`, `challenge_purpose`, `requested_at`);
