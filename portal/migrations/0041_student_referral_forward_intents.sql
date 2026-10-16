-- KUN-73: isolated foundation. No trigger is installed on an existing runtime table.
CREATE TABLE student_referral_admission_intents (
  id TEXT PRIMARY KEY NOT NULL,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  enrolment_id TEXT NOT NULL UNIQUE REFERENCES enrolments(id),
  draft_id TEXT NOT NULL UNIQUE REFERENCES admission_drafts(id),
  enquiry_id TEXT NOT NULL UNIQUE REFERENCES enquiries(id),
  confirmation_audit_id TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
--> statement-breakpoint
CREATE TABLE student_referral_provisioning_events (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES student_referral_admission_intents(id),
  person_id TEXT NOT NULL UNIQUE REFERENCES people(id),
  profile_id TEXT NOT NULL UNIQUE REFERENCES referrer_profiles(id),
  login_account_id TEXT NOT NULL REFERENCES login_accounts(id),
  programme_id TEXT NOT NULL REFERENCES referral_programmes(id),
  audit_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
--> statement-breakpoint
-- Common relational evidence. Lifecycle and confirmation state are checked by each caller.
CREATE VIEW student_referral_admission_evidence AS
SELECT d.id AS draft_id, d.enquiry_id, d.organisation_id, d.person_id,
       s.id AS student_id, e.id AS enrolment_id, d.branch_id,
       d.status AS draft_status, d.confirmed_at, d.confirmation_locked_at,
       d.confirmation_snapshot_json AS snapshot_json, e.status AS enrolment_status,
       q.status AS enquiry_status, q.pipeline_stage, q.converted_enrolment_id
FROM admission_drafts d
JOIN enquiries q ON q.id = d.enquiry_id AND q.organisation_id = d.organisation_id
  AND q.person_id = d.person_id AND q.branch_id = d.branch_id
JOIN enrolments e ON e.enquiry_id = q.id AND e.branch_id = d.branch_id
JOIN students s ON s.id = e.student_id AND s.person_id = d.person_id AND s.organisation_id = d.organisation_id
JOIN people p ON p.id = d.person_id AND p.organisation_id = d.organisation_id
JOIN branches b ON b.id = d.branch_id AND b.organisation_id = d.organisation_id
JOIN courses c ON c.id = e.course_id AND c.organisation_id = d.organisation_id
WHERE d.confirmation_snapshot_version = 'admission-confirmation-v1'
 AND json_valid(d.confirmation_snapshot_json)
 AND json_extract(d.confirmation_snapshot_json, '$.version') = 'admission-confirmation-v1'
 AND json_extract(d.confirmation_snapshot_json, '$.organisationId') = d.organisation_id
 AND json_extract(d.confirmation_snapshot_json, '$.personId') = d.person_id
 AND json_extract(d.confirmation_snapshot_json, '$.draftId') = d.id
 AND json_extract(d.confirmation_snapshot_json, '$.enquiryId') = d.enquiry_id
 AND json_extract(d.confirmation_snapshot_json, '$.branchId') = d.branch_id
 AND json_extract(d.confirmation_snapshot_json, '$.courseId') = e.course_id
 AND (SELECT count(*) FROM admission_drafts x WHERE x.enquiry_id = d.enquiry_id AND x.status != 'cancelled') = 1;
--> statement-breakpoint
CREATE TRIGGER student_referral_intent_insert BEFORE INSERT ON student_referral_admission_intents BEGIN
  SELECT CASE WHEN NEW.id != 'sr-intent:' || NEW.enrolment_id
    OR NEW.confirmation_audit_id != 'sr-confirm:' || NEW.enrolment_id
    OR NOT EXISTS (
      SELECT 1 FROM student_referral_admission_evidence v
      JOIN enrolments e ON e.id = v.enrolment_id
      JOIN fee_agreements f ON f.enrolment_id = e.id
      WHERE v.draft_id = NEW.draft_id AND v.enquiry_id = NEW.enquiry_id
        AND v.organisation_id = NEW.organisation_id AND v.person_id = NEW.person_id
        AND v.student_id = NEW.student_id AND v.enrolment_id = NEW.enrolment_id
        AND v.snapshot_json = NEW.snapshot_json
        AND v.draft_status = 'draft' AND v.confirmed_at IS NULL
        AND v.enrolment_status = 'confirmed'
        AND v.enquiry_status != 'converted' AND v.pipeline_stage != 'converted'
        AND v.converted_enrolment_id IS NULL
        AND (v.confirmation_locked_at GLOB '????-??-??' OR v.confirmation_locked_at GLOB '????-??-??T??:??:??Z' OR v.confirmation_locked_at GLOB '????-??-??T??:??:??.???Z')
        AND julianday(v.confirmation_locked_at) <= julianday('now')
        AND e.admission_date IS json_extract(NEW.snapshot_json, '$.admissionDate')
        AND e.joining_date IS json_extract(NEW.snapshot_json, '$.joiningDate')
        AND e.expected_completion_date IS json_extract(NEW.snapshot_json, '$.expectedCompletionDate')
        AND e.training_mode IS json_extract(NEW.snapshot_json, '$.trainingMode')
        AND e.batch_preference IS json_extract(NEW.snapshot_json, '$.batchPreference')
        AND e.nsdc_preference IS json_extract(NEW.snapshot_json, '$.nsdcPreference')
        AND f.standard_fee_paise = json_extract(NEW.snapshot_json, '$.listedFeePaise')
        AND f.final_agreed_fee_paise = json_extract(NEW.snapshot_json, '$.finalAgreedFeePaise')
        AND f.discount_paise = json_extract(NEW.snapshot_json, '$.discountAmountPaise')
        AND f.discount_approved_by IS json_extract(NEW.snapshot_json, '$.discountApprovedByLoginAccountId')
        AND f.discount_approval_id IS json_extract(NEW.snapshot_json, '$.discountApprovalId')
        AND f.payment_plan_type = json_extract(NEW.snapshot_json, '$.paymentPlanType')
        AND f.number_of_instalments IS json_extract(NEW.snapshot_json, '$.numberOfInstalments')
        AND f.initial_payment_expected_paise IS json_extract(NEW.snapshot_json, '$.initialPaymentExpectedPaise')
        -- Same effective first/token receipt evidence as admission finalization; no new payment threshold.
        AND json_extract(NEW.snapshot_json, '$.tokenReceiptId') = (
          SELECT r.id FROM receipts r WHERE r.enrolment_id = e.id AND r.status = 'recorded'
            AND NOT EXISTS(SELECT 1 FROM receipt_reversals rr WHERE rr.receipt_id = r.id)
          ORDER BY r.received_at, r.created_at LIMIT 1)
        AND EXISTS(SELECT 1 FROM receipts r WHERE r.id = json_extract(NEW.snapshot_json, '$.tokenReceiptId')
          AND r.organisation_id = NEW.organisation_id AND r.branch_id = v.branch_id
          AND r.person_id = NEW.person_id AND r.student_id = NEW.student_id
          AND r.enquiry_id = NEW.enquiry_id AND r.admission_draft_id = NEW.draft_id AND r.fee_agreement_id = f.id)
    ) THEN RAISE(ABORT, 'student_referral_intent_guard') END;
END;
--> statement-breakpoint
-- This single outer INSERT is the proposed KUN-76 final-marker boundary.
-- RAISE(ABORT) rolls back the intent, BOTH markers and audit on any failure.
CREATE TRIGGER student_referral_intent_finalize AFTER INSERT ON student_referral_admission_intents BEGIN
  UPDATE admission_drafts SET status = 'confirmed', confirmed_at = NEW.created_at, updated_at = NEW.created_at
    WHERE id = NEW.draft_id AND status = 'draft' AND confirmed_at IS NULL;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'student_referral_transition_count') END;
  UPDATE enquiries SET status = 'converted', pipeline_stage = 'converted',
    converted_enrolment_id = NEW.enrolment_id, updated_at = NEW.created_at
    WHERE id = NEW.enquiry_id AND converted_enrolment_id IS NULL AND status != 'converted' AND pipeline_stage != 'converted';
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'student_referral_transition_count') END;
  INSERT INTO audit_logs(id, organisation_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES(NEW.confirmation_audit_id, NEW.organisation_id, 'student_referral.forward_confirmation',
      'student_referral_admission_intent', NEW.id,
      json_object('enrolmentId', NEW.enrolment_id, 'studentId', NEW.student_id, 'personId', NEW.person_id), NEW.created_at);
END;
--> statement-breakpoint
-- An atomic write-time projection of the accepted KUN-72 gates. SQL uses the DB clock.
CREATE VIEW student_referral_write_eligibility AS
SELECT i.id AS intent_id, i.person_id, i.organisation_id, a.id AS login_account_id, rp.id AS programme_id
FROM student_referral_admission_intents i
JOIN student_referral_admission_evidence v ON v.draft_id = i.draft_id AND v.enquiry_id = i.enquiry_id
 AND v.organisation_id = i.organisation_id AND v.person_id = i.person_id
 AND v.student_id = i.student_id AND v.enrolment_id = i.enrolment_id AND v.snapshot_json = i.snapshot_json
JOIN audit_logs au ON au.id = i.confirmation_audit_id AND au.organisation_id = i.organisation_id
 AND au.action = 'student_referral.forward_confirmation' AND au.entity_type = 'student_referral_admission_intent' AND au.entity_id = i.id
JOIN organisations o ON o.id = i.organisation_id AND o.status = 'active'
JOIN people p ON p.id = i.person_id AND p.organisation_id = i.organisation_id AND p.status = 'active'
JOIN students s ON s.id = i.student_id AND s.person_id = p.id AND s.organisation_id = o.id AND s.portal_status != 'disabled'
JOIN login_accounts a ON a.organisation_id = o.id AND a.status = 'active' AND a.login_enabled = 1
JOIN global_identities g ON g.id = a.global_identity_id AND g.status = 'active' AND g.mobile_normalized = a.mobile_normalized
JOIN organisation_memberships m ON m.id = a.organisation_membership_id AND m.login_account_id = a.id
 AND m.global_identity_id = g.id AND m.organisation_id = o.id AND m.status = 'active'
JOIN login_account_people lp ON lp.login_account_id = a.id AND lp.person_id = p.id AND lp.access_type = 'self' AND lp.is_available = 1
JOIN referral_programmes rp ON rp.organisation_id = o.id AND rp.status = 'active'
WHERE v.draft_status = 'confirmed' AND v.confirmed_at = i.created_at
 AND v.enrolment_status IN ('confirmed', 'not_started', 'active', 'on_hold', 'completed')
 AND v.enquiry_status = 'converted' AND v.pipeline_stage = 'converted' AND v.converted_enrolment_id = i.enrolment_id
 AND (v.confirmation_locked_at GLOB '????-??-??' OR v.confirmation_locked_at GLOB '????-??-??T??:??:??Z' OR v.confirmation_locked_at GLOB '????-??-??T??:??:??.???Z')
 AND julianday(v.confirmation_locked_at) <= julianday(v.confirmed_at) AND julianday(v.confirmed_at) <= julianday('now')
 -- Stored calendar dates / canonical UTC timestamps only. SQLite also accepts
 -- relative expressions ('now') and Julian numbers that Date.parse rejects.
 AND (rp.starts_at IS NULL OR ((rp.starts_at GLOB '????-??-??' OR rp.starts_at GLOB '????-??-??T??:??:??Z' OR rp.starts_at GLOB '????-??-??T??:??:??.???Z') AND julianday(rp.starts_at) <= julianday('now')))
 AND (rp.ends_at IS NULL OR ((rp.ends_at GLOB '????-??-??' OR rp.ends_at GLOB '????-??-??T??:??:??Z' OR rp.ends_at GLOB '????-??-??T??:??:??.???Z') AND julianday(rp.ends_at) >= julianday('now')))
 AND NOT EXISTS(SELECT 1 FROM login_account_people x WHERE x.login_account_id = a.id AND x.person_id != p.id AND (x.is_available = 1 OR x.access_type = 'self'))
 AND EXISTS(SELECT 1 FROM person_roles pr JOIN roles r ON r.id = pr.role_id
   JOIN referral_programme_referrer_types rt ON rt.referral_programme_id = rp.id AND rt.referrer_type = r.code
   WHERE pr.person_id = p.id AND pr.status = 'active' AND r.organisation_id = o.id AND r.code IN ('student', 'alumni'));
--> statement-breakpoint
CREATE TRIGGER student_referral_provision_insert BEFORE INSERT ON student_referral_provisioning_events BEGIN
  SELECT CASE WHEN NEW.profile_id != 'sr-profile:' || NEW.person_id OR NEW.audit_id != 'sr-provision:' || NEW.person_id
    OR NOT EXISTS(SELECT 1 FROM student_referral_write_eligibility v WHERE v.intent_id = NEW.intent_id
      AND v.person_id = NEW.person_id AND v.login_account_id = NEW.login_account_id AND v.programme_id = NEW.programme_id)
    OR EXISTS(SELECT 1 FROM referrer_profiles WHERE person_id = NEW.person_id)
    THEN RAISE(ABORT, 'student_referral_provision_guard') END;
  INSERT INTO referrer_profiles(id, organisation_id, person_id, external_referrer_id, referral_token, personal_link, active, created_at, updated_at)
    SELECT NEW.profile_id, organisation_id, NEW.person_id, 'forward:' || NEW.person_id, 'unissued:' || NEW.person_id, '', 1, NEW.created_at, NEW.created_at
    FROM student_referral_admission_intents WHERE id = NEW.intent_id;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'student_referral_profile_count') END;
  INSERT INTO audit_logs(id, organisation_id, action, entity_type, entity_id, metadata_json, created_at)
    SELECT NEW.audit_id, organisation_id, 'student_referral.profile_created', 'referrer_profile', NEW.profile_id,
      json_object('intentId', NEW.intent_id, 'personId', NEW.person_id, 'programmeId', NEW.programme_id), NEW.created_at
    FROM student_referral_admission_intents WHERE id = NEW.intent_id;
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'student_referral_audit_count') END;
END;
--> statement-breakpoint
CREATE TRIGGER student_referral_intents_no_update BEFORE UPDATE ON student_referral_admission_intents BEGIN
  SELECT RAISE(ABORT, 'student_referral_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER student_referral_intents_no_delete BEFORE DELETE ON student_referral_admission_intents BEGIN
  SELECT RAISE(ABORT, 'student_referral_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER student_referral_events_no_update BEFORE UPDATE ON student_referral_provisioning_events BEGIN
  SELECT RAISE(ABORT, 'student_referral_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER student_referral_events_no_delete BEFORE DELETE ON student_referral_provisioning_events BEGIN
  SELECT RAISE(ABORT, 'student_referral_immutable');
END;
