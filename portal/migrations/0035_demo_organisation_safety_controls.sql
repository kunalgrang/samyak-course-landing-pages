ALTER TABLE `organisations` ADD COLUMN `organisation_kind` text NOT NULL DEFAULT 'normal' CHECK (`organisation_kind` IN ('normal', 'demo'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organisations_kind_idx` ON `organisations` (`organisation_kind`);
