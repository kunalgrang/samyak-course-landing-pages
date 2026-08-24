CREATE TABLE IF NOT EXISTS `education_partners` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `home_branch_id` text NOT NULL,
  `partner_type` text NOT NULL,
  `business_name` text NOT NULL,
  `contact_person_name` text NOT NULL,
  `mobile_hash` text,
  `mobile_last_four` text,
  `mobile_ciphertext` text,
  `email_hash` text,
  `email_ciphertext` text,
  `status` text DEFAULT 'active' NOT NULL,
  `current_commission_basis_points` integer NOT NULL,
  `internal_notes` text,
  `created_by_login_account_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`home_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `education_partners_type_check` CHECK(`partner_type` in ('college', 'coaching_class', 'tuition_centre', 'training_institute', 'career_counsellor', 'placement_consultant', 'freelancer', 'other')),
  CONSTRAINT `education_partners_status_check` CHECK(`status` in ('active', 'inactive')),
  CONSTRAINT `education_partners_commission_bps_check` CHECK(`current_commission_basis_points` between 0 and 10000),
  CONSTRAINT `education_partners_active_commission_check` CHECK(`status` != 'active' OR `current_commission_basis_points` > 0),
  CONSTRAINT `education_partners_name_check` CHECK(length(trim(`business_name`)) between 1 and 160),
  CONSTRAINT `education_partners_contact_name_check` CHECK(length(trim(`contact_person_name`)) between 1 and 120)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `education_partners_org_status_name_idx` ON `education_partners` (`organisation_id`,`status`,`business_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `education_partners_branch_status_idx` ON `education_partners` (`home_branch_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `education_partners_mobile_hash_idx` ON `education_partners` (`organisation_id`,`mobile_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `education_partners_email_hash_idx` ON `education_partners` (`organisation_id`,`email_hash`);
--> statement-breakpoint
ALTER TABLE `referral_reward_rule_sets` ADD COLUMN `reward_model_type` text NOT NULL DEFAULT 'fee_slab';
--> statement-breakpoint
ALTER TABLE `referrals` ADD COLUMN `education_partner_id` text REFERENCES `education_partners`(`id`);
--> statement-breakpoint
ALTER TABLE `referrals` ADD COLUMN `partner_commission_basis_points` integer;
--> statement-breakpoint
ALTER TABLE `referrals` ADD COLUMN `gst_basis_points_applicable` integer;
--> statement-breakpoint
ALTER TABLE `referral_reward_snapshots` ADD COLUMN `reward_model_type` text NOT NULL DEFAULT 'fee_slab';
--> statement-breakpoint
ALTER TABLE `referral_reward_snapshots` ADD COLUMN `education_partner_id` text REFERENCES `education_partners`(`id`);
--> statement-breakpoint
ALTER TABLE `referral_reward_snapshots` ADD COLUMN `partner_commission_basis_points` integer;
--> statement-breakpoint
ALTER TABLE `referral_reward_snapshots` ADD COLUMN `gst_basis_points_applicable` integer;
--> statement-breakpoint
ALTER TABLE `referral_reward_snapshots` ADD COLUMN `pre_gst_final_fee_paise` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_education_partner_submitted_idx` ON `referrals` (`education_partner_id`,`submitted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_reward_snapshots_partner_idx` ON `referral_reward_snapshots` (`education_partner_id`);
--> statement-breakpoint
CREATE TABLE `referral_programme_referrer_types_0021` (
  `referral_programme_id` text NOT NULL,
  `referrer_type` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`referral_programme_id`, `referrer_type`),
  FOREIGN KEY (`referral_programme_id`) REFERENCES `referral_programmes`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_programme_referrer_types_type_check` CHECK(`referrer_type` in ('student', 'alumni', 'education_partner'))
);
--> statement-breakpoint
INSERT INTO `referral_programme_referrer_types_0021` (`referral_programme_id`, `referrer_type`, `created_at`)
SELECT `referral_programme_id`, `referrer_type`, `created_at`
FROM `referral_programme_referrer_types`;
--> statement-breakpoint
DROP TABLE `referral_programme_referrer_types`;
--> statement-breakpoint
ALTER TABLE `referral_programme_referrer_types_0021` RENAME TO `referral_programme_referrer_types`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_programme_referrer_types_type_idx` ON `referral_programme_referrer_types` (`referrer_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_programme_referrer_types_programme_idx` ON `referral_programme_referrer_types` (`referral_programme_id`);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `referrer_profiles_0021` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `person_id` text REFERENCES `people`(`id`),
  `external_referrer_id` text NOT NULL,
  `referral_token` text NOT NULL,
  `personal_link` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `last_synced_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `referrer_profiles_0021`
SELECT `id`, `organisation_id`, `person_id`, `external_referrer_id`, `referral_token`, `personal_link`, `active`, `last_synced_at`, `created_at`, `updated_at`
FROM `referrer_profiles`;
--> statement-breakpoint
DROP TABLE `referrer_profiles`;
--> statement-breakpoint
ALTER TABLE `referrer_profiles_0021` RENAME TO `referrer_profiles`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referrer_profiles_organisation_external_referrer_unique` ON `referrer_profiles` (`organisation_id`,`external_referrer_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referrer_profiles_organisation_referral_token_unique` ON `referrer_profiles` (`organisation_id`,`referral_token`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referrer_profiles_person_id_unique` ON `referrer_profiles` (`person_id`) WHERE `person_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrer_profiles_organisation_id_idx` ON `referrer_profiles` (`organisation_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `education_partner_referrer_profiles` (
  `education_partner_id` text NOT NULL,
  `referrer_profile_id` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`education_partner_id`, `referrer_profile_id`),
  FOREIGN KEY (`education_partner_id`) REFERENCES `education_partners`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`referrer_profile_id`) REFERENCES `referrer_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `education_partner_referrer_profiles_profile_unique` ON `education_partner_referrer_profiles` (`referrer_profile_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `education_partner_referrer_profiles_partner_unique` ON `education_partner_referrer_profiles` (`education_partner_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `education_partner_bridge_personless_insert_check`
BEFORE INSERT ON `education_partner_referrer_profiles`
WHEN (SELECT `person_id` FROM `referrer_profiles` WHERE `id` = NEW.`referrer_profile_id`) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'education partner referrer profile must not have person_id');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `referrer_profiles_partner_person_update_check`
BEFORE UPDATE OF `person_id` ON `referrer_profiles`
WHEN NEW.`person_id` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `education_partner_referrer_profiles` WHERE `referrer_profile_id` = NEW.`id`)
BEGIN
  SELECT RAISE(ABORT, 'education partner referrer profile must not have person_id');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `referral_reward_rule_sets_model_insert_check`
BEFORE INSERT ON `referral_reward_rule_sets`
WHEN NEW.`reward_model_type` NOT IN ('fee_slab', 'partner_percentage')
BEGIN
  SELECT RAISE(ABORT, 'invalid reward model type');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `referral_reward_rule_sets_model_update_check`
BEFORE UPDATE OF `reward_model_type` ON `referral_reward_rule_sets`
WHEN NEW.`reward_model_type` NOT IN ('fee_slab', 'partner_percentage')
BEGIN
  SELECT RAISE(ABORT, 'invalid reward model type');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `referrals_partner_snapshot_insert_check`
BEFORE INSERT ON `referrals`
WHEN (
    NEW.`education_partner_id` IS NULL
    AND (NEW.`partner_commission_basis_points` IS NOT NULL OR NEW.`gst_basis_points_applicable` IS NOT NULL)
  )
  OR (
    NEW.`education_partner_id` IS NOT NULL
    AND (
      NEW.`partner_commission_basis_points` IS NULL
      OR NEW.`gst_basis_points_applicable` IS NULL
      OR NEW.`partner_commission_basis_points` NOT BETWEEN 0 AND 10000
      OR NEW.`gst_basis_points_applicable` < 0
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid education partner referral snapshot');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `referrals_partner_snapshot_update_check`
BEFORE UPDATE OF `education_partner_id`, `partner_commission_basis_points`, `gst_basis_points_applicable` ON `referrals`
WHEN OLD.`education_partner_id` IS NOT NEW.`education_partner_id`
  OR OLD.`partner_commission_basis_points` IS NOT NEW.`partner_commission_basis_points`
  OR OLD.`gst_basis_points_applicable` IS NOT NEW.`gst_basis_points_applicable`
BEGIN
  SELECT RAISE(ABORT, 'education partner referral snapshot is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `referral_reward_snapshots_model_insert_check`
BEFORE INSERT ON `referral_reward_snapshots`
WHEN NEW.`reward_model_type` NOT IN ('fee_slab', 'partner_percentage')
  OR (
    NEW.`reward_model_type` = 'partner_percentage'
    AND (
      NEW.`education_partner_id` IS NULL
      OR NEW.`partner_commission_basis_points` IS NULL
      OR NEW.`gst_basis_points_applicable` IS NULL
      OR NEW.`pre_gst_final_fee_paise` IS NULL
      OR NEW.`slab_id` IS NOT NULL
      OR NEW.`course_credit_paise` != 0
      OR NEW.`partner_commission_basis_points` NOT BETWEEN 0 AND 10000
      OR NEW.`gst_basis_points_applicable` < 0
      OR NEW.`pre_gst_final_fee_paise` < 0
    )
  )
  OR (
    NEW.`reward_model_type` = 'fee_slab'
    AND (
      NEW.`education_partner_id` IS NOT NULL
      OR NEW.`partner_commission_basis_points` IS NOT NULL
      OR NEW.`gst_basis_points_applicable` IS NOT NULL
      OR NEW.`pre_gst_final_fee_paise` IS NOT NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid reward snapshot model shape');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `referral_reward_snapshots_model_update_check`
BEFORE UPDATE OF `reward_model_type`, `education_partner_id`, `partner_commission_basis_points`, `gst_basis_points_applicable`, `pre_gst_final_fee_paise`, `slab_id`, `course_credit_paise` ON `referral_reward_snapshots`
WHEN NEW.`reward_model_type` NOT IN ('fee_slab', 'partner_percentage')
  OR (
    NEW.`reward_model_type` = 'partner_percentage'
    AND (
      NEW.`education_partner_id` IS NULL
      OR NEW.`partner_commission_basis_points` IS NULL
      OR NEW.`gst_basis_points_applicable` IS NULL
      OR NEW.`pre_gst_final_fee_paise` IS NULL
      OR NEW.`slab_id` IS NOT NULL
      OR NEW.`course_credit_paise` != 0
      OR NEW.`partner_commission_basis_points` NOT BETWEEN 0 AND 10000
      OR NEW.`gst_basis_points_applicable` < 0
      OR NEW.`pre_gst_final_fee_paise` < 0
    )
  )
  OR (
    NEW.`reward_model_type` = 'fee_slab'
    AND (
      NEW.`education_partner_id` IS NOT NULL
      OR NEW.`partner_commission_basis_points` IS NOT NULL
      OR NEW.`gst_basis_points_applicable` IS NOT NULL
      OR NEW.`pre_gst_final_fee_paise` IS NOT NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid reward snapshot model shape');
END;
--> statement-breakpoint
UPDATE referral_reward_rule_sets
SET reward_model_type = 'fee_slab'
WHERE reward_model_type IS NULL OR reward_model_type = '';
--> statement-breakpoint
WITH programme_defaults AS (
  SELECT
    'rprog_samyak_education_partners' AS id,
    organisations.id AS organisation_id,
    'samyak_education_partners' AS code,
    'Samyak Education Partner Programme' AS name,
    90 AS validity_days,
    50 AS minimum_fee_percentage,
    'active' AS status,
    '2026-08-24T00:00:00.000Z' AS starts_at,
    '2026-08-24T00:00:00.000Z' AS created_at,
    '2026-08-24T00:00:00.000Z' AS updated_at
  FROM organisations
  WHERE organisations.id = 'org_samyak'
)
INSERT INTO referral_programmes
  (id, organisation_id, code, name, validity_days, minimum_fee_percentage, status, starts_at, ends_at, created_at, updated_at)
SELECT id, organisation_id, code, name, validity_days, minimum_fee_percentage, status, starts_at, NULL, created_at, updated_at
FROM programme_defaults
WHERE true
ON CONFLICT(organisation_id, code) DO UPDATE SET
  name = excluded.name,
  validity_days = excluded.validity_days,
  minimum_fee_percentage = excluded.minimum_fee_percentage,
  status = excluded.status,
  updated_at = excluded.updated_at;
--> statement-breakpoint
INSERT OR IGNORE INTO referral_programme_referrer_types
  (referral_programme_id, referrer_type, created_at)
SELECT id, 'education_partner', '2026-08-24T00:00:00.000Z'
FROM referral_programmes
WHERE organisation_id = 'org_samyak' AND code = 'samyak_education_partners';
--> statement-breakpoint
INSERT INTO referral_reward_rule_sets
  (id, organisation_id, referral_programme_id, version, name, status, effective_from, effective_until, created_by_login_account_id, created_at, updated_at, reward_model_type)
SELECT 'rrs_samyak_education_partners_v1', organisation_id, id, 1, 'Samyak Education Partner Commission v1', 'active', '2026-08-24T00:00:00.000Z', NULL, NULL, '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 'partner_percentage'
FROM referral_programmes
WHERE organisation_id = 'org_samyak' AND code = 'samyak_education_partners'
  AND true
ON CONFLICT(referral_programme_id, version) DO UPDATE SET
  name = excluded.name,
  status = excluded.status,
  reward_model_type = excluded.reward_model_type,
  updated_at = excluded.updated_at;
--> statement-breakpoint
CREATE TABLE `referral_reward_payouts_0021` (
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
  CONSTRAINT `referral_reward_payouts_mode_check` CHECK(`payment_mode` in ('cash', 'upi', 'bank_transfer', 'cheque', 'other'))
);
--> statement-breakpoint
INSERT INTO `referral_reward_payouts_0021`
SELECT `id`, `organisation_id`, `branch_id`, `reward_snapshot_id`, `referral_id`, `amount_paise`,
  `payment_date`, `payment_mode`, `payment_reference`, `notes`, `status`, `paid_by_login_account_id`,
  `idempotency_key`, `payload_fingerprint`, `created_at`, `updated_at`
FROM `referral_reward_payouts`;
--> statement-breakpoint
DROP TABLE `referral_reward_payouts`;
--> statement-breakpoint
ALTER TABLE `referral_reward_payouts_0021` RENAME TO `referral_reward_payouts`;
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
