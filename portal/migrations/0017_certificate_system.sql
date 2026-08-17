CREATE TABLE certificate_templates (
  id text PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES organisations(id),
  code text NOT NULL,
  name text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  is_active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT certificate_templates_status_check CHECK (status IN ('active', 'inactive', 'archived')),
  CONSTRAINT certificate_templates_active_check CHECK (is_active IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX certificate_templates_org_code_version_unique
  ON certificate_templates (organisation_id, code, version);
--> statement-breakpoint
CREATE INDEX certificate_templates_org_active_idx
  ON certificate_templates (organisation_id, is_active, status);
--> statement-breakpoint
CREATE TABLE certificates (
  id text PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES organisations(id),
  branch_id text NOT NULL REFERENCES branches(id),
  certificate_number text NOT NULL,
  verification_code text NOT NULL,
  person_id text NOT NULL REFERENCES people(id),
  student_id text NOT NULL REFERENCES students(id),
  enrolment_id text NOT NULL REFERENCES enrolments(id),
  course_id text NOT NULL REFERENCES courses(id),
  student_name_snapshot text NOT NULL,
  student_id_snapshot text NOT NULL,
  course_name_snapshot text NOT NULL,
  course_code_snapshot text NOT NULL,
  course_duration_months_snapshot real,
  course_duration_label_snapshot text,
  joining_date_snapshot text NOT NULL,
  completion_date_snapshot text,
  issue_date text NOT NULL,
  template_id text NOT NULL REFERENCES certificate_templates(id),
  template_version_snapshot integer NOT NULL,
  status text NOT NULL,
  pdf_storage_key text,
  pdf_sha256 text,
  issued_by_actor_id text NOT NULL REFERENCES login_accounts(id),
  issued_at text NOT NULL,
  revoked_at text,
  revoked_by_actor_id text REFERENCES login_accounts(id),
  revocation_reason text,
  supersedes_certificate_id text REFERENCES certificates(id),
  superseded_by_certificate_id text REFERENCES certificates(id),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT certificates_status_check CHECK (status IN ('issued', 'revoked', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX certificates_number_unique
  ON certificates (certificate_number);
--> statement-breakpoint
CREATE UNIQUE INDEX certificates_verification_code_unique
  ON certificates (verification_code);
--> statement-breakpoint
CREATE UNIQUE INDEX certificates_one_issued_per_enrolment_unique
  ON certificates (organisation_id, enrolment_id)
  WHERE status = 'issued';
--> statement-breakpoint
CREATE INDEX certificates_person_idx
  ON certificates (organisation_id, person_id, issue_date);
--> statement-breakpoint
CREATE INDEX certificates_student_idx
  ON certificates (student_id);
--> statement-breakpoint
CREATE INDEX certificates_enrolment_idx
  ON certificates (enrolment_id);
--> statement-breakpoint
CREATE INDEX certificates_status_idx
  ON certificates (organisation_id, status, issue_date);
--> statement-breakpoint
CREATE TABLE certificate_status_events (
  id text PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES organisations(id),
  certificate_id text NOT NULL REFERENCES certificates(id),
  actor_login_account_id text REFERENCES login_accounts(id),
  actor_person_id text REFERENCES people(id),
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  metadata_json text,
  created_at text NOT NULL,
  CONSTRAINT certificate_status_events_action_check CHECK (action IN ('issued', 'revoked', 'superseded', 'reissued'))
);
--> statement-breakpoint
CREATE INDEX certificate_status_events_certificate_idx
  ON certificate_status_events (certificate_id, created_at);
--> statement-breakpoint
INSERT INTO certificate_templates
  (id, organisation_id, code, name, version, status, is_active, created_at, updated_at)
SELECT
  'ctpl_samyak_completion_v1',
  organisations.id,
  'SAMYAK_COMPLETION_V1',
  'Samyak Completion Certificate',
  1,
  'active',
  1,
  '2026-08-14T00:00:00.000Z',
  '2026-08-14T00:00:00.000Z'
FROM organisations
WHERE organisations.id = 'org_samyak'
ON CONFLICT(organisation_id, code, version) DO UPDATE SET
  name = excluded.name,
  status = excluded.status,
  is_active = excluded.is_active,
  updated_at = excluded.updated_at;
