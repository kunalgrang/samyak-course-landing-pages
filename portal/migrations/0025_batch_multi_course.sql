create table batch_courses (
  batch_id text not null references batches(id),
  course_id text not null references courses(id),
  organisation_id text not null references organisations(id),
  created_at text not null,
  created_by text references login_accounts(id),
  primary key (batch_id, course_id)
);

insert or ignore into batch_courses (batch_id, course_id, organisation_id, created_at, created_by)
select id, course_id, organisation_id, created_at, created_by_login_account_id
from batches
where course_id is not null;

create index batch_courses_course_batch_idx on batch_courses (course_id, batch_id);
create index batch_courses_org_course_idx on batch_courses (organisation_id, course_id);
