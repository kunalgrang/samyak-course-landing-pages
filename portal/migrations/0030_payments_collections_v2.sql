PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `collection_followups` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `student_id` text NOT NULL,
  `enrolment_id` text NOT NULL,
  `followup_type` text NOT NULL,
  `outcome` text NOT NULL,
  `note` text NOT NULL DEFAULT '',
  `promised_payment_date` text,
  `promised_amount_paise` integer,
  `next_follow_up_at` text,
  `created_by_login_account_id` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`),
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`),
  FOREIGN KEY (`student_id`) REFERENCES `students`(`id`),
  FOREIGN KEY (`enrolment_id`) REFERENCES `enrolments`(`id`),
  FOREIGN KEY (`created_by_login_account_id`) REFERENCES `login_accounts`(`id`),
  CONSTRAINT `collection_followups_type_check` CHECK(`followup_type` in ('call', 'whatsapp', 'in_person', 'other')),
  CONSTRAINT `collection_followups_outcome_check` CHECK(`outcome` in ('contacted', 'not_reachable', 'promised_payment', 'paid_or_receipt_pending', 'dispute_or_query', 'follow_up_later')),
  CONSTRAINT `collection_followups_promise_date_check` CHECK(`outcome` <> 'promised_payment' or `promised_payment_date` is not null),
  CONSTRAINT `collection_followups_promise_amount_check` CHECK(`promised_amount_paise` is null or `promised_amount_paise` > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `collection_followups_org_branch_next_idx` ON `collection_followups` (`organisation_id`, `branch_id`, `next_follow_up_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `collection_followups_org_enrolment_created_idx` ON `collection_followups` (`organisation_id`, `enrolment_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `collection_followups_org_promise_idx` ON `collection_followups` (`organisation_id`, `promised_payment_date`);
