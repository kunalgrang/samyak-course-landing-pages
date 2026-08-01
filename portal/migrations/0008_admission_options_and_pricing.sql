ALTER TABLE `courses` ADD COLUMN `duration_months` integer;
--> statement-breakpoint
ALTER TABLE `courses` ADD COLUMN `lowest_acceptable_fee_paise` integer;
--> statement-breakpoint
UPDATE `courses`
SET
  `duration_months` = coalesce(`duration_months`, 6),
  `lowest_acceptable_fee_paise` = coalesce(`lowest_acceptable_fee_paise`, `default_fee_paise`, 0)
WHERE `duration_months` IS NULL OR `lowest_acceptable_fee_paise` IS NULL;
--> statement-breakpoint
CREATE TABLE `admission_option_values` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `category` text NOT NULL,
  `code` text NOT NULL,
  `label` text NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `requires_custom_label` integer DEFAULT 0 NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `admission_option_values_category_check` CHECK(`category` in ('preferred_language', 'qualification_level', 'stream', 'occupation_status', 'batch_preference', 'discount_reason'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admission_option_values_category_code_unique` ON `admission_option_values` (`organisation_id`, `category`, `code`);
--> statement-breakpoint
CREATE INDEX `admission_option_values_category_idx` ON `admission_option_values` (`organisation_id`, `category`, `is_active`);
--> statement-breakpoint
CREATE TABLE `payment_plan_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `min_duration_months` integer NOT NULL,
  `max_duration_months` integer,
  `plan_type` text NOT NULL,
  `fixed_instalments` integer,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `payment_plan_rules_duration_check` CHECK(`min_duration_months` >= 1 and (`max_duration_months` is null or `max_duration_months` >= `min_duration_months`)),
  CONSTRAINT `payment_plan_rules_plan_check` CHECK(`plan_type` in ('full', 'two_instalments', 'three_instalments', 'custom'))
);
--> statement-breakpoint
CREATE INDEX `payment_plan_rules_duration_idx` ON `payment_plan_rules` (`organisation_id`, `min_duration_months`, `max_duration_months`, `is_active`);
--> statement-breakpoint
CREATE TABLE `admission_discount_approvals` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `admission_draft_id` text NOT NULL,
  `enquiry_id` text NOT NULL,
  `course_id` text NOT NULL,
  `requested_final_fee_paise` integer NOT NULL,
  `discount_reason_code` text NOT NULL,
  `discount_reason_text` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `requested_by_login_account_id` text NOT NULL,
  `decided_by_login_account_id` text,
  `decided_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`admission_draft_id`) REFERENCES `admission_drafts`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `admission_discount_approvals_status_check` CHECK(`status` in ('pending', 'approved', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX `admission_discount_approvals_status_idx` ON `admission_discount_approvals` (`organisation_id`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `admission_discount_approvals_draft_idx` ON `admission_discount_approvals` (`admission_draft_id`);
--> statement-breakpoint
