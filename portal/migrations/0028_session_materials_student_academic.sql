create table session_materials (
  id text primary key,
  organisation_id text not null references organisations(id),
  branch_id text not null references branches(id),
  class_session_id text not null references class_sessions(id),
  batch_id text not null references batches(id),
  trainer_person_id text not null references people(id),
  material_type text not null,
  title text not null,
  r2_object_key text not null,
  mime_type text not null,
  size_bytes integer not null,
  original_filename text not null,
  created_at text not null,
  updated_at text not null,
  created_by_actor_id text references login_accounts(id),
  deleted_at text,
  constraint session_materials_type_check check (material_type in ('notes', 'homework', 'study_material')),
  constraint session_materials_title_check check (length(trim(title)) between 1 and 120),
  constraint session_materials_mime_check check (mime_type = 'application/pdf'),
  constraint session_materials_size_check check (size_bytes > 0 and size_bytes <= 10485760)
);
--> statement-breakpoint
create unique index session_materials_r2_object_key_unique
  on session_materials (r2_object_key);
--> statement-breakpoint
create index session_materials_class_session_idx
  on session_materials (class_session_id)
  where deleted_at is null;
--> statement-breakpoint
create index session_materials_org_session_idx
  on session_materials (organisation_id, class_session_id)
  where deleted_at is null;
--> statement-breakpoint
create index session_materials_org_trainer_created_idx
  on session_materials (organisation_id, trainer_person_id, created_at)
  where deleted_at is null;
