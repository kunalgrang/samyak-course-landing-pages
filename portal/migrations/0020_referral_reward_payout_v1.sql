ALTER TABLE `referral_reward_snapshots` ADD COLUMN `status` text NOT NULL DEFAULT 'approved';
--> statement-breakpoint
ALTER TABLE `referral_reward_snapshots` ADD COLUMN `approved_by_login_account_id` text;
--> statement-breakpoint
ALTER TABLE `referral_reward_snapshots` ADD COLUMN `approved_at` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_reward_payouts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `reward_snapshot_id` text NOT NULL,
  `referral_id` text NOT NULL,
  `amount_paise` integer NOT NULL,
  `payment_date` text NOT NULL,
  `payment_mode` text NOT NULL,
  `payment_reference` text,
  `notes` text,
  `status` text DEFAULT 'paid' NOT NULL,
  `paid_by_login_account_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_fingerprint` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reward_snapshot_id`) REFERENCES `referral_reward_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`referral_id`) REFERENCES `referrals`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`paid_by_login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_reward_payouts_amount_check` CHECK(`amount_paise` > 0),
  CONSTRAINT `referral_reward_payouts_status_check` CHECK(`status` in ('paid')),
  CONSTRAINT `referral_reward_payouts_mode_check` CHECK(`payment_mode` in ('cash', 'upi', 'bank_transfer', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referral_reward_payouts_reward_unique`
  ON `referral_reward_payouts` (`reward_snapshot_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referral_reward_payouts_idempotency_unique`
  ON `referral_reward_payouts` (`organisation_id`, `paid_by_login_account_id`, `idempotency_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_reward_payouts_referral_idx`
  ON `referral_reward_payouts` (`referral_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_reward_payouts_branch_created_idx`
  ON `referral_reward_payouts` (`branch_id`, `created_at`);
