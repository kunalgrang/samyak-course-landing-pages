create table batches (
  id text primary key,
  organisation_id text not null references organisations(id),
  branch_id text not null references branches(id),
  course_id text not null references courses(id),
  name text not null,
  primary_trainer_person_id text references people(id),
  days_of_week_json text not null,
  start_time text not null,
  end_time text not null,
  capacity integer,
  status text not null default 'active',
  created_by_login_account_id text references login_accounts(id),
  created_at text not null,
  updated_at text not null,
  constraint batches_status_check check (status in ('active', 'inactive', 'completed')),
  constraint batches_time_format_check check (
    start_time glob '[0-2][0-9]:[0-5][0-9]'
    and end_time glob '[0-2][0-9]:[0-5][0-9]'
    and start_time < '24:00'
    and end_time < '24:00'
    and end_time > start_time
  ),
  constraint batches_capacity_check check (capacity is null or capacity > 0),
  constraint batches_days_json_check check (json_valid(days_of_week_json) and json_array_length(days_of_week_json) >= 1)
);

create index batches_org_branch_course_status_idx on batches (organisation_id, branch_id, course_id, status);
create index batches_trainer_status_idx on batches (primary_trainer_person_id, status);
create unique index batches_org_branch_name_unique on batches (organisation_id, branch_id, name);

create table batch_memberships (
  id text primary key,
  organisation_id text not null references organisations(id),
  batch_id text not null references batches(id),
  enrolment_id text not null references enrolments(id),
  joined_at text not null,
  left_at text,
  status text not null default 'active',
  assigned_by_login_account_id text references login_accounts(id),
  created_at text not null,
  constraint batch_memberships_status_check check (status in ('active', 'transferred', 'removed', 'completed')),
  constraint batch_memberships_active_lifecycle_check check (
    (status = 'active' and left_at is null)
    or (status <> 'active' and left_at is not null)
  )
);

create unique index batch_memberships_one_active_enrolment
  on batch_memberships (enrolment_id)
  where status = 'active' and left_at is null;
create index batch_memberships_batch_status_idx on batch_memberships (batch_id, status, joined_at);
create index batch_memberships_enrolment_status_idx on batch_memberships (enrolment_id, status, joined_at);
create index batch_memberships_org_enrolment_idx on batch_memberships (organisation_id, enrolment_id);
