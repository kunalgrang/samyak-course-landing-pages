PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE UNIQUE INDEX `student_consents_enrolment_type_unique` ON `student_consents` (`enrolment_id`, `consent_type`) WHERE `enrolment_id` IS NOT NULL;
