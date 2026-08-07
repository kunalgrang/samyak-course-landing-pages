CREATE TABLE IF NOT EXISTS `referral_programmes` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `validity_days` integer NOT NULL,
  `minimum_fee_percentage` integer NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `starts_at` text,
  `ends_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_programmes_validity_days_check` CHECK(`validity_days` between 1 and 365),
  CONSTRAINT `referral_programmes_min_fee_pct_check` CHECK(`minimum_fee_percentage` between 0 and 100),
  CONSTRAINT `referral_programmes_status_check` CHECK(`status` in ('draft', 'active', 'inactive', 'archived')),
  CONSTRAINT `referral_programmes_dates_check` CHECK(`ends_at` is null or `starts_at` is null or `ends_at` >= `starts_at`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referral_programmes_organisation_code_unique` ON `referral_programmes` (`organisation_id`,`code`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_programmes_organisation_status_idx` ON `referral_programmes` (`organisation_id`,`status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_programme_referrer_types` (
  `referral_programme_id` text NOT NULL,
  `referrer_type` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`referral_programme_id`, `referrer_type`),
  FOREIGN KEY (`referral_programme_id`) REFERENCES `referral_programmes`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_programme_referrer_types_type_check` CHECK(`referrer_type` in ('student', 'alumni'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_programme_referrer_types_type_idx` ON `referral_programme_referrer_types` (`referrer_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_programme_referrer_types_programme_idx` ON `referral_programme_referrer_types` (`referral_programme_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_programme_courses` (
  `referral_programme_id` text NOT NULL,
  `course_id` text NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`referral_programme_id`, `course_id`),
  FOREIGN KEY (`referral_programme_id`) REFERENCES `referral_programmes`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_programme_courses_course_id_idx` ON `referral_programme_courses` (`course_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_programme_courses_programme_active_idx` ON `referral_programme_courses` (`referral_programme_id`,`is_active`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_links` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `referral_programme_id` text NOT NULL,
  `referrer_profile_id` text NOT NULL,
  `token_hash` text NOT NULL,
  `token_last_four` text,
  `link_version` integer DEFAULT 1 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `activated_at` text,
  `expires_at` text,
  `revoked_at` text,
  `last_used_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`referral_programme_id`) REFERENCES `referral_programmes`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`referrer_profile_id`) REFERENCES `referrer_profiles`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_links_status_check` CHECK(`status` in ('active', 'revoked', 'expired')),
  CONSTRAINT `referral_links_version_check` CHECK(`link_version` >= 1),
  CONSTRAINT `referral_links_revoked_at_check` CHECK(`status` != 'revoked' or `revoked_at` is not null),
  CONSTRAINT `referral_links_expiry_check` CHECK(`expires_at` is null or `activated_at` is null or `expires_at` > `activated_at`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referral_links_organisation_token_hash_unique` ON `referral_links` (`organisation_id`,`token_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_links_referrer_status_idx` ON `referral_links` (`referrer_profile_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_links_programme_status_idx` ON `referral_links` (`referral_programme_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_links_expires_at_idx` ON `referral_links` (`expires_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referrals` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `referral_programme_id` text NOT NULL,
  `referral_link_id` text,
  `referrer_profile_id` text NOT NULL,
  `prospect_person_id` text,
  `enquiry_id` text,
  `course_interest_id` text,
  `source` text NOT NULL,
  `status` text DEFAULT 'submitted' NOT NULL,
  `submitted_at` text NOT NULL,
  `valid_until` text NOT NULL,
  `attributed_at` text,
  `expired_at` text,
  `closed_at` text,
  `closure_reason` text,
  `prospect_mobile_hash` text NOT NULL,
  `prospect_mobile_last_four` text,
  `prospect_mobile_ciphertext` text,
  `prospect_email_ciphertext` text,
  `consent_recorded_at` text,
  `idempotency_key_hash` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`referral_programme_id`) REFERENCES `referral_programmes`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`referral_link_id`) REFERENCES `referral_links`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`referrer_profile_id`) REFERENCES `referrer_profiles`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`prospect_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`course_interest_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referrals_source_check` CHECK(`source` in ('personal_link', 'staff_entry', 'import')),
  CONSTRAINT `referrals_status_check` CHECK(`status` in ('submitted', 'accepted', 'rejected', 'active', 'converted', 'expired', 'cancelled', 'closed')),
  CONSTRAINT `referrals_closure_reason_check` CHECK(`closure_reason` is null or `closure_reason` in ('existing_enquiry', 'current_student', 'former_student', 'active_duplicate', 'invalid_mobile', 'invalid_link', 'inactive_programme', 'ineligible_course', 'consent_missing', 'expired', 'admission_cancelled', 'manual_closure')),
  CONSTRAINT `referrals_validity_check` CHECK(`valid_until` > `submitted_at`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_organisation_status_idx` ON `referrals` (`organisation_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_branch_status_idx` ON `referrals` (`branch_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_referrer_submitted_idx` ON `referrals` (`referrer_profile_id`,`submitted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_enquiry_id_idx` ON `referrals` (`enquiry_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referrals_enquiry_unique` ON `referrals` (`enquiry_id`) WHERE `enquiry_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_prospect_person_idx` ON `referrals` (`prospect_person_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_course_interest_idx` ON `referrals` (`course_interest_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_valid_until_idx` ON `referrals` (`valid_until`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_mobile_status_valid_idx` ON `referrals` (`prospect_mobile_hash`,`status`,`valid_until`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referrals_organisation_idempotency_unique` ON `referrals` (`organisation_id`,`idempotency_key_hash`) WHERE `idempotency_key_hash` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_status_events` (
  `id` text PRIMARY KEY NOT NULL,
  `referral_id` text NOT NULL,
  `from_status` text,
  `to_status` text NOT NULL,
  `event_type` text NOT NULL,
  `actor_login_account_id` text,
  `actor_person_id` text,
  `system_actor` text,
  `reason_code` text,
  `public_note` text,
  `internal_note` text,
  `metadata_json` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`referral_id`) REFERENCES `referrals`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`actor_login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`actor_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_status_events_from_status_check` CHECK(`from_status` is null or `from_status` in ('submitted', 'accepted', 'rejected', 'active', 'converted', 'expired', 'cancelled', 'closed')),
  CONSTRAINT `referral_status_events_to_status_check` CHECK(`to_status` in ('submitted', 'accepted', 'rejected', 'active', 'converted', 'expired', 'cancelled', 'closed')),
  CONSTRAINT `referral_status_events_actor_check` CHECK(`actor_login_account_id` is not null or `system_actor` is not null)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_status_events_referral_created_idx` ON `referral_status_events` (`referral_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_status_events_actor_login_idx` ON `referral_status_events` (`actor_login_account_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_status_events_event_created_idx` ON `referral_status_events` (`event_type`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_reward_rule_sets` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `referral_programme_id` text NOT NULL,
  `version` integer NOT NULL,
  `name` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `effective_from` text,
  `effective_until` text,
  `created_by_login_account_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`referral_programme_id`) REFERENCES `referral_programmes`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_reward_rule_sets_version_check` CHECK(`version` >= 1),
  CONSTRAINT `referral_reward_rule_sets_status_check` CHECK(`status` in ('draft', 'active', 'superseded', 'archived')),
  CONSTRAINT `referral_reward_rule_sets_dates_check` CHECK(`effective_until` is null or `effective_from` is null or `effective_until` >= `effective_from`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referral_reward_rule_sets_programme_version_unique` ON `referral_reward_rule_sets` (`referral_programme_id`,`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referral_reward_rule_sets_one_active_unique` ON `referral_reward_rule_sets` (`referral_programme_id`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_reward_rule_sets_org_status_idx` ON `referral_reward_rule_sets` (`organisation_id`,`status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_reward_slabs` (
  `id` text PRIMARY KEY NOT NULL,
  `reward_rule_set_id` text NOT NULL,
  `min_final_fee_paise` integer NOT NULL,
  `max_final_fee_paise` integer,
  `cash_reward_paise` integer NOT NULL,
  `course_credit_paise` integer NOT NULL,
  `sort_order` integer NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`reward_rule_set_id`) REFERENCES `referral_reward_rule_sets`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_reward_slabs_money_check` CHECK(`min_final_fee_paise` >= 0 and (`max_final_fee_paise` is null or `max_final_fee_paise` >= `min_final_fee_paise`) and `cash_reward_paise` >= 0 and `course_credit_paise` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referral_reward_slabs_rule_sort_unique` ON `referral_reward_slabs` (`reward_rule_set_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_reward_slabs_rule_set_idx` ON `referral_reward_slabs` (`reward_rule_set_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `referral_reward_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `referral_id` text NOT NULL,
  `enrolment_id` text NOT NULL,
  `fee_agreement_id` text NOT NULL,
  `reward_rule_set_id` text NOT NULL,
  `slab_id` text,
  `final_agreed_fee_paise` integer NOT NULL,
  `minimum_fee_percentage` integer NOT NULL,
  `minimum_qualifying_payment_paise` integer NOT NULL,
  `cash_reward_paise` integer NOT NULL,
  `course_credit_paise` integer NOT NULL,
  `snapshot_version` integer DEFAULT 1 NOT NULL,
  `snapshot_json` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`referral_id`) REFERENCES `referrals`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`enrolment_id`) REFERENCES `enrolments`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`fee_agreement_id`) REFERENCES `fee_agreements`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`reward_rule_set_id`) REFERENCES `referral_reward_rule_sets`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`slab_id`) REFERENCES `referral_reward_slabs`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `referral_reward_snapshots_money_check` CHECK(`final_agreed_fee_paise` >= 0 and `minimum_qualifying_payment_paise` >= 0 and `cash_reward_paise` >= 0 and `course_credit_paise` >= 0),
  CONSTRAINT `referral_reward_snapshots_pct_check` CHECK(`minimum_fee_percentage` between 0 and 100),
  CONSTRAINT `referral_reward_snapshots_version_check` CHECK(`snapshot_version` >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referral_reward_snapshots_referral_enrolment_unique` ON `referral_reward_snapshots` (`referral_id`,`enrolment_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_reward_snapshots_enrolment_idx` ON `referral_reward_snapshots` (`enrolment_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referral_reward_snapshots_fee_agreement_idx` ON `referral_reward_snapshots` (`fee_agreement_id`);
--> statement-breakpoint
ALTER TABLE `enrolments` ADD COLUMN `referral_id` text REFERENCES `referrals`(`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `enrolments_referral_id_idx` ON `enrolments` (`referral_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `enrolments_referrer_profile_id_idx` ON `enrolments` (`referrer_profile_id`);
--> statement-breakpoint
WITH programme_defaults AS (
  SELECT
    'rprog_samyak_skill_circle' AS id,
    organisations.id AS organisation_id,
    'samyak_skill_circle' AS code,
    'Samyak Skill Circle' AS name,
    90 AS validity_days,
    50 AS minimum_fee_percentage,
    'active' AS status,
    '2026-08-05T00:00:00.000Z' AS starts_at,
    '2026-08-05T00:00:00.000Z' AS created_at,
    '2026-08-05T00:00:00.000Z' AS updated_at
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
WITH referrer_type_defaults(referrer_type) AS (
  VALUES ('student'), ('alumni')
)
INSERT OR IGNORE INTO referral_programme_referrer_types
  (referral_programme_id, referrer_type, created_at)
SELECT referral_programmes.id, referrer_type_defaults.referrer_type, '2026-08-05T00:00:00.000Z'
FROM referrer_type_defaults
JOIN referral_programmes ON referral_programmes.organisation_id = 'org_samyak'
  AND referral_programmes.code = 'samyak_skill_circle';
--> statement-breakpoint
WITH rule_defaults AS (
  SELECT
    'rrs_samyak_skill_circle_v1' AS id,
    referral_programmes.organisation_id,
    referral_programmes.id AS referral_programme_id,
    1 AS version,
    'Samyak Skill Circle Rewards v1' AS name,
    'active' AS status,
    '2026-08-05T00:00:00.000Z' AS effective_from,
    '2026-08-05T00:00:00.000Z' AS created_at,
    '2026-08-05T00:00:00.000Z' AS updated_at
  FROM referral_programmes
  WHERE referral_programmes.organisation_id = 'org_samyak'
    AND referral_programmes.code = 'samyak_skill_circle'
)
INSERT INTO referral_reward_rule_sets
  (id, organisation_id, referral_programme_id, version, name, status, effective_from, effective_until, created_by_login_account_id, created_at, updated_at)
SELECT id, organisation_id, referral_programme_id, version, name, status, effective_from, NULL, NULL, created_at, updated_at
FROM rule_defaults
WHERE true
ON CONFLICT(referral_programme_id, version) DO UPDATE SET
  name = excluded.name,
  status = excluded.status,
  effective_from = excluded.effective_from,
  effective_until = excluded.effective_until,
  updated_at = excluded.updated_at;
--> statement-breakpoint
WITH slab_defaults(id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order) AS (
  VALUES
    ('rrs_samyak_skill_circle_v1_slab_1', 0, 999999, 50000, 75000, 10),
    ('rrs_samyak_skill_circle_v1_slab_2', 1000000, 1999999, 75000, 100000, 20),
    ('rrs_samyak_skill_circle_v1_slab_3', 2000000, 2999999, 100000, 150000, 30),
    ('rrs_samyak_skill_circle_v1_slab_4', 3000000, NULL, 150000, 200000, 40)
)
INSERT INTO referral_reward_slabs
  (id, reward_rule_set_id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order, created_at, updated_at)
SELECT
  slab_defaults.id,
  referral_reward_rule_sets.id,
  slab_defaults.min_final_fee_paise,
  slab_defaults.max_final_fee_paise,
  slab_defaults.cash_reward_paise,
  slab_defaults.course_credit_paise,
  slab_defaults.sort_order,
  '2026-08-05T00:00:00.000Z',
  '2026-08-05T00:00:00.000Z'
FROM slab_defaults
JOIN referral_reward_rule_sets ON referral_reward_rule_sets.id = 'rrs_samyak_skill_circle_v1'
JOIN referral_programmes ON referral_programmes.id = referral_reward_rule_sets.referral_programme_id
WHERE referral_programmes.organisation_id = 'org_samyak'
  AND referral_programmes.code = 'samyak_skill_circle'
ON CONFLICT(reward_rule_set_id, sort_order) DO UPDATE SET
  min_final_fee_paise = excluded.min_final_fee_paise,
  max_final_fee_paise = excluded.max_final_fee_paise,
  cash_reward_paise = excluded.cash_reward_paise,
  course_credit_paise = excluded.course_credit_paise,
  updated_at = excluded.updated_at;
