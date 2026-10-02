UPDATE `payment_plan_rules`
SET `min_duration_months` = 0.5,
    `max_duration_months` = NULL,
    `fixed_instalments` = 1,
    `is_active` = 1,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `id` = 'payrule_one_full';

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `is_active` = 0,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `plan_type` = 'full'
  AND `id` <> 'payrule_one_full';

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `min_duration_months` = 2,
    `max_duration_months` = NULL,
    `fixed_instalments` = 2,
    `is_active` = 1,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `id` = CASE
    WHEN EXISTS (
      SELECT 1 FROM `payment_plan_rules` AS preferred
      WHERE preferred.`id` = 'payrule_8e2f4020d9ad4248ada7e08c5ecc634c'
        AND preferred.`organisation_id` = 'org_samyak'
    ) THEN 'payrule_8e2f4020d9ad4248ada7e08c5ecc634c'
    ELSE 'payrule_short_two'
  END;

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `is_active` = 0,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `plan_type` = 'two_instalments'
  AND `id` <> CASE
    WHEN EXISTS (
      SELECT 1 FROM `payment_plan_rules` AS preferred
      WHERE preferred.`id` = 'payrule_8e2f4020d9ad4248ada7e08c5ecc634c'
        AND preferred.`organisation_id` = 'org_samyak'
    ) THEN 'payrule_8e2f4020d9ad4248ada7e08c5ecc634c'
    ELSE 'payrule_short_two'
  END;

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `min_duration_months` = 3,
    `max_duration_months` = NULL,
    `fixed_instalments` = 3,
    `is_active` = 1,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `id` = CASE
    WHEN EXISTS (
      SELECT 1 FROM `payment_plan_rules` AS preferred
      WHERE preferred.`id` = 'payrule_c72f20b7083a4df2a7068f11e47869d9'
        AND preferred.`organisation_id` = 'org_samyak'
    ) THEN 'payrule_c72f20b7083a4df2a7068f11e47869d9'
    ELSE 'payrule_mid_three'
  END;

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `is_active` = 0,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `plan_type` = 'three_instalments'
  AND `id` <> CASE
    WHEN EXISTS (
      SELECT 1 FROM `payment_plan_rules` AS preferred
      WHERE preferred.`id` = 'payrule_c72f20b7083a4df2a7068f11e47869d9'
        AND preferred.`organisation_id` = 'org_samyak'
    ) THEN 'payrule_c72f20b7083a4df2a7068f11e47869d9'
    ELSE 'payrule_mid_three'
  END;

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `min_duration_months` = 4,
    `max_duration_months` = NULL,
    `fixed_instalments` = NULL,
    `is_active` = 1,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `id` = CASE
    WHEN EXISTS (
      SELECT 1 FROM `payment_plan_rules` AS preferred
      WHERE preferred.`id` = 'payrule_e5b34835a916408489423fdf031f23df'
        AND preferred.`organisation_id` = 'org_samyak'
    ) THEN 'payrule_e5b34835a916408489423fdf031f23df'
    ELSE 'payrule_long_custom'
  END;

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `is_active` = 0,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_samyak'
  AND `plan_type` = 'custom'
  AND `id` <> CASE
    WHEN EXISTS (
      SELECT 1 FROM `payment_plan_rules` AS preferred
      WHERE preferred.`id` = 'payrule_e5b34835a916408489423fdf031f23df'
        AND preferred.`organisation_id` = 'org_samyak'
    ) THEN 'payrule_e5b34835a916408489423fdf031f23df'
    ELSE 'payrule_long_custom'
  END;

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `min_duration_months` = 0.5,
    `max_duration_months` = NULL,
    `fixed_instalments` = 1,
    `is_active` = 1,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_88ee748d08a14eb1b5201ca88edfa07e'
  AND `id` = 'demo_v1_payrule_short_full';

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `min_duration_months` = 2,
    `max_duration_months` = NULL,
    `fixed_instalments` = 2,
    `is_active` = 1,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_88ee748d08a14eb1b5201ca88edfa07e'
  AND `id` = 'demo_v1_payrule_short_two';

--> statement-breakpoint
UPDATE `payment_plan_rules`
SET `min_duration_months` = 4,
    `max_duration_months` = NULL,
    `fixed_instalments` = 3,
    `is_active` = 1,
    `updated_at` = '2026-10-02T00:00:00.000Z'
WHERE `organisation_id` = 'org_88ee748d08a14eb1b5201ca88edfa07e'
  AND `id` = 'demo_v1_payrule_mid_three';
