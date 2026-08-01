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

INSERT OR IGNORE INTO admission_option_values
  (id, organisation_id, category, code, label, sort_order, requires_custom_label, is_active, created_at, updated_at)
VALUES
  ('adopt_lang_english', 'org_samyak', 'preferred_language', 'english', 'English', 10, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_lang_hindi', 'org_samyak', 'preferred_language', 'hindi', 'Hindi', 20, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_lang_marathi', 'org_samyak', 'preferred_language', 'marathi', 'Marathi', 30, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_lang_other', 'org_samyak', 'preferred_language', 'other', 'Other', 99, 1, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_qual_ssc', 'org_samyak', 'qualification_level', 'ssc', 'SSC / 10th', 20, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_qual_hsc', 'org_samyak', 'qualification_level', 'hsc', 'HSC / 12th', 30, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_qual_diploma', 'org_samyak', 'qualification_level', 'diploma', 'Diploma', 40, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_qual_graduate', 'org_samyak', 'qualification_level', 'graduate', 'Graduate', 50, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_qual_other', 'org_samyak', 'qualification_level', 'other', 'Other', 99, 1, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_stream_arts', 'org_samyak', 'stream', 'arts', 'Arts', 10, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_stream_commerce', 'org_samyak', 'stream', 'commerce', 'Commerce', 20, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_stream_science', 'org_samyak', 'stream', 'science', 'Science', 30, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_stream_it', 'org_samyak', 'stream', 'it', 'IT / Computer', 50, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_stream_other', 'org_samyak', 'stream', 'other', 'Other', 99, 1, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_occ_student', 'org_samyak', 'occupation_status', 'student', 'Student', 10, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_occ_working', 'org_samyak', 'occupation_status', 'working', 'Working professional', 20, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_occ_job_seeker', 'org_samyak', 'occupation_status', 'job_seeker', 'Job seeker', 30, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_occ_business', 'org_samyak', 'occupation_status', 'business', 'Business / self-employed', 50, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_occ_other', 'org_samyak', 'occupation_status', 'other', 'Other', 99, 1, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_batch_8_11', 'org_samyak', 'batch_preference', '8_11', '8 AM to 11 AM', 10, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_batch_11_2', 'org_samyak', 'batch_preference', '11_2', '11 AM to 2 PM', 20, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_batch_2_5', 'org_samyak', 'batch_preference', '2_5', '2 PM to 5 PM', 30, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_batch_5_8', 'org_samyak', 'batch_preference', '5_8', '5 PM to 8 PM', 40, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_batch_weekend', 'org_samyak', 'batch_preference', 'weekend', 'Weekend', 50, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_batch_other', 'org_samyak', 'batch_preference', 'other', 'Other', 99, 1, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_discount_merit', 'org_samyak', 'discount_reason', 'merit', 'Merit scholarship', 10, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_discount_need', 'org_samyak', 'discount_reason', 'need_based', 'Need-based concession', 20, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_discount_referral', 'org_samyak', 'discount_reason', 'referral', 'Referral concession', 30, 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('adopt_discount_other', 'org_samyak', 'discount_reason', 'other', 'Other', 99, 1, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');

INSERT OR IGNORE INTO payment_plan_rules
  (id, organisation_id, min_duration_months, max_duration_months, plan_type, fixed_instalments, is_active, created_at, updated_at)
VALUES
  ('payrule_short_full', 'org_samyak', 1, 3, 'full', 1, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('payrule_short_two', 'org_samyak', 1, 3, 'two_instalments', 2, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('payrule_mid_full', 'org_samyak', 4, 6, 'full', 1, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('payrule_mid_two', 'org_samyak', 4, 6, 'two_instalments', 2, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('payrule_mid_three', 'org_samyak', 4, 6, 'three_instalments', 3, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('payrule_long_full', 'org_samyak', 7, null, 'full', 1, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('payrule_long_two', 'org_samyak', 7, null, 'two_instalments', 2, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('payrule_long_three', 'org_samyak', 7, null, 'three_instalments', 3, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('payrule_long_custom', 'org_samyak', 7, null, 'custom', null, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');

INSERT INTO roles (id, organisation_id, code, name, created_at)
VALUES
  ('role_owner', 'org_samyak', 'owner', 'Owner', '2026-07-21T00:00:00.000Z'),
  ('role_student', 'org_samyak', 'student', 'Student', '2026-07-21T00:00:00.000Z'),
  ('role_alumni', 'org_samyak', 'alumni', 'Alumni', '2026-07-21T00:00:00.000Z'),
  ('role_admin', 'org_samyak', 'admin', 'Admin', '2026-07-21T00:00:00.000Z'),
  ('role_counsellor', 'org_samyak', 'counsellor', 'Counsellor', '2026-07-21T00:00:00.000Z'),
  ('role_admission_admin', 'org_samyak', 'admission_admin', 'Admission Admin', '2026-07-21T00:00:00.000Z'),
  ('role_trainer', 'org_samyak', 'trainer', 'Trainer', '2026-07-21T00:00:00.000Z'),
  ('role_system_admin', 'org_samyak', 'system_admin', 'System Admin', '2026-07-21T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  organisation_id = excluded.organisation_id,
  code = excluded.code,
  name = excluded.name;
