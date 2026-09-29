CREATE TABLE IF NOT EXISTS `centre_commercial_access` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL REFERENCES `organisations`(`id`),
  `branch_id` text NOT NULL REFERENCES `branches`(`id`),
  `state` text NOT NULL,
  `source` text NOT NULL,
  `payment_evidence_source` text,
  `payment_evidence_reference` text,
  `activated_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `centre_commercial_access_state_check` CHECK(`state` in ('pending_payment', 'trial', 'active', 'grace', 'past_due', 'suspended', 'cancelled', 'legacy_existing')),
  CONSTRAINT `centre_commercial_access_source_check` CHECK(`source` in ('migration_backfill', 'organisation_signup_trial', 'centre_created', 'maintenance_activation', 'billing_provider')),
  CONSTRAINT `centre_commercial_access_payment_evidence_source_check` CHECK(`payment_evidence_source` is null or `payment_evidence_source` in ('external_manual_verification', 'payment_provider', 'invoice_settlement')),
  CONSTRAINT `centre_commercial_access_payment_reference_required_check` CHECK((`state` = 'active' and `source` in ('maintenance_activation', 'billing_provider')) = (`payment_evidence_source` is not null and `payment_evidence_reference` is not null and `activated_at` is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `centre_commercial_access_branch_unique` ON `centre_commercial_access` (`branch_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `centre_commercial_access_org_state_idx` ON `centre_commercial_access` (`organisation_id`, `state`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `centre_commercial_access_branch_idx` ON `centre_commercial_access` (`branch_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `centre_commercial_access_insert_org_match`
BEFORE INSERT ON `centre_commercial_access`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM `branches`
  WHERE `branches`.`id` = NEW.`branch_id`
    AND `branches`.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'centre_commercial_access branch organisation mismatch');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `centre_commercial_access_update_org_match`
BEFORE UPDATE OF `organisation_id`, `branch_id` ON `centre_commercial_access`
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM `branches`
  WHERE `branches`.`id` = NEW.`branch_id`
    AND `branches`.`organisation_id` = NEW.`organisation_id`
)
BEGIN
  SELECT RAISE(ABORT, 'centre_commercial_access branch organisation mismatch');
END;
--> statement-breakpoint
INSERT INTO `centre_commercial_access`
  (`id`, `organisation_id`, `branch_id`, `state`, `source`, `payment_evidence_source`, `payment_evidence_reference`, `activated_at`, `created_at`, `updated_at`)
SELECT
  'cca_' || replace(`branches`.`id`, '-', '_'),
  `branches`.`organisation_id`,
  `branches`.`id`,
  CASE
    WHEN `branches`.`centre_status` = 'pending_subscription' THEN 'pending_payment'
    WHEN `branches`.`status` = 'active' AND `branches`.`centre_status` = 'active' THEN 'legacy_existing'
    ELSE 'suspended'
  END,
  'migration_backfill',
  NULL,
  NULL,
  NULL,
  coalesce(`branches`.`created_at`, datetime('now')),
  coalesce(`branches`.`updated_at`, `branches`.`created_at`, datetime('now'))
FROM `branches`
WHERE NOT EXISTS (
  SELECT 1 FROM `centre_commercial_access`
  WHERE `centre_commercial_access`.`branch_id` = `branches`.`id`
);
