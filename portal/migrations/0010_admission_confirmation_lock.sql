ALTER TABLE `admission_drafts` ADD COLUMN `confirmation_locked_at` text;
--> statement-breakpoint
ALTER TABLE `admission_drafts` ADD COLUMN `confirmation_snapshot_json` text;
--> statement-breakpoint
ALTER TABLE `admission_drafts` ADD COLUMN `confirmation_snapshot_version` text;
--> statement-breakpoint
ALTER TABLE `admission_drafts` ADD COLUMN `confirmation_locked_by_login_account_id` text;
--> statement-breakpoint
CREATE INDEX `admission_drafts_confirmation_lock_idx` ON `admission_drafts` (`confirmation_locked_at`);
