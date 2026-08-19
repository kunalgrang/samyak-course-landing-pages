PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `receipt_number` text NOT NULL,
  `receipt_year` integer NOT NULL,
  `enquiry_id` text,
  `admission_draft_id` text,
  `person_id` text NOT NULL,
  `student_id` text,
  `enrolment_id` text,
  `fee_agreement_id` text,
  `amount_paise` integer NOT NULL,
  `received_at` text NOT NULL,
  `payment_mode` text NOT NULL,
  `payment_reference` text,
  `notes` text,
  `status` text NOT NULL DEFAULT 'recorded',
  `created_by_login_account_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_fingerprint` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`),
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`),
  FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`),
  FOREIGN KEY (`admission_draft_id`) REFERENCES `admission_drafts`(`id`),
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`),
  FOREIGN KEY (`student_id`) REFERENCES `students`(`id`),
  FOREIGN KEY (`enrolment_id`) REFERENCES `enrolments`(`id`),
  FOREIGN KEY (`fee_agreement_id`) REFERENCES `fee_agreements`(`id`),
  CONSTRAINT `receipts_amount_positive_check` CHECK(`amount_paise` > 0),
  CONSTRAINT `receipts_status_check` CHECK(`status` in ('recorded')),
  CONSTRAINT `receipts_payment_mode_check` CHECK(`payment_mode` in ('cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `receipts_number_unique` ON `receipts` (`organisation_id`, `branch_id`, `receipt_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `receipts_idempotency_unique` ON `receipts` (`organisation_id`, `created_by_login_account_id`, `idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `receipts_one_preconfirm_token_per_draft` ON `receipts` (`admission_draft_id`) WHERE `enrolment_id` IS NULL AND `status` = 'recorded';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `receipts_enquiry_created_idx` ON `receipts` (`enquiry_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `receipts_draft_created_idx` ON `receipts` (`admission_draft_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `receipts_enrolment_created_idx` ON `receipts` (`enrolment_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `receipts_fee_agreement_created_idx` ON `receipts` (`fee_agreement_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fee_agreement_instalments` (
  `id` text PRIMARY KEY NOT NULL,
  `fee_agreement_id` text NOT NULL,
  `instalment_number` integer NOT NULL,
  `amount_paise` integer NOT NULL,
  `due_date` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`fee_agreement_id`) REFERENCES `fee_agreements`(`id`),
  CONSTRAINT `fee_agreement_instalments_number_check` CHECK(`instalment_number` >= 1),
  CONSTRAINT `fee_agreement_instalments_amount_check` CHECK(`amount_paise` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `fee_agreement_instalments_unique` ON `fee_agreement_instalments` (`fee_agreement_id`, `instalment_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `fee_agreement_instalments_order_idx` ON `fee_agreement_instalments` (`fee_agreement_id`, `instalment_number`);
