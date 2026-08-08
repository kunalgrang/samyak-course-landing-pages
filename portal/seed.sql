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

WITH defaults(id, category, code, label, sort_order, requires_custom_label) AS (
  VALUES
    ('adopt_lang_english', 'preferred_language', 'english', 'English', 10, 0),
    ('adopt_lang_hindi', 'preferred_language', 'hindi', 'Hindi', 20, 0),
    ('adopt_lang_marathi', 'preferred_language', 'marathi', 'Marathi', 30, 0),
    ('adopt_lang_gujarati', 'preferred_language', 'gujarati', 'Gujarati', 40, 0),
    ('adopt_lang_other', 'preferred_language', 'other', 'Other', 90, 1),
    ('adopt_qual_below_10th', 'qualification_level', 'below_10th', 'Below 10th', 10, 0),
    ('adopt_qual_ssc', 'qualification_level', 'ssc', 'SSC / 10th', 20, 0),
    ('adopt_qual_hsc', 'qualification_level', 'hsc', 'HSC / 12th', 30, 0),
    ('adopt_qual_diploma', 'qualification_level', 'diploma', 'Diploma', 40, 0),
    ('adopt_qual_undergraduate', 'qualification_level', 'undergraduate', 'Undergraduate', 50, 0),
    ('adopt_qual_graduate', 'qualification_level', 'graduate', 'Graduate', 60, 0),
    ('adopt_qual_postgraduate', 'qualification_level', 'postgraduate', 'Postgraduate', 70, 0),
    ('adopt_qual_doctorate', 'qualification_level', 'doctorate', 'Doctorate', 80, 0),
    ('adopt_qual_other', 'qualification_level', 'other', 'Other', 90, 1),
    ('adopt_stream_general', 'stream', 'general', 'General', 10, 0),
    ('adopt_stream_arts', 'stream', 'arts', 'Arts', 20, 0),
    ('adopt_stream_commerce', 'stream', 'commerce', 'Commerce', 30, 0),
    ('adopt_stream_science', 'stream', 'science', 'Science', 40, 0),
    ('adopt_stream_it_computer_science', 'stream', 'it_computer_science', 'IT / Computer Science', 50, 0),
    ('adopt_stream_engineering', 'stream', 'engineering', 'Engineering', 60, 0),
    ('adopt_stream_management', 'stream', 'management', 'Management', 70, 0),
    ('adopt_stream_vocational', 'stream', 'vocational', 'Vocational', 80, 0),
    ('adopt_stream_other', 'stream', 'other', 'Other', 90, 1),
    ('adopt_occ_student', 'occupation_status', 'student', 'Student', 10, 0),
    ('adopt_occ_employed_salaried', 'occupation_status', 'employed_salaried', 'Employed / Salaried', 20, 0),
    ('adopt_occ_self_employed_business', 'occupation_status', 'self_employed_business', 'Self-employed / Business', 30, 0),
    ('adopt_occ_freelancer', 'occupation_status', 'freelancer', 'Freelancer', 40, 0),
    ('adopt_occ_unemployed_seeking_work', 'occupation_status', 'unemployed_seeking_work', 'Unemployed / Seeking Work', 50, 0),
    ('adopt_occ_homemaker', 'occupation_status', 'homemaker', 'Homemaker', 60, 0),
    ('adopt_occ_other', 'occupation_status', 'other', 'Other', 90, 1),
    ('adopt_batch_08_11', 'batch_preference', '08_11', '8 AM to 11 AM', 10, 0),
    ('adopt_batch_11_14', 'batch_preference', '11_14', '11 AM to 2 PM', 20, 0),
    ('adopt_batch_14_17', 'batch_preference', '14_17', '2 PM to 5 PM', 30, 0),
    ('adopt_batch_17_20', 'batch_preference', '17_20', '5 PM to 8 PM', 40, 0),
    ('adopt_discount_full_upfront', 'discount_reason', 'full_upfront', 'Full upfront payment', 10, 0),
    ('adopt_discount_early_admission', 'discount_reason', 'early_admission', 'Early admission', 20, 0),
    ('adopt_discount_repeat_student', 'discount_reason', 'repeat_student', 'Repeat student', 30, 0),
    ('adopt_discount_referral', 'discount_reason', 'referral', 'Referral', 40, 0),
    ('adopt_discount_scholarship_financial_support', 'discount_reason', 'scholarship_financial_support', 'Scholarship / Financial support', 50, 0),
    ('adopt_discount_promotional_offer', 'discount_reason', 'promotional_offer', 'Promotional offer', 60, 0),
    ('adopt_discount_management_approval', 'discount_reason', 'management_approval', 'Management approval', 70, 0),
    ('adopt_discount_other', 'discount_reason', 'other', 'Other', 90, 1)
)
INSERT INTO admission_option_values
  (id, organisation_id, category, code, label, sort_order, requires_custom_label, is_active, created_at, updated_at)
SELECT defaults.id, organisations.id, defaults.category, defaults.code, defaults.label, defaults.sort_order, defaults.requires_custom_label, 1, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'
FROM defaults
JOIN organisations ON organisations.id = 'org_samyak'
WHERE true
ON CONFLICT(organisation_id, category, code) DO UPDATE SET
  label = excluded.label,
  sort_order = excluded.sort_order,
  requires_custom_label = excluded.requires_custom_label,
  is_active = 1,
  updated_at = excluded.updated_at;

UPDATE admission_option_values
SET is_active = 0,
    updated_at = '2026-08-03T00:00:00.000Z'
WHERE organisation_id = 'org_samyak'
  AND category IN ('preferred_language', 'qualification_level', 'stream', 'occupation_status', 'batch_preference', 'discount_reason')
  AND code NOT IN (
    'english', 'hindi', 'marathi', 'gujarati', 'other',
    'below_10th', 'ssc', 'hsc', 'diploma', 'undergraduate', 'graduate', 'postgraduate', 'doctorate',
    'general', 'arts', 'commerce', 'science', 'it_computer_science', 'engineering', 'management', 'vocational',
    'student', 'employed_salaried', 'self_employed_business', 'freelancer', 'unemployed_seeking_work', 'homemaker',
    '08_11', '11_14', '14_17', '17_20',
    'full_upfront', 'early_admission', 'repeat_student', 'referral', 'scholarship_financial_support', 'promotional_offer', 'management_approval'
  );

WITH defaults(id, min_duration_months, max_duration_months, plan_type, fixed_instalments) AS (
  VALUES
    ('payrule_one_full', 1, 1, 'full', 1),
    ('payrule_short_full', 2, 3, 'full', 1),
    ('payrule_short_two', 2, 3, 'two_instalments', 2),
    ('payrule_mid_full', 4, 6, 'full', 1),
    ('payrule_mid_two', 4, 6, 'two_instalments', 2),
    ('payrule_mid_three', 4, 6, 'three_instalments', 3),
    ('payrule_long_full', 7, NULL, 'full', 1),
    ('payrule_long_two', 7, NULL, 'two_instalments', 2),
    ('payrule_long_three', 7, NULL, 'three_instalments', 3),
    ('payrule_long_custom', 7, NULL, 'custom', NULL)
)
INSERT INTO payment_plan_rules
  (id, organisation_id, min_duration_months, max_duration_months, plan_type, fixed_instalments, is_active, created_at, updated_at)
SELECT defaults.id, organisations.id, defaults.min_duration_months, defaults.max_duration_months, defaults.plan_type, defaults.fixed_instalments, 1, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'
FROM defaults
JOIN organisations ON organisations.id = 'org_samyak'
WHERE true
ON CONFLICT(id) DO UPDATE SET
  organisation_id = excluded.organisation_id,
  min_duration_months = excluded.min_duration_months,
  max_duration_months = excluded.max_duration_months,
  plan_type = excluded.plan_type,
  fixed_instalments = excluded.fixed_instalments,
  is_active = 1,
  updated_at = excluded.updated_at;

UPDATE payment_plan_rules
SET is_active = 0,
    updated_at = '2026-08-03T00:00:00.000Z'
WHERE organisation_id = 'org_samyak'
  AND id NOT IN (
    'payrule_one_full',
    'payrule_short_full',
    'payrule_short_two',
    'payrule_mid_full',
    'payrule_mid_two',
    'payrule_mid_three',
    'payrule_long_full',
    'payrule_long_two',
    'payrule_long_three',
    'payrule_long_custom'
  );

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

WITH programme_defaults AS (
  SELECT
    'rprog_samyak_skill_circle' AS id,
    organisations.id AS organisation_id,
    'samyak_skill_circle' AS code,
    'Samyak Skill Circle' AS name,
    90 AS validity_days,
    50 AS minimum_fee_percentage,
    'active' AS status,
    '2026-08-05T00:00:00.000Z' AS starts_at,
    '2026-08-05T00:00:00.000Z' AS created_at,
    '2026-08-05T00:00:00.000Z' AS updated_at
  FROM organisations
  WHERE organisations.id = 'org_samyak'
)
INSERT INTO referral_programmes
  (id, organisation_id, code, name, validity_days, minimum_fee_percentage, status, starts_at, ends_at, created_at, updated_at)
SELECT id, organisation_id, code, name, validity_days, minimum_fee_percentage, status, starts_at, NULL, created_at, updated_at
FROM programme_defaults
WHERE true
ON CONFLICT(organisation_id, code) DO UPDATE SET
  name = excluded.name,
  validity_days = excluded.validity_days,
  minimum_fee_percentage = excluded.minimum_fee_percentage,
  status = excluded.status,
  updated_at = excluded.updated_at;

WITH referrer_type_defaults(referrer_type) AS (
  VALUES ('student'), ('alumni')
)
INSERT OR IGNORE INTO referral_programme_referrer_types
  (referral_programme_id, referrer_type, created_at)
SELECT referral_programmes.id, referrer_type_defaults.referrer_type, '2026-08-05T00:00:00.000Z'
FROM referrer_type_defaults
JOIN referral_programmes ON referral_programmes.organisation_id = 'org_samyak'
  AND referral_programmes.code = 'samyak_skill_circle';

WITH rule_defaults AS (
  SELECT
    'rrs_samyak_skill_circle_v1' AS id,
    referral_programmes.organisation_id,
    referral_programmes.id AS referral_programme_id,
    1 AS version,
    'Samyak Skill Circle Rewards v1' AS name,
    'active' AS status,
    '2026-08-05T00:00:00.000Z' AS effective_from,
    '2026-08-05T00:00:00.000Z' AS created_at,
    '2026-08-05T00:00:00.000Z' AS updated_at
  FROM referral_programmes
  WHERE referral_programmes.organisation_id = 'org_samyak'
    AND referral_programmes.code = 'samyak_skill_circle'
)
INSERT INTO referral_reward_rule_sets
  (id, organisation_id, referral_programme_id, version, name, status, effective_from, effective_until, created_by_login_account_id, created_at, updated_at)
SELECT id, organisation_id, referral_programme_id, version, name, status, effective_from, NULL, NULL, created_at, updated_at
FROM rule_defaults
WHERE true
ON CONFLICT(referral_programme_id, version) DO UPDATE SET
  name = excluded.name,
  status = excluded.status,
  effective_from = excluded.effective_from,
  effective_until = excluded.effective_until,
  updated_at = excluded.updated_at;

WITH slab_defaults(id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order) AS (
  VALUES
    ('rrs_samyak_skill_circle_v1_slab_1', 0, 999999, 50000, 75000, 10),
    ('rrs_samyak_skill_circle_v1_slab_2', 1000000, 1999999, 75000, 100000, 20),
    ('rrs_samyak_skill_circle_v1_slab_3', 2000000, 2999999, 100000, 150000, 30),
    ('rrs_samyak_skill_circle_v1_slab_4', 3000000, NULL, 150000, 200000, 40)
)
INSERT INTO referral_reward_slabs
  (id, reward_rule_set_id, min_final_fee_paise, max_final_fee_paise, cash_reward_paise, course_credit_paise, sort_order, created_at, updated_at)
SELECT
  slab_defaults.id,
  referral_reward_rule_sets.id,
  slab_defaults.min_final_fee_paise,
  slab_defaults.max_final_fee_paise,
  slab_defaults.cash_reward_paise,
  slab_defaults.course_credit_paise,
  slab_defaults.sort_order,
  '2026-08-05T00:00:00.000Z',
  '2026-08-05T00:00:00.000Z'
FROM slab_defaults
JOIN referral_reward_rule_sets ON referral_reward_rule_sets.id = 'rrs_samyak_skill_circle_v1'
JOIN referral_programmes ON referral_programmes.id = referral_reward_rule_sets.referral_programme_id
WHERE referral_programmes.organisation_id = 'org_samyak'
  AND referral_programmes.code = 'samyak_skill_circle'
ON CONFLICT(reward_rule_set_id, sort_order) DO UPDATE SET
  min_final_fee_paise = excluded.min_final_fee_paise,
  max_final_fee_paise = excluded.max_final_fee_paise,
  cash_reward_paise = excluded.cash_reward_paise,
  course_credit_paise = excluded.course_credit_paise,
  updated_at = excluded.updated_at;

-- Initial Course Master import from owner-approved SAMYAK_COURSE_MASTER_WITH_CODES.xlsx.
-- Course identity is derived from stable workbook codes, not display names.
-- This migration applies once in D1; future owner-edited production Course Master values are not reset by local seed reruns.
WITH category_defaults(id, organisation_id, code, name, sort_order, is_active, created_at, updated_at) AS (
  VALUES
    ('ccat_mscit', 'org_samyak', 'MSCIT', 'MS CIT', 10, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_ccc', 'org_samyak', 'CCC', 'CCC', 20, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_mso', 'org_samyak', 'MSO', 'MS OFFICE', 30, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_aex', 'org_samyak', 'AEX', 'ADVANCED EXCEL', 40, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_tly', 'org_samyak', 'TLY', 'TALLY PRIME', 50, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_dmk', 'org_samyak', 'DMK', 'DIGITAL MARKETING', 60, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_dan', 'org_samyak', 'DAN', 'DATA ANALYTICS', 70, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_wdd', 'org_samyak', 'WDD', 'WEB DESIGN & DEVELOPMENT', 80, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_gds', 'org_samyak', 'GDS', 'GRAPHIC DESIGN', 90, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_ved', 'org_samyak', 'VED', 'VIDEO EDITING', 100, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_avx', 'org_samyak', 'AVX', 'ANIMATION & VFX', 110, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_dsai', 'org_samyak', 'DSAI', 'DATA SCIENCE & AI', 120, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('ccat_civ', 'org_samyak', 'CIV', 'CIVIL & ARCHITECTURE', 130, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
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
    ('course_syk_mscit_001', 'org_samyak', 'SYK-MSCIT-001', 'MS CIT', 'ccat_mscit', '2 months', 2, 620000, 558000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_ccc_001', 'org_samyak', 'SYK-CCC-001', 'CCC', 'ccat_ccc', '2 months', 2, 500000, 450000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_ccc_002', 'org_samyak', 'SYK-CCC-002', 'CCC+', 'ccat_ccc', '2 months', 2, 550000, 495000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_mso_001', 'org_samyak', 'SYK-MSO-001', 'MS OFFICE', 'ccat_mso', '1.5 months', 1.5, 550000, 495000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_aex_001', 'org_samyak', 'SYK-AEX-001', 'ADVANCED EXCEL', 'ccat_aex', '1 month', 1, 550000, 495000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_tly_001', 'org_samyak', 'SYK-TLY-001', 'BASIC TALLY', 'ccat_tly', '1 month', 1, 600000, 540000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_tly_002', 'org_samyak', 'SYK-TLY-002', 'TALLY WITH TAX', 'ccat_tly', '2 months', 2, 1200000, 1080000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_tly_003', 'org_samyak', 'SYK-TLY-003', 'CAP - TALLY WITH TAX AND MS OFFICE', 'ccat_tly', '3 months', 3, 1600000, 1440000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dmk_001', 'org_samyak', 'SYK-DMK-001', 'DIGITAL MARKETING WITH AI TOOLS', 'ccat_dmk', '3 months', 3, 2400000, 2160000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dmk_002', 'org_samyak', 'SYK-DMK-002', 'DIGITAL MARKETING WITH WORDPRESS', 'ccat_dmk', '4 months', 4, 3500000, 3150000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dmk_003', 'org_samyak', 'SYK-DMK-003', 'WORDPRESS', 'ccat_dmk', '1 month', 1, 1000000, 900000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dmk_004', 'org_samyak', 'SYK-DMK-004', 'SHOPIFY', 'ccat_dmk', '1.5 months', 1.5, 1400000, 1260000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dmk_005', 'org_samyak', 'SYK-DMK-005', 'ECOMMERCE', 'ccat_dmk', '2 months', 2, 1500000, 1350000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dmk_006', 'org_samyak', 'SYK-DMK-006', 'META ADS', 'ccat_dmk', '1 month', 1, 750000, 675000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dmk_007', 'org_samyak', 'SYK-DMK-007', 'SEO', 'ccat_dmk', '1 month', 1, 550000, 495000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dmk_008', 'org_samyak', 'SYK-DMK-008', 'GOOGLE ADS', 'ccat_dmk', '1 month', 1, 750000, 675000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dan_001', 'org_samyak', 'SYK-DAN-001', 'DATA ANALYTICS - BEGINNER', 'ccat_dan', '4 months', 4, 2500000, 2250000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dan_002', 'org_samyak', 'SYK-DAN-002', 'DATA ANALYTICS - ADVANCED', 'ccat_dan', '6 months', 6, 4500000, 4050000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dan_003', 'org_samyak', 'SYK-DAN-003', 'POWER BI', 'ccat_dan', '1 month', 1, 1250000, 1125000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_wdd_001', 'org_samyak', 'SYK-WDD-001', 'FULL STACK COURSE - 6 MONTHS', 'ccat_wdd', '6 months', 6, 4500000, 4050000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_wdd_002', 'org_samyak', 'SYK-WDD-002', 'HTML', 'ccat_wdd', '1 month', 1, 1800000, 1620000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_wdd_003', 'org_samyak', 'SYK-WDD-003', 'CSS', 'ccat_wdd', '1 month', 1, 800000, 720000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_wdd_004', 'org_samyak', 'SYK-WDD-004', 'JAVA', 'ccat_wdd', '1 month', 1, 800000, 720000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_wdd_005', 'org_samyak', 'SYK-WDD-005', 'PYTHON & WEB DESIGN', 'ccat_wdd', '3 months', 3, 2500000, 2250000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_wdd_006', 'org_samyak', 'SYK-WDD-006', 'REACT, NODE.JS WITH MONGO DB', 'ccat_wdd', '4 months', 4, 4000000, 3600000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_wdd_007', 'org_samyak', 'SYK-WDD-007', 'UI UX', 'ccat_wdd', '2 months', 2, 1800000, 1620000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_gds_001', 'org_samyak', 'SYK-GDS-001', 'GRAPHIC DESIGN DIPLOMA', 'ccat_gds', '4 months', 4, 3200000, 2880000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_gds_002', 'org_samyak', 'SYK-GDS-002', 'CORELDRAW', 'ccat_gds', '1 month', 1, 750000, 675000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_gds_003', 'org_samyak', 'SYK-GDS-003', 'ADOBE PHOTOSHOP', 'ccat_gds', '1 month', 1, 750000, 675000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_gds_004', 'org_samyak', 'SYK-GDS-004', 'ADOBE ILLUSTRATOR', 'ccat_gds', '1.5 months', 1.5, 1200000, 1080000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_gds_005', 'org_samyak', 'SYK-GDS-005', 'CANVA', 'ccat_gds', '1 month', 1, 750000, 675000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_ved_001', 'org_samyak', 'SYK-VED-001', 'FILMORA', 'ccat_ved', '1 month', 1, 1100000, 990000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_ved_002', 'org_samyak', 'SYK-VED-002', 'ADOBE PREMIERE PRO', 'ccat_ved', '2 months', 2, 1600000, 1440000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_avx_001', 'org_samyak', 'SYK-AVX-001', 'ADOBE ANIMATE', 'ccat_avx', '1.5 months', 1.5, 1400000, 1260000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dsai_001', 'org_samyak', 'SYK-DSAI-001', 'AI TOOLS & PROMPTING', 'ccat_dsai', '1 month', 1, 700000, 630000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dsai_002', 'org_samyak', 'SYK-DSAI-002', 'DIPLOMA IN MACHINE LEARNING', 'ccat_dsai', '3 months', 3, 3500000, 3150000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dsai_003', 'org_samyak', 'SYK-DSAI-003', 'PYTHON - BEGINNER', 'ccat_dsai', '1 month', 1, 850000, 765000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dsai_004', 'org_samyak', 'SYK-DSAI-004', 'PYTHON - ADVANCED', 'ccat_dsai', '2 months', 2, 1600000, 1440000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_dsai_005', 'org_samyak', 'SYK-DSAI-005', 'R PROGRAMMING LANGUAGE', 'ccat_dsai', '1.5 months', 1.5, 2500000, 2250000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_civ_001', 'org_samyak', 'SYK-CIV-001', 'PRIMAVERA', 'ccat_civ', '2 months', 2, 2200000, 1980000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
    ('course_syk_civ_002', 'org_samyak', 'SYK-CIV-002', 'MS PROJECT', 'ccat_civ', '1 month', 1, 1000000, 900000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'),
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
    ('course_syk_mscit_001'), ('course_syk_ccc_001'), ('course_syk_ccc_002'), ('course_syk_mso_001'), ('course_syk_aex_001'),
    ('course_syk_tly_001'), ('course_syk_tly_002'), ('course_syk_tly_003'), ('course_syk_dmk_001'), ('course_syk_dmk_002'),
    ('course_syk_dmk_003'), ('course_syk_dmk_004'), ('course_syk_dmk_005'), ('course_syk_dmk_006'), ('course_syk_dmk_007'),
    ('course_syk_dmk_008'), ('course_syk_dan_001'), ('course_syk_dan_002'), ('course_syk_dan_003'), ('course_syk_wdd_001'),
    ('course_syk_wdd_002'), ('course_syk_wdd_003'), ('course_syk_wdd_004'), ('course_syk_wdd_005'), ('course_syk_wdd_006'),
    ('course_syk_wdd_007'), ('course_syk_gds_001'), ('course_syk_gds_002'), ('course_syk_gds_003'), ('course_syk_gds_004'),
    ('course_syk_gds_005'), ('course_syk_ved_001'), ('course_syk_ved_002'), ('course_syk_avx_001'), ('course_syk_dsai_001'),
    ('course_syk_dsai_002'), ('course_syk_dsai_003'), ('course_syk_dsai_004'), ('course_syk_dsai_005'), ('course_syk_civ_001'),
    ('course_syk_civ_002'), ('course_syk_sft_001')
)
INSERT INTO referral_programme_courses
  (referral_programme_id, course_id, is_active, created_at, updated_at)
SELECT referral_programmes.id, eligible_courses.course_id, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'
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
