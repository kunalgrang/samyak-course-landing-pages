DROP INDEX IF EXISTS `payment_plan_rules_duration_idx`;

--> statement-breakpoint
ALTER TABLE `payment_plan_rules` RENAME TO `payment_plan_rules_old`;

--> statement-breakpoint
CREATE TABLE `payment_plan_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `min_duration_months` real NOT NULL,
  `max_duration_months` real,
  `plan_type` text NOT NULL,
  `fixed_instalments` integer,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `payment_plan_rules_duration_check` CHECK(`min_duration_months` >= 0.5 and (`max_duration_months` is null or `max_duration_months` >= `min_duration_months`)),
  CONSTRAINT `payment_plan_rules_plan_check` CHECK(`plan_type` in ('full', 'two_instalments', 'three_instalments', 'custom'))
);

--> statement-breakpoint
INSERT INTO `payment_plan_rules`
  (`id`, `organisation_id`, `min_duration_months`, `max_duration_months`, `plan_type`, `fixed_instalments`, `is_active`, `created_at`, `updated_at`)
SELECT `id`, `organisation_id`, `min_duration_months`, `max_duration_months`, `plan_type`, `fixed_instalments`, `is_active`, `created_at`, `updated_at`
FROM `payment_plan_rules_old`;

--> statement-breakpoint
DROP TABLE `payment_plan_rules_old`;

--> statement-breakpoint
CREATE INDEX `payment_plan_rules_duration_idx` ON `payment_plan_rules` (`organisation_id`, `min_duration_months`, `max_duration_months`, `is_active`);

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `min_duration_months` = 0.5,
    `max_duration_months` = NULL,
    `updated_at` = '2026-10-01T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `id` = 'payrule_one_full';

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `is_active` = 0,
    `updated_at` = '2026-10-01T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `id` IN ('payrule_short_full', 'payrule_mid_full', 'payrule_long_full');
