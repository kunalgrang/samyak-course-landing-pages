CREATE TABLE `number_sequences` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `sequence_key` text NOT NULL,
  `next_sequence` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `number_sequences_branch_key_unique` ON `number_sequences` (`organisation_id`,`branch_id`,`sequence_key`);
--> statement-breakpoint
CREATE INDEX `number_sequences_branch_id_idx` ON `number_sequences` (`branch_id`);
--> statement-breakpoint
CREATE TABLE `admission_drafts` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `enquiry_id` text NOT NULL,
  `person_id` text NOT NULL,
  `payload_json` text NOT NULL,
  `current_step` text DEFAULT 'identity' NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `created_by_login_account_id` text NOT NULL,
  `updated_by_login_account_id` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `confirmed_at` text,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `admission_drafts_status_check` CHECK(`status` in ('draft', 'confirmed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `admission_drafts_enquiry_id_idx` ON `admission_drafts` (`enquiry_id`);
--> statement-breakpoint
CREATE INDEX `admission_drafts_person_id_idx` ON `admission_drafts` (`person_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `admission_drafts_one_active_per_enquiry` ON `admission_drafts` (`enquiry_id`) WHERE `status` = 'draft';
--> statement-breakpoint
CREATE UNIQUE INDEX `enrolments_enquiry_unique` ON `enrolments` (`enquiry_id`) WHERE `enquiry_id` IS NOT NULL;
