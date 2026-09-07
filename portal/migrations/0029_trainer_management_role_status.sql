PRAGMA foreign_keys = ON;
--> statement-breakpoint
ALTER TABLE `person_roles` ADD COLUMN `status` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `person_roles_role_status_branch_idx` ON `person_roles` (`role_id`, `status`, `branch_id`);
