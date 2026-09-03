create table certificate_applications (
  id text primary key,
  organisation_id text not null references organisations(id),
  branch_id text not null references branches(id),
  person_id text not null references people(id),
  student_id text not null references students(id),
  enrolment_id text not null references enrolments(id),
  course_id text not null references courses(id),
  status text not null default 'submitted',
  student_completion_confirmed integer not null,
  certificate_details_confirmed integer not null,
  feedback_trainer_clarity_score integer not null,
  feedback_practical_learning_score integer not null,
  feedback_course_expectation_score integer not null,
  feedback_overall_score integer not null,
  feedback_improvement_text text,
  low_feedback_flag integer not null default 0,
  applied_at text not null,
  reviewed_at text,
  reviewed_by_actor_id text references login_accounts(id),
  completion_date text,
  decision_note text,
  created_at text not null,
  updated_at text not null,
  constraint certificate_applications_status_check check (status in ('submitted', 'approved', 'needs_attention', 'certificate_issued', 'cancelled')),
  constraint certificate_applications_completion_confirmed_check check (student_completion_confirmed in (0, 1)),
  constraint certificate_applications_details_confirmed_check check (certificate_details_confirmed in (0, 1)),
  constraint certificate_applications_trainer_score_check check (feedback_trainer_clarity_score between 1 and 5),
  constraint certificate_applications_practical_score_check check (feedback_practical_learning_score between 1 and 5),
  constraint certificate_applications_expectation_score_check check (feedback_course_expectation_score between 1 and 5),
  constraint certificate_applications_overall_score_check check (feedback_overall_score between 1 and 5),
  constraint certificate_applications_low_feedback_check check (low_feedback_flag in (0, 1))
);
--> statement-breakpoint
create unique index certificate_applications_one_active_enrolment_unique
  on certificate_applications (organisation_id, enrolment_id)
  where status in ('submitted', 'approved', 'needs_attention');
--> statement-breakpoint
create index certificate_applications_org_status_applied_idx
  on certificate_applications (organisation_id, status, applied_at);
--> statement-breakpoint
create index certificate_applications_org_branch_status_applied_idx
  on certificate_applications (organisation_id, branch_id, status, applied_at);
--> statement-breakpoint
create index certificate_applications_student_idx
  on certificate_applications (student_id, applied_at);
--> statement-breakpoint
create index certificate_applications_person_idx
  on certificate_applications (organisation_id, person_id, applied_at);
--> statement-breakpoint
create index certificate_applications_enrolment_idx
  on certificate_applications (enrolment_id);
--> statement-breakpoint
create table certificate_application_events (
  id text primary key,
  organisation_id text not null references organisations(id),
  branch_id text not null references branches(id),
  application_id text not null references certificate_applications(id),
  actor_login_account_id text references login_accounts(id),
  actor_person_id text references people(id),
  action text not null,
  from_status text,
  to_status text not null,
  note text,
  metadata_json text,
  created_at text not null,
  constraint certificate_application_events_action_check check (action in ('submitted', 'needs_attention', 'approved', 'certificate_issued'))
);
--> statement-breakpoint
create index certificate_application_events_application_idx
  on certificate_application_events (application_id, created_at);
