PRAGMA foreign_keys = ON;
--> statement-breakpoint
ALTER TABLE `enquiries` ADD COLUMN `pipeline_stage` text NOT NULL DEFAULT 'new';
--> statement-breakpoint
ALTER TABLE `enquiries` ADD COLUMN `assigned_at` text;
--> statement-breakpoint
ALTER TABLE `enquiries` ADD COLUMN `last_contacted_at` text;
--> statement-breakpoint
ALTER TABLE `enquiries` ADD COLUMN `closed_reason` text;
--> statement-breakpoint
UPDATE `enquiries`
SET `pipeline_stage` = CASE
  WHEN `status` = 'new' THEN 'new'
  WHEN `status` = 'attempted_contact' THEN 'contacting'
  WHEN `status` = 'contacted' THEN 'engaged'
  WHEN `status` = 'follow_up' THEN 'considering'
  WHEN `status` = 'counselling_completed' THEN 'considering'
  WHEN `status` = 'demo_scheduled' THEN 'engaged'
  WHEN `status` = 'interested' THEN 'considering'
  WHEN `status` = 'admission_pending' THEN 'admission_ready'
  WHEN `status` = 'converted' THEN 'converted'
  WHEN `status` = 'not_interested' THEN 'lost'
  WHEN `status` = 'lost' THEN 'lost'
  WHEN `status` = 'duplicate' THEN 'duplicate'
  WHEN `status` = 'invalid' THEN 'invalid'
  ELSE 'new'
END
WHERE `pipeline_stage` = 'new';
--> statement-breakpoint
UPDATE `enquiries`
SET `closed_reason` = CASE
  WHEN `status` = 'not_interested' THEN 'not_interested'
  WHEN `status` = 'lost' AND `lost_reason` in ('not_interested', 'joined_elsewhere', 'fee_budget_issue', 'batch_timing_issue', 'location_travel_issue', 'course_not_suitable', 'no_response', 'postponed_indefinitely', 'other') THEN `lost_reason`
  WHEN `status` = 'lost' THEN 'no_response'
  ELSE `closed_reason`
END
WHERE `closed_reason` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `enquiries_branch_pipeline_followup_idx`
  ON `enquiries` (`branch_id`, `pipeline_stage`, `next_follow_up_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `enquiries_branch_counsellor_pipeline_followup_idx`
  ON `enquiries` (`branch_id`, `counsellor_login_account_id`, `pipeline_stage`, `next_follow_up_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `enquiries_branch_created_idx`
  ON `enquiries` (`branch_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `enquiry_follow_up_events` (
  `id` text PRIMARY KEY NOT NULL,
  `enquiry_id` text NOT NULL,
  `organisation_id` text NOT NULL,
  `branch_id` text NOT NULL,
  `actor_login_account_id` text NOT NULL,
  `channel` text NOT NULL,
  `outcome` text NOT NULL,
  `note` text,
  `occurred_at` text NOT NULL,
  `next_follow_up_at_snapshot` text,
  `pipeline_stage_snapshot` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `enquiry_follow_up_events_channel_check` CHECK(`channel` in ('call', 'whatsapp', 'in_person', 'email', 'other')),
  CONSTRAINT `enquiry_follow_up_events_outcome_check` CHECK(`outcome` in ('call_connected', 'call_no_answer', 'call_busy', 'whatsapp_sent', 'whatsapp_replied', 'whatsapp_no_response', 'callback_requested', 'course_details_shared', 'fee_discussed', 'batch_discussed', 'visit_scheduled', 'demo_scheduled', 'demo_completed', 'thinking', 'deferred_joining', 'not_interested', 'joined_elsewhere', 'invalid_contact', 'other')),
  CONSTRAINT `enquiry_follow_up_events_pipeline_stage_check` CHECK(`pipeline_stage_snapshot` in ('new', 'contacting', 'engaged', 'considering', 'deferred', 'admission_ready', 'converted', 'lost', 'invalid', 'duplicate'))
);
--> statement-breakpoint
CREATE INDEX `enquiry_follow_up_events_enquiry_created_idx`
  ON `enquiry_follow_up_events` (`enquiry_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `enquiry_follow_up_events_branch_created_idx`
  ON `enquiry_follow_up_events` (`branch_id`, `created_at`);
