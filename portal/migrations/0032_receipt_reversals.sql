CREATE TABLE IF NOT EXISTS `receipt_reversals` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `receipt_id` text NOT NULL,
  `enrolment_id` text,
  `fee_agreement_id` text,
  `reason` text NOT NULL,
  `reversed_by_login_account_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_fingerprint` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`),
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`),
  FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`),
  FOREIGN KEY (`enrolment_id`) REFERENCES `enrolments`(`id`),
  FOREIGN KEY (`fee_agreement_id`) REFERENCES `fee_agreements`(`id`),
  FOREIGN KEY (`reversed_by_login_account_id`) REFERENCES `login_accounts`(`id`),
  CONSTRAINT `receipt_reversals_reason_check` CHECK(length(trim(`reason`)) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `receipt_reversals_receipt_unique` ON `receipt_reversals` (`receipt_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `receipt_reversals_idempotency_unique` ON `receipt_reversals` (`organisation_id`, `reversed_by_login_account_id`, `idempotency_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `receipt_reversals_org_enrolment_created_idx` ON `receipt_reversals` (`organisation_id`, `enrolment_id`, `created_at`);
--> statement-breakpoint
DROP INDEX IF EXISTS `receipts_one_preconfirm_token_per_draft`;
