PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `enquiry_course_interests` (
  `enquiry_id` text PRIMARY KEY NOT NULL,
  `course_interest_text` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON UPDATE no action ON DELETE no action
);