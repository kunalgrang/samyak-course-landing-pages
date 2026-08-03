ALTER TABLE `courses` ADD COLUMN `admission_configuration_complete` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admission_discount_approvals` ADD COLUMN `listed_fee_paise` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admission_discount_approvals` ADD COLUMN `lowest_acceptable_fee_paise` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admission_discount_approvals` ADD COLUMN `discount_amount_paise` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `admission_discount_approvals` ADD COLUMN `approval_fingerprint` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `admission_discount_approvals` ADD COLUMN `decision_notes` text;
--> statement-breakpoint
ALTER TABLE `fee_agreements` ADD COLUMN `discount_approval_id` text;
--> statement-breakpoint
UPDATE `admission_discount_approvals`
SET
  `listed_fee_paise` = coalesce((SELECT `courses`.`default_fee_paise` FROM `courses` WHERE `courses`.`id` = `admission_discount_approvals`.`course_id`), 0),
  `lowest_acceptable_fee_paise` = coalesce((SELECT `courses`.`lowest_acceptable_fee_paise` FROM `courses` WHERE `courses`.`id` = `admission_discount_approvals`.`course_id`), 0),
  `discount_amount_paise` = max(coalesce((SELECT `courses`.`default_fee_paise` FROM `courses` WHERE `courses`.`id` = `admission_discount_approvals`.`course_id`), 0) - `requested_final_fee_paise`, 0);
--> statement-breakpoint
UPDATE `admission_discount_approvals`
SET `approval_fingerprint` =
  `admission_draft_id` || '|' ||
  `course_id` || '|' ||
  `listed_fee_paise` || '|' ||
  `lowest_acceptable_fee_paise` || '|' ||
  `requested_final_fee_paise` || '|' ||
  `discount_reason_code` || '|' ||
  coalesce(`discount_reason_text`, '');
--> statement-breakpoint
WITH ranked_active_approvals AS (
  SELECT
    `id`,
    row_number() OVER (
      PARTITION BY `organisation_id`, `approval_fingerprint`
      ORDER BY
        CASE `status` WHEN 'approved' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
        `updated_at` DESC,
        `created_at` DESC,
        `id` DESC
    ) AS `approval_rank`
  FROM `admission_discount_approvals`
  WHERE `status` IN ('pending', 'approved')
)
UPDATE `admission_discount_approvals`
SET `status` = 'superseded', `updated_at` = datetime('now')
WHERE `id` IN (
  SELECT `id` FROM ranked_active_approvals WHERE `approval_rank` > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admission_discount_approvals_active_fingerprint_unique`
ON `admission_discount_approvals` (`organisation_id`, `approval_fingerprint`)
WHERE `status` IN ('pending', 'approved');
--> statement-breakpoint
CREATE INDEX `fee_agreements_discount_approval_idx` ON `fee_agreements` (`discount_approval_id`);
