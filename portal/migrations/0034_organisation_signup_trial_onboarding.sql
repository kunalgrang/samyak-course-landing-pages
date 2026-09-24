ALTER TABLE `organisations` ADD COLUMN `legal_name` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `organisation_type` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `legal_entity_type` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `address_line1` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `city` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `state_region` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `country` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `postcode` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `currency` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `timezone` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `website` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `logo_url` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `tax_identifiers_json` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `terms_accepted_at` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `terms_version` text;
--> statement-breakpoint
ALTER TABLE `organisations` ADD COLUMN `terms_accepted_by_global_identity_id` text REFERENCES `global_identities`(`id`);
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `address_line1` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `city` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `state_region` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `postcode` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `country` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `mobile_hash` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `mobile_last_four` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `email` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `currency` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `operating_model` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `centre_status` text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `tax_identifiers_json` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `branches_organisation_name_unique` ON `branches` (`organisation_id`, `name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `signup_verifications` (
  `id` text PRIMARY KEY NOT NULL,
  `challenge_id` text NOT NULL REFERENCES `otp_challenges`(`id`),
  `global_identity_id` text NOT NULL REFERENCES `global_identities`(`id`),
  `mobile_hash` text NOT NULL,
  `mobile_last_four` text NOT NULL,
  `status` text NOT NULL DEFAULT 'verified',
  `created_organisation_id` text REFERENCES `organisations`(`id`),
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `used_at` text,
  CONSTRAINT `signup_verifications_status_check` CHECK(`status` in ('verified', 'used', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `signup_verifications_challenge_unique` ON `signup_verifications` (`challenge_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `signup_verifications_global_identity_idx` ON `signup_verifications` (`global_identity_id`, `status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organisation_account_authorities` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL REFERENCES `organisations`(`id`),
  `global_identity_id` text NOT NULL REFERENCES `global_identities`(`id`),
  `organisation_membership_id` text NOT NULL REFERENCES `organisation_memberships`(`id`),
  `person_id` text REFERENCES `people`(`id`),
  `authority_type` text NOT NULL DEFAULT 'primary',
  `contact_name` text NOT NULL,
  `mobile_hash` text NOT NULL,
  `mobile_last_four` text NOT NULL,
  `email` text NOT NULL,
  `authorisation_required` integer NOT NULL DEFAULT 0,
  `authorisation_status` text NOT NULL DEFAULT 'not_required',
  `document_reference` text,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `organisation_account_authorities_type_check` CHECK(`authority_type` in ('primary', 'authorised')),
  CONSTRAINT `organisation_account_authorities_auth_status_check` CHECK(`authorisation_status` in ('not_required', 'pending_document', 'pending_review', 'verified')),
  CONSTRAINT `organisation_account_authorities_status_check` CHECK(`status` in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organisation_account_authorities_primary_unique` ON `organisation_account_authorities` (`organisation_id`) WHERE `authority_type` = 'primary' AND `status` = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organisation_account_authorities_org_status_idx` ON `organisation_account_authorities` (`organisation_id`, `status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organisation_commercial_access` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL REFERENCES `organisations`(`id`),
  `state` text NOT NULL,
  `trial_started_at` text NOT NULL,
  `trial_ends_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `organisation_commercial_access_state_check` CHECK(`state` in ('trial', 'active', 'past_due', 'grace', 'restricted_read_only', 'expired', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organisation_commercial_access_org_unique` ON `organisation_commercial_access` (`organisation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organisation_commercial_access_state_idx` ON `organisation_commercial_access` (`state`, `trial_ends_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organisation_onboarding_progress` (
  `organisation_id` text PRIMARY KEY NOT NULL REFERENCES `organisations`(`id`),
  `status` text NOT NULL DEFAULT 'in_progress',
  `completed_steps_json` text NOT NULL DEFAULT '[]',
  `checklist_json` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `organisation_onboarding_progress_status_check` CHECK(`status` in ('in_progress', 'complete'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organisation_onboarding_progress_status_idx` ON `organisation_onboarding_progress` (`status`);
