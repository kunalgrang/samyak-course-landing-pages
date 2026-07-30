PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `person_identity_details` (
  `person_id` text PRIMARY KEY NOT NULL,
  `official_full_name` text NOT NULL,
  `first_name` text,
  `middle_name` text,
  `last_name` text,
  `date_of_birth` text NOT NULL,
  `gender` text,
  `father_name` text,
  `mother_name` text,
  `occupation_status` text,
  `identity_verified` integer DEFAULT false NOT NULL,
  `identity_verified_at` text,
  `identity_verified_by` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `person_identity_details_official_name_idx` ON `person_identity_details` (`official_full_name`);
--> statement-breakpoint
CREATE INDEX `person_identity_details_dob_idx` ON `person_identity_details` (`date_of_birth`);
--> statement-breakpoint
CREATE TABLE `person_contact_details` (
  `contact_id` text PRIMARY KEY NOT NULL,
  `belongs_to` text DEFAULT 'student' NOT NULL,
  `contact_label` text,
  `is_whatsapp` integer DEFAULT false NOT NULL,
  `valid_from` text,
  `valid_until` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`contact_id`) REFERENCES `person_contacts`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "person_contact_details_belongs_to_check" CHECK(`belongs_to` in ('student', 'father', 'mother', 'guardian', 'family', 'office', 'other')),
  CONSTRAINT "person_contact_details_status_check" CHECK(`status` in ('active', 'previous', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE `students` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `person_id` text NOT NULL,
  `home_branch_id` text NOT NULL,
  `student_number` text NOT NULL,
  `sequence_number` integer NOT NULL,
  `student_since` text NOT NULL,
  `current_status` text DEFAULT 'active' NOT NULL,
  `portal_status` text DEFAULT 'not_invited' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`home_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "students_current_status_check" CHECK(`current_status` in ('active', 'completed', 'alumni', 'on_hold', 'dropped_out', 'cancelled', 'suspended', 'archived')),
  CONSTRAINT "students_portal_status_check" CHECK(`portal_status` in ('not_invited', 'invited', 'active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_organisation_person_unique` ON `students` (`organisation_id`, `person_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_organisation_number_unique` ON `students` (`organisation_id`, `student_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_branch_sequence_unique` ON `students` (`home_branch_id`, `sequence_number`);
--> statement-breakpoint
CREATE INDEX `students_home_branch_id_idx` ON `students` (`home_branch_id`);
--> statement-breakpoint
CREATE INDEX `students_current_status_idx` ON `students` (`current_status`);
--> statement-breakpoint
CREATE TABLE `person_localities` (
  `id` text PRIMARY KEY NOT NULL,
  `person_id` text NOT NULL,
  `locality_type` text DEFAULT 'current' NOT NULL,
  `locality` text NOT NULL,
  `city` text NOT NULL,
  `postal_code` text,
  `state` text,
  `residence_type` text,
  `full_address` text,
  `valid_from` text,
  `valid_until` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "person_localities_type_check" CHECK(`locality_type` in ('current', 'home', 'permanent', 'nsdc')),
  CONSTRAINT "person_localities_status_check" CHECK(`status` in ('active', 'previous', 'inactive'))
);
--> statement-breakpoint
CREATE INDEX `person_localities_person_id_idx` ON `person_localities` (`person_id`);
--> statement-breakpoint
CREATE INDEX `person_localities_locality_city_idx` ON `person_localities` (`locality`, `city`);
--> statement-breakpoint
CREATE TABLE `person_relationships` (
  `id` text PRIMARY KEY NOT NULL,
  `person_id` text NOT NULL,
  `related_name` text NOT NULL,
  `relationship_type` text NOT NULL,
  `mobile_normalized` text,
  `occupation` text,
  `is_guardian` integer DEFAULT false NOT NULL,
  `is_emergency_contact` integer DEFAULT false NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `person_relationships_person_id_idx` ON `person_relationships` (`person_id`);
--> statement-breakpoint
CREATE INDEX `person_relationships_mobile_idx` ON `person_relationships` (`mobile_normalized`);
--> statement-breakpoint
CREATE TABLE `education_records` (
  `id` text PRIMARY KEY NOT NULL,
  `person_id` text NOT NULL,
  `qualification_level` text NOT NULL,
  `qualification_name` text,
  `stream` text,
  `institution_name` text,
  `board_university` text,
  `currently_pursuing` integer DEFAULT false NOT NULL,
  `current_year_semester` text,
  `passing_month` integer,
  `passing_year` integer,
  `result_value` text,
  `result_type` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `education_records_person_id_idx` ON `education_records` (`person_id`);
--> statement-breakpoint
CREATE TABLE `courses` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `duration_label` text,
  `default_fee_paise` integer,
  `nsdc_available` integer DEFAULT false NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "courses_status_check" CHECK(`status` in ('active', 'inactive', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_organisation_code_unique` ON `courses` (`organisation_id`, `code`);
--> statement-breakpoint
CREATE INDEX `courses_organisation_id_idx` ON `courses` (`organisation_id`);
--> statement-breakpoint
CREATE TABLE `enquiries` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `person_id` text,
  `enquiry_number` text NOT NULL,
  `mobile_used` text NOT NULL,
  `course_interest_id` text,
  `source` text NOT NULL,
  `source_detail` text,
  `campaign_data_json` text,
  `counsellor_login_account_id` text,
  `preferred_timing` text,
  `preferred_joining_date` text,
  `status` text DEFAULT 'new' NOT NULL,
  `next_follow_up_at` text,
  `lost_reason` text,
  `converted_enrolment_id` text,
  `converted_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`course_interest_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "enquiries_status_check" CHECK(`status` in ('new', 'attempted_contact', 'contacted', 'follow_up', 'counselling_completed', 'demo_scheduled', 'interested', 'admission_pending', 'converted', 'not_interested', 'lost', 'duplicate', 'invalid'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enquiries_organisation_number_unique` ON `enquiries` (`organisation_id`, `enquiry_number`);
--> statement-breakpoint
CREATE INDEX `enquiries_mobile_used_idx` ON `enquiries` (`mobile_used`);
--> statement-breakpoint
CREATE INDEX `enquiries_person_id_idx` ON `enquiries` (`person_id`);
--> statement-breakpoint
CREATE INDEX `enquiries_branch_status_idx` ON `enquiries` (`branch_id`, `status`);
--> statement-breakpoint
CREATE INDEX `enquiries_next_follow_up_idx` ON `enquiries` (`next_follow_up_at`);
--> statement-breakpoint
CREATE TABLE `enquiry_followups` (
  `id` text PRIMARY KEY NOT NULL,
  `enquiry_id` text NOT NULL,
  `followup_type` text NOT NULL,
  `notes` text,
  `outcome` text,
  `next_follow_up_at` text,
  `staff_login_account_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `enquiry_followups_enquiry_id_idx` ON `enquiry_followups` (`enquiry_id`);
--> statement-breakpoint
CREATE INDEX `enquiry_followups_next_follow_up_idx` ON `enquiry_followups` (`next_follow_up_at`);
--> statement-breakpoint
CREATE TABLE `enrolments` (
  `id` text PRIMARY KEY NOT NULL,
  `student_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `course_id` text NOT NULL,
  `enquiry_id` text,
  `enrolment_number` text NOT NULL,
  `training_mode` text NOT NULL,
  `batch_preference` text,
  `batch_id` text,
  `admission_date` text NOT NULL,
  `joining_date` text NOT NULL,
  `expected_completion_date` text,
  `actual_completion_date` text,
  `status` text DEFAULT 'provisional' NOT NULL,
  `nsdc_preference` text DEFAULT 'decide_later' NOT NULL,
  `referrer_profile_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "enrolments_training_mode_check" CHECK(`training_mode` in ('classroom', 'online', 'hybrid')),
  CONSTRAINT "enrolments_status_check" CHECK(`status` in ('provisional', 'confirmed', 'not_started', 'active', 'on_hold', 'transferred', 'completed', 'dropped_out', 'cancelled', 'expired')),
  CONSTRAINT "enrolments_nsdc_preference_check" CHECK(`nsdc_preference` in ('yes', 'no', 'decide_later'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrolments_branch_number_unique` ON `enrolments` (`branch_id`, `enrolment_number`);
--> statement-breakpoint
CREATE INDEX `enrolments_student_id_idx` ON `enrolments` (`student_id`);
--> statement-breakpoint
CREATE INDEX `enrolments_course_id_idx` ON `enrolments` (`course_id`);
--> statement-breakpoint
CREATE INDEX `enrolments_enquiry_id_idx` ON `enrolments` (`enquiry_id`);
--> statement-breakpoint
CREATE TABLE `fee_agreements` (
  `id` text PRIMARY KEY NOT NULL,
  `enrolment_id` text NOT NULL,
  `standard_fee_paise` integer NOT NULL,
  `final_agreed_fee_paise` integer NOT NULL,
  `discount_paise` integer DEFAULT 0 NOT NULL,
  `discount_reason` text,
  `discount_approved_by` text,
  `gst_rate_basis_points` integer DEFAULT 0 NOT NULL,
  `payment_plan_type` text NOT NULL,
  `number_of_instalments` integer,
  `initial_payment_expected_paise` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`enrolment_id`) REFERENCES `enrolments`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "fee_agreements_status_check" CHECK(`status` in ('draft', 'active', 'replaced', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fee_agreements_enrolment_unique` ON `fee_agreements` (`enrolment_id`);
--> statement-breakpoint
CREATE TABLE `nsdc_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `enrolment_id` text NOT NULL,
  `aadhaar_ciphertext` text,
  `aadhaar_last_four` text,
  `aadhaar_fingerprint` text,
  `aadhaar_linked_mobile` text,
  `aadhaar_verified` integer DEFAULT false NOT NULL,
  `aadhaar_verified_at` text,
  `religion` text,
  `social_category` text,
  `disability_status` text,
  `udid_number` text,
  `bank_details_ciphertext` text,
  `candidate_id` text,
  `scheme_code` text,
  `sector_skill_council` text,
  `job_role` text,
  `qp_code` text,
  `nsqf_level` text,
  `training_partner_id` text,
  `training_centre_id` text,
  `nsdc_batch_id` text,
  `status` text DEFAULT 'basic_details_pending' NOT NULL,
  `submitted_at` text,
  `certificate_number` text,
  `certificate_issued_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`enrolment_id`) REFERENCES `enrolments`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "nsdc_profiles_status_check" CHECK(`status` in ('basic_details_pending', 'aadhaar_pending', 'documents_pending', 'verification_pending', 'correction_required', 'ready_for_sidh', 'registered_on_sidh', 'candidate_id_received', 'batch_enrolled', 'assessment_pending', 'assessment_completed', 'passed', 'failed', 'certificate_issued', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nsdc_profiles_enrolment_unique` ON `nsdc_profiles` (`enrolment_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `nsdc_profiles_aadhaar_fingerprint_unique` ON `nsdc_profiles` (`aadhaar_fingerprint`);
--> statement-breakpoint
CREATE INDEX `nsdc_profiles_candidate_id_idx` ON `nsdc_profiles` (`candidate_id`);
--> statement-breakpoint
CREATE TABLE `student_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `person_id` text NOT NULL,
  `enrolment_id` text,
  `document_type` text NOT NULL,
  `storage_key` text NOT NULL,
  `original_filename` text,
  `verification_status` text DEFAULT 'uploaded' NOT NULL,
  `uploaded_by` text,
  `verified_by` text,
  `verified_at` text,
  `rejection_reason` text,
  `expiry_date` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`enrolment_id`) REFERENCES `enrolments`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "student_documents_verification_status_check" CHECK(`verification_status` in ('requested', 'uploaded', 'verified', 'rejected', 'expired', 'reupload_required'))
);
--> statement-breakpoint
CREATE INDEX `student_documents_person_id_idx` ON `student_documents` (`person_id`);
--> statement-breakpoint
CREATE INDEX `student_documents_enrolment_id_idx` ON `student_documents` (`enrolment_id`);
--> statement-breakpoint
CREATE TABLE `student_consents` (
  `id` text PRIMARY KEY NOT NULL,
  `person_id` text NOT NULL,
  `enrolment_id` text,
  `consent_type` text NOT NULL,
  `consent_given` integer NOT NULL,
  `consent_version` text NOT NULL,
  `captured_method` text NOT NULL,
  `captured_by` text,
  `captured_at` text NOT NULL,
  `withdrawn_at` text,
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`enrolment_id`) REFERENCES `enrolments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `student_consents_person_id_idx` ON `student_consents` (`person_id`);
--> statement-breakpoint
CREATE INDEX `student_consents_enrolment_id_idx` ON `student_consents` (`enrolment_id`);