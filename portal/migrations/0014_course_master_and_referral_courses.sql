CREATE TABLE IF NOT EXISTS `course_categories` (
  `id` text PRIMARY KEY NOT NULL,
  `organisation_id` text NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `sort_order` integer NOT NULL DEFAULT 0,
  `is_active` integer DEFAULT 1 NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `course_categories_active_check` CHECK(`is_active` in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `course_categories_organisation_code_unique` ON `course_categories` (`organisation_id`,`code`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `course_categories_org_active_sort_idx` ON `course_categories` (`organisation_id`,`is_active`,`sort_order`);
--> statement-breakpoint
ALTER TABLE `courses` ADD COLUMN `category_id` text REFERENCES `course_categories`(`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `courses_category_status_idx` ON `courses` (`category_id`,`status`);
--> statement-breakpoint
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
    ('ccat_civ', 'org_samyak', 'CIV', 'CIVIL & ARCHITECTURE', 130, 1, '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z')
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
    ('course_syk_civ_002', 'org_samyak', 'SYK-CIV-002', 'MS PROJECT', 'ccat_civ', '1 month', 1, 1000000, 900000, 1, 0, 'active', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z')
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
    ('course_syk_civ_002')
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
