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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
