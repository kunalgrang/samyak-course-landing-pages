CREATE TABLE IF NOT EXISTS `legacy_import_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `source_system` text NOT NULL DEFAULT 'legacy_student_workbook',
  `source_file_name` text NOT NULL,
  `source_checksum` text NOT NULL,
  `mode` text NOT NULL DEFAULT 'dry_run',
  `status` text NOT NULL DEFAULT 'draft',
  `total_rows` integer NOT NULL DEFAULT 0,
  `valid_rows` integer NOT NULL DEFAULT 0,
  `error_rows` integer NOT NULL DEFAULT 0,
  `new_person_count` integer NOT NULL DEFAULT 0,
  `existing_person_match_count` integer NOT NULL DEFAULT 0,
  `review_required_count` integer NOT NULL DEFAULT 0,
  `started_at` text,
  `completed_at` text,
  `created_by_login_account_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by_login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `legacy_import_batches_mode_check` CHECK(`mode` in ('dry_run', 'apply')),
  CONSTRAINT `legacy_import_batches_status_check` CHECK(`status` in ('draft', 'validated', 'blocked', 'applied', 'failed')),
  CONSTRAINT `legacy_import_batches_counts_check` CHECK(`total_rows` >= 0 and `valid_rows` >= 0 and `error_rows` >= 0 and `new_person_count` >= 0 and `existing_person_match_count` >= 0 and `review_required_count` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `legacy_import_batches_source_checksum_unique` ON `legacy_import_batches` (`organisation_id`,`source_system`,`source_checksum`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `legacy_import_batches_org_status_idx` ON `legacy_import_batches` (`organisation_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legacy_import_rows` (
  `id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL,
  `source_row_number` integer NOT NULL,
  `row_checksum` text NOT NULL,
  `legacy_student_ref` text NOT NULL,
  `legacy_enrolment_ref` text NOT NULL,
  `normalised_name` text,
  `mobile_last_four` text,
  `course_input` text,
  `resolved_course_id` text,
  `admission_date` text,
  `legacy_status_input` text,
  `mapped_student_status` text,
  `mapped_enrolment_status` text,
  `person_match_status` text NOT NULL DEFAULT 'not_checked',
  `matched_person_id` text,
  `proposed_student_number` text,
  `validation_status` text NOT NULL DEFAULT 'pending',
  `validation_severity` text NOT NULL DEFAULT 'info',
  `validation_codes_json` text NOT NULL DEFAULT '[]',
  `result_person_id` text,
  `result_student_id` text,
  `result_enrolment_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`batch_id`) REFERENCES `legacy_import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`resolved_course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`matched_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`result_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`result_student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`result_enrolment_id`) REFERENCES `enrolments`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `legacy_import_rows_source_row_check` CHECK(`source_row_number` > 0),
  CONSTRAINT `legacy_import_rows_status_check` CHECK(`validation_status` in ('pending', 'valid', 'review', 'error', 'applied', 'skipped')),
  CONSTRAINT `legacy_import_rows_severity_check` CHECK(`validation_severity` in ('info', 'warning', 'error')),
  CONSTRAINT `legacy_import_rows_person_match_check` CHECK(`person_match_status` in ('not_checked', 'new_person', 'exact_existing_match', 'shared_contact_new_person', 'possible_match_review'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `legacy_import_rows_batch_row_unique` ON `legacy_import_rows` (`batch_id`,`source_row_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `legacy_import_rows_batch_enrolment_ref_unique` ON `legacy_import_rows` (`batch_id`,`legacy_enrolment_ref`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `legacy_import_rows_student_ref_idx` ON `legacy_import_rows` (`legacy_student_ref`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `legacy_import_rows_course_status_idx` ON `legacy_import_rows` (`resolved_course_id`,`validation_status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legacy_import_entity_mappings` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `source_system` text NOT NULL DEFAULT 'legacy_student_workbook',
  `source_entity_type` text NOT NULL,
  `source_entity_ref` text NOT NULL,
  `target_entity_type` text NOT NULL,
  `target_entity_id` text NOT NULL,
  `batch_id` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`batch_id`) REFERENCES `legacy_import_batches`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `legacy_import_entity_mappings_source_type_check` CHECK(`source_entity_type` in ('person', 'student', 'enrolment')),
  CONSTRAINT `legacy_import_entity_mappings_target_type_check` CHECK(`target_entity_type` in ('person', 'student', 'enrolment'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `legacy_import_entity_mappings_source_unique` ON `legacy_import_entity_mappings` (`organisation_id`,`source_system`,`source_entity_type`,`source_entity_ref`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `legacy_import_entity_mappings_target_idx` ON `legacy_import_entity_mappings` (`target_entity_type`,`target_entity_id`);
