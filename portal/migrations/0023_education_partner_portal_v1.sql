ALTER TABLE `user_sessions` ADD COLUMN `active_education_partner_id` text REFERENCES `education_partners`(`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_sessions_active_education_partner_id_idx` ON `user_sessions` (`active_education_partner_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `login_account_education_partners` (
  `login_account_id` text NOT NULL,
  `education_partner_id` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`login_account_id`, `education_partner_id`),
  FOREIGN KEY (`login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`education_partner_id`) REFERENCES `education_partners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `login_account_education_partners_partner_idx` ON `login_account_education_partners` (`education_partner_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `user_sessions_partner_person_insert_check`
BEFORE INSERT ON `user_sessions`
WHEN NEW.`active_person_id` IS NOT NULL AND NEW.`active_education_partner_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'session cannot have both person and education partner subjects');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `user_sessions_partner_person_update_check`
BEFORE UPDATE OF `active_person_id`, `active_education_partner_id` ON `user_sessions`
WHEN NEW.`active_person_id` IS NOT NULL AND NEW.`active_education_partner_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'session cannot have both person and education partner subjects');
END;
