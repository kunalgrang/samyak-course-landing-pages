ALTER TABLE `referrals` ADD COLUMN `idempotency_payload_hash` text;
--> statement-breakpoint
ALTER TABLE `referrals` ADD COLUMN `active_duplicate_key` text;
--> statement-breakpoint
ALTER TABLE `referrals` ADD COLUMN `prospect_name` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referral_links_one_active_referrer_programme_unique`
  ON `referral_links` (`organisation_id`,`referral_programme_id`,`referrer_profile_id`)
  WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_organisation_mobile_status_valid_idx`
  ON `referrals` (`organisation_id`,`prospect_mobile_hash`,`status`,`valid_until`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `referrals_active_duplicate_unique`
  ON `referrals` (`organisation_id`,`active_duplicate_key`)
  WHERE `active_duplicate_key` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `referrals_idempotency_payload_idx`
  ON `referrals` (`organisation_id`,`idempotency_key_hash`,`idempotency_payload_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `enquiries_organisation_mobile_idx`
  ON `enquiries` (`organisation_id`,`mobile_used`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `person_contacts_type_value_idx`
  ON `person_contacts` (`contact_type`,`normalized_value`);
