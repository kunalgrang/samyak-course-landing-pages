CREATE TABLE IF NOT EXISTS `global_identities` (
  `id` text PRIMARY KEY NOT NULL,
  `mobile_normalized` text NOT NULL,
  `mobile_hash` text,
  `mobile_last_four` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `global_identities_status_check` CHECK(`status` in ('active', 'suspended', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `global_identities_mobile_normalized_unique` ON `global_identities` (`mobile_normalized`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `global_identities_mobile_hash_idx` ON `global_identities` (`mobile_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organisation_memberships` (
  `id` text PRIMARY KEY NOT NULL,
  `global_identity_id` text NOT NULL,
  `organisation_id` text NOT NULL,
  `login_account_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`global_identity_id`) REFERENCES `global_identities`(`id`),
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`),
  FOREIGN KEY (`login_account_id`) REFERENCES `login_accounts`(`id`),
  CONSTRAINT `organisation_memberships_status_check` CHECK(`status` in ('active', 'suspended', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organisation_memberships_identity_org_unique` ON `organisation_memberships` (`global_identity_id`, `organisation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organisation_memberships_login_account_unique` ON `organisation_memberships` (`login_account_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organisation_memberships_org_status_idx` ON `organisation_memberships` (`organisation_id`, `status`);
--> statement-breakpoint
ALTER TABLE `login_accounts` ADD COLUMN `global_identity_id` text REFERENCES `global_identities`(`id`);
--> statement-breakpoint
ALTER TABLE `login_accounts` ADD COLUMN `organisation_membership_id` text REFERENCES `organisation_memberships`(`id`);
--> statement-breakpoint
ALTER TABLE `user_sessions` ADD COLUMN `organisation_membership_id` text REFERENCES `organisation_memberships`(`id`);
--> statement-breakpoint
INSERT INTO `global_identities` (
  `id`,
  `mobile_normalized`,
  `mobile_hash`,
  `mobile_last_four`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  'gident_' || replace(min(`id`), '-', '_'),
  `mobile_normalized`,
  coalesce(max(`mobile_hash`), `mobile_normalized`),
  max(`mobile_last_four`),
  'active',
  min(`created_at`),
  max(`updated_at`)
FROM `login_accounts`
GROUP BY `mobile_normalized`
ON CONFLICT(`mobile_normalized`) DO UPDATE SET
  `mobile_hash` = coalesce(`global_identities`.`mobile_hash`, excluded.`mobile_hash`),
  `mobile_last_four` = excluded.`mobile_last_four`,
  `updated_at` = excluded.`updated_at`;
--> statement-breakpoint
INSERT INTO `organisation_memberships` (
  `id`,
  `global_identity_id`,
  `organisation_id`,
  `login_account_id`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  'omem_' || replace(`login_accounts`.`id`, '-', '_'),
  `global_identities`.`id`,
  `login_accounts`.`organisation_id`,
  `login_accounts`.`id`,
  CASE
    WHEN `login_accounts`.`login_enabled` = 1 AND `login_accounts`.`status` = 'active' THEN 'active'
    WHEN `login_accounts`.`status` = 'disabled' THEN 'revoked'
    ELSE 'suspended'
  END,
  `login_accounts`.`created_at`,
  `login_accounts`.`updated_at`
FROM `login_accounts`
JOIN `global_identities` ON `global_identities`.`mobile_normalized` = `login_accounts`.`mobile_normalized`
ON CONFLICT(`login_account_id`) DO UPDATE SET
  `global_identity_id` = excluded.`global_identity_id`,
  `organisation_id` = excluded.`organisation_id`,
  `status` = excluded.`status`,
  `updated_at` = excluded.`updated_at`;
--> statement-breakpoint
UPDATE `login_accounts`
SET
  `global_identity_id` = (
    SELECT `organisation_memberships`.`global_identity_id`
    FROM `organisation_memberships`
    WHERE `organisation_memberships`.`login_account_id` = `login_accounts`.`id`
  ),
  `organisation_membership_id` = (
    SELECT `organisation_memberships`.`id`
    FROM `organisation_memberships`
    WHERE `organisation_memberships`.`login_account_id` = `login_accounts`.`id`
  )
WHERE `organisation_membership_id` IS NULL;
--> statement-breakpoint
UPDATE `user_sessions`
SET `organisation_membership_id` = (
  SELECT `login_accounts`.`organisation_membership_id`
  FROM `login_accounts`
  WHERE `login_accounts`.`id` = `user_sessions`.`login_account_id`
)
WHERE `organisation_membership_id` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `login_accounts_global_identity_id_idx` ON `login_accounts` (`global_identity_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `login_accounts_organisation_membership_id_idx` ON `login_accounts` (`organisation_membership_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_sessions_organisation_membership_id_idx` ON `user_sessions` (`organisation_membership_id`);
