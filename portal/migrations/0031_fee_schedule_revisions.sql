CREATE TABLE IF NOT EXISTS `fee_schedule_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `enrolment_id` text NOT NULL,
  `fee_agreement_id` text NOT NULL,
  `revision_number` integer NOT NULL,
  `before_json` text NOT NULL,
  `after_json` text NOT NULL,
  `reason` text NOT NULL,
  `created_by_login_account_id` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`),
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`),
  FOREIGN KEY (`enrolment_id`) REFERENCES `enrolments`(`id`),
  FOREIGN KEY (`fee_agreement_id`) REFERENCES `fee_agreements`(`id`),
  FOREIGN KEY (`created_by_login_account_id`) REFERENCES `login_accounts`(`id`),
  CONSTRAINT `fee_schedule_revisions_number_check` CHECK(`revision_number` >= 1),
  CONSTRAINT `fee_schedule_revisions_reason_check` CHECK(length(trim(`reason`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `fee_schedule_revisions_fee_revision_unique` ON `fee_schedule_revisions` (`fee_agreement_id`, `revision_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `fee_schedule_revisions_enrolment_created_idx` ON `fee_schedule_revisions` (`organisation_id`, `enrolment_id`, `created_at`);
