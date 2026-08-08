-- Adds the owner-approved Soft Skills category and SPOKEN ENGLISH course.
-- The course is referral-eligible for Samyak Skill Circle and uses paise for fees.
WITH category_defaults(id, organisation_id, code, name, sort_order, is_active, created_at, updated_at) AS (
  VALUES
    ('ccat_sft', 'org_samyak', 'SFT', 'Soft Skills', 140, 1, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z')
)
INSERT INTO course_categories
  (id, organisation_id, code, name, sort_order, is_active, created_at, updated_at)
SELECT category_defaults.id, category_defaults.organisation_id, category_defaults.code, category_defaults.name, category_defaults.sort_order, category_defaults.is_active, category_defaults.created_at, category_defaults.updated_at
FROM category_defaults
JOIN organisations ON organisations.id = category_defaults.organisation_id
WHERE true
ON CONFLICT(organisation_id, code) DO UPDATE SET
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = excluded.updated_at;
--> statement-breakpoint
WITH course_defaults(id, organisation_id, code, name, category_id, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at) AS (
  VALUES
    ('course_syk_sft_001', 'org_samyak', 'SYK-SFT-001', 'SPOKEN ENGLISH', 'ccat_sft', '1.5 months', 1.5, 700000, 630000, 1, 0, 'active', '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z')
)
INSERT INTO courses
  (id, organisation_id, code, name, category_id, duration_label, duration_months, default_fee_paise, lowest_acceptable_fee_paise, admission_configuration_complete, nsdc_available, status, created_at, updated_at)
SELECT course_defaults.id, course_defaults.organisation_id, course_defaults.code, course_defaults.name, course_defaults.category_id, course_defaults.duration_label, course_defaults.duration_months, course_defaults.default_fee_paise, course_defaults.lowest_acceptable_fee_paise, course_defaults.admission_configuration_complete, course_defaults.nsdc_available, course_defaults.status, course_defaults.created_at, course_defaults.updated_at
FROM course_defaults
JOIN organisations ON organisations.id = course_defaults.organisation_id
JOIN course_categories ON course_categories.id = course_defaults.category_id
WHERE true
ON CONFLICT(organisation_id, code) DO UPDATE SET
  name = excluded.name,
  category_id = excluded.category_id,
  duration_label = excluded.duration_label,
  duration_months = excluded.duration_months,
  default_fee_paise = excluded.default_fee_paise,
  lowest_acceptable_fee_paise = excluded.lowest_acceptable_fee_paise,
  admission_configuration_complete = excluded.admission_configuration_complete,
  nsdc_available = excluded.nsdc_available,
  status = excluded.status,
  updated_at = excluded.updated_at;
--> statement-breakpoint
WITH eligible_courses(course_id) AS (
  VALUES
    ('course_syk_sft_001')
)
INSERT INTO referral_programme_courses
  (referral_programme_id, course_id, is_active, created_at, updated_at)
SELECT referral_programmes.id, eligible_courses.course_id, 1, '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z'
FROM eligible_courses
JOIN courses ON courses.id = eligible_courses.course_id
  AND courses.organisation_id = 'org_samyak'
  AND courses.status = 'active'
JOIN referral_programmes ON referral_programmes.organisation_id = courses.organisation_id
  AND referral_programmes.code = 'samyak_skill_circle'
WHERE true
ON CONFLICT(referral_programme_id, course_id) DO UPDATE SET
  is_active = excluded.is_active,
  updated_at = excluded.updated_at;
