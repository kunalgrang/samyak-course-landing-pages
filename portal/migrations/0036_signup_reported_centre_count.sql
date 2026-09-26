ALTER TABLE `organisation_onboarding_progress` ADD COLUMN `reported_centre_count` integer CHECK(`reported_centre_count` IS NULL OR `reported_centre_count` >= 1);
