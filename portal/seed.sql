INSERT INTO organisations (id, name, slug, status, created_at, updated_at)
VALUES ('org_samyak', 'Samyak Computer Classes', 'samyak', 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  slug = excluded.slug,
  status = excluded.status,
  updated_at = excluded.updated_at;

INSERT INTO branches (id, organisation_id, name, code, timezone, status, created_at, updated_at)
VALUES ('branch_sion', 'org_samyak', 'Sion', 'SION', 'Asia/Kolkata', 'active', '2026-07-21T00:00:00.000Z', '2026-07-21T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  organisation_id = excluded.organisation_id,
  name = excluded.name,
  code = excluded.code,
  timezone = excluded.timezone,
  status = excluded.status,
  updated_at = excluded.updated_at;

INSERT INTO roles (id, organisation_id, code, name, created_at)
VALUES
  ('role_owner', 'org_samyak', 'owner', 'Owner', '2026-07-21T00:00:00.000Z'),
  ('role_student', 'org_samyak', 'student', 'Student', '2026-07-21T00:00:00.000Z'),
  ('role_alumni', 'org_samyak', 'alumni', 'Alumni', '2026-07-21T00:00:00.000Z'),
  ('role_counsellor', 'org_samyak', 'counsellor', 'Counsellor', '2026-07-21T00:00:00.000Z'),
  ('role_trainer', 'org_samyak', 'trainer', 'Trainer', '2026-07-21T00:00:00.000Z'),
  ('role_system_admin', 'org_samyak', 'system_admin', 'System Admin', '2026-07-21T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  organisation_id = excluded.organisation_id,
  code = excluded.code,
  name = excluded.name;
