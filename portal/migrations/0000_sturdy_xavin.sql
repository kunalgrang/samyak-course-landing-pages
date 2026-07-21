PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text,
	`branch_id` text,
	`actor_login_account_id` text,
	`actor_person_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`old_values_json` text,
	`new_values_json` text,
	`metadata_json` text,
	`ip_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_organisation_id_idx` ON `audit_logs` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_branch_id_idx` ON `audit_logs` (`branch_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_login_account_id_idx` ON `audit_logs` (`actor_login_account_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_person_id_idx` ON `audit_logs` (`actor_person_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text,
	`login_account_id` text,
	`event_type` text NOT NULL,
	`result_code` text NOT NULL,
	`mobile_hash` text,
	`mobile_last_four` text,
	`ip_hash` text,
	`user_agent_hash` text,
	`metadata_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_events_organisation_id_idx` ON `auth_events` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `auth_events_login_account_id_idx` ON `auth_events` (`login_account_id`);--> statement-breakpoint
CREATE INDEX `auth_events_created_at_idx` ON `auth_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "branches_status_check" CHECK("branches"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_organisation_code_unique` ON `branches` (`organisation_id`,`code`);--> statement-breakpoint
CREATE INDEX `branches_organisation_id_idx` ON `branches` (`organisation_id`);--> statement-breakpoint
CREATE TABLE `login_account_people` (
	`login_account_id` text NOT NULL,
	`person_id` text NOT NULL,
	`access_type` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`login_account_id`, `person_id`),
	FOREIGN KEY (`login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "login_account_people_access_type_check" CHECK("login_account_people"."access_type" in ('self', 'guardian', 'shared_family', 'staff'))
);
--> statement-breakpoint
CREATE INDEX `login_account_people_person_id_idx` ON `login_account_people` (`person_id`);--> statement-breakpoint
CREATE TABLE `login_account_roles` (
	`login_account_id` text NOT NULL,
	`role_id` text NOT NULL,
	`branch_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_account_roles_account_role_branch_unique` ON `login_account_roles` (`login_account_id`,`role_id`,`branch_id`);--> statement-breakpoint
CREATE INDEX `login_account_roles_login_account_id_idx` ON `login_account_roles` (`login_account_id`);--> statement-breakpoint
CREATE INDEX `login_account_roles_role_id_idx` ON `login_account_roles` (`role_id`);--> statement-breakpoint
CREATE INDEX `login_account_roles_branch_id_idx` ON `login_account_roles` (`branch_id`);--> statement-breakpoint
CREATE TABLE `login_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`mobile_normalized` text NOT NULL,
	`mobile_last_four` text NOT NULL,
	`login_enabled` integer DEFAULT true NOT NULL,
	`status` text NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "login_accounts_status_check" CHECK("login_accounts"."status" in ('active', 'suspended', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `login_accounts_organisation_mobile_unique` ON `login_accounts` (`organisation_id`,`mobile_normalized`);--> statement-breakpoint
CREATE INDEX `login_accounts_organisation_id_idx` ON `login_accounts` (`organisation_id`);--> statement-breakpoint
CREATE TABLE `organisations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "organisations_status_check" CHECK("organisations"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organisations_slug_unique` ON `organisations` (`slug`);--> statement-breakpoint
CREATE TABLE `otp_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`login_account_id` text,
	`mobile_hash` text NOT NULL,
	`mobile_last_four` text,
	`provider` text NOT NULL,
	`provider_request_id` text,
	`purpose` text NOT NULL,
	`status` text NOT NULL,
	`verification_attempts` integer DEFAULT 0 NOT NULL,
	`requested_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`verified_at` text,
	`ip_hash` text,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "otp_challenges_provider_check" CHECK("otp_challenges"."provider" in ('msg91')),
	CONSTRAINT "otp_challenges_purpose_check" CHECK("otp_challenges"."purpose" in ('login')),
	CONSTRAINT "otp_challenges_status_check" CHECK("otp_challenges"."status" in ('requested', 'sent', 'verified', 'expired', 'failed', 'blocked'))
);
--> statement-breakpoint
CREATE INDEX `otp_challenges_mobile_hash_requested_at_idx` ON `otp_challenges` (`mobile_hash`,`requested_at`);--> statement-breakpoint
CREATE INDEX `otp_challenges_ip_hash_requested_at_idx` ON `otp_challenges` (`ip_hash`,`requested_at`);--> statement-breakpoint
CREATE INDEX `otp_challenges_login_account_id_idx` ON `otp_challenges` (`login_account_id`);--> statement-breakpoint
CREATE INDEX `otp_challenges_expires_at_idx` ON `otp_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`home_branch_id` text,
	`full_name` text NOT NULL,
	`public_name` text,
	`date_of_birth` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "people_status_check" CHECK("people"."status" in ('active', 'inactive', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `people_organisation_id_idx` ON `people` (`organisation_id`);--> statement-breakpoint
CREATE INDEX `people_home_branch_id_idx` ON `people` (`home_branch_id`);--> statement-breakpoint
CREATE TABLE `person_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`contact_type` text NOT NULL,
	`normalized_value` text NOT NULL,
	`display_value` text,
	`last_four` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`verified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "person_contacts_contact_type_check" CHECK("person_contacts"."contact_type" in ('mobile', 'email'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_contacts_person_type_value_unique` ON `person_contacts` (`person_id`,`contact_type`,`normalized_value`);--> statement-breakpoint
CREATE INDEX `person_contacts_person_id_idx` ON `person_contacts` (`person_id`);--> statement-breakpoint
CREATE TABLE `referrer_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`person_id` text NOT NULL,
	`external_referrer_id` text NOT NULL,
	`referral_token` text NOT NULL,
	`personal_link` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referrer_profiles_organisation_external_referrer_unique` ON `referrer_profiles` (`organisation_id`,`external_referrer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `referrer_profiles_organisation_referral_token_unique` ON `referrer_profiles` (`organisation_id`,`referral_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `referrer_profiles_person_id_unique` ON `referrer_profiles` (`person_id`);--> statement-breakpoint
CREATE INDEX `referrer_profiles_organisation_id_idx` ON `referrer_profiles` (`organisation_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_organisation_code_unique` ON `roles` (`organisation_id`,`code`);--> statement-breakpoint
CREATE INDEX `roles_organisation_id_idx` ON `roles` (`organisation_id`);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`login_account_id` text NOT NULL,
	`active_person_id` text,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text,
	`ip_hash` text,
	`user_agent_hash` text,
	FOREIGN KEY (`login_account_id`) REFERENCES `login_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`active_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_sessions_token_hash_unique` ON `user_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `user_sessions_login_account_id_idx` ON `user_sessions` (`login_account_id`);--> statement-breakpoint
CREATE INDEX `user_sessions_expires_at_idx` ON `user_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `user_sessions_revoked_at_idx` ON `user_sessions` (`revoked_at`);
