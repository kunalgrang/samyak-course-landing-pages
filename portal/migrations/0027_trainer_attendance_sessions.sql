create table class_sessions (
  id text primary key,
  organisation_id text not null references organisations(id),
  branch_id text not null references branches(id),
  batch_id text not null references batches(id),
  trainer_person_id text not null references people(id),
  session_date text not null,
  scheduled_start_time text,
  scheduled_end_time text,
  actual_started_at text,
  actual_ended_at text,
  teaching_note text not null default '',
  status text not null default 'open',
  version integer not null default 1,
  created_at text not null,
  updated_at text not null,
  created_by_actor_id text references login_accounts(id),
  constraint class_sessions_status_check check (status in ('open', 'completed', 'cancelled')),
  constraint class_sessions_date_check check (session_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  constraint class_sessions_time_check check (
    (scheduled_start_time is null or (scheduled_start_time glob '[0-2][0-9]:[0-5][0-9]' and scheduled_start_time < '24:00'))
    and (scheduled_end_time is null or (scheduled_end_time glob '[0-2][0-9]:[0-5][0-9]' and scheduled_end_time < '24:00'))
    and (scheduled_start_time is null or scheduled_end_time is null or scheduled_end_time > scheduled_start_time)
  ),
  constraint class_sessions_version_check check (version > 0)
);
--> statement-breakpoint
create unique index class_sessions_batch_date_start_unique
  on class_sessions (organisation_id, batch_id, session_date, scheduled_start_time);
--> statement-breakpoint
create index class_sessions_org_trainer_date_idx
  on class_sessions (organisation_id, trainer_person_id, session_date);
--> statement-breakpoint
create index class_sessions_batch_date_idx
  on class_sessions (batch_id, session_date);
--> statement-breakpoint
create index class_sessions_batch_status_idx
  on class_sessions (batch_id, status);
--> statement-breakpoint
create table attendance_records (
  id text primary key,
  organisation_id text not null references organisations(id),
  class_session_id text not null references class_sessions(id),
  batch_membership_id text not null references batch_memberships(id),
  enrolment_id text not null references enrolments(id),
  person_id text not null references people(id),
  status text not null,
  marked_by_actor_id text references login_accounts(id),
  marked_at text not null,
  updated_at text not null,
  constraint attendance_records_status_check check (status in ('present', 'absent'))
);
--> statement-breakpoint
create unique index attendance_records_session_membership_unique
  on attendance_records (class_session_id, batch_membership_id);
--> statement-breakpoint
create index attendance_records_session_idx
  on attendance_records (class_session_id);
--> statement-breakpoint
create index attendance_records_enrolment_idx
  on attendance_records (enrolment_id);
--> statement-breakpoint
create index attendance_records_membership_idx
  on attendance_records (batch_membership_id);
--> statement-breakpoint
create index attendance_records_org_person_idx
  on attendance_records (organisation_id, person_id);
