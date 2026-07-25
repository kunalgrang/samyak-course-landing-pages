PRAGMA foreign_keys = ON;
--> statement-breakpoint
ALTER TABLE `login_account_people` ADD COLUMN `is_available` integer DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE `person_roles` (
  `person_id` text NOT NULL,
  `role_id` text NOT NULL,
  `branch_id` text,
  `branch_key` text DEFAULT '' NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_roles_person_role_branch_unique` ON `person_roles` (`person_id`, `role_id`, `branch_key`);
--> statement-breakpoint
CREATE INDEX `person_roles_person_id_idx` ON `person_roles` (`person_id`);
--> statement-breakpoint
CREATE INDEX `person_roles_role_id_idx` ON `person_roles` (`role_id`);
--> statement-breakpoint
CREATE INDEX `person_roles_branch_id_idx` ON `person_roles` (`branch_id`);
--> statement-breakpoint
INSERT INTO `person_roles` (`person_id`, `role_id`, `branch_id`, `branch_key`, `created_at`)
SELECT
  `login_account_people`.`person_id`,
  `login_account_roles`.`role_id`,
  `login_account_roles`.`branch_id`,
  coalesce(`login_account_roles`.`branch_id`, ''),
  `login_account_roles`.`created_at`
FROM `login_account_people`
JOIN `login_account_roles` ON `login_account_roles`.`login_account_id` = `login_account_people`.`login_account_id`
JOIN `roles` ON `roles`.`id` = `login_account_roles`.`role_id`
WHERE `roles`.`code` in ('student', 'alumni')
  AND `login_account_people`.`is_default` = 1
ON CONFLICT(`person_id`, `role_id`, `branch_key`) DO NOTHING;
