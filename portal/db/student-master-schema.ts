import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { branches, organisations, people, personContacts } from "./schema";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const personIdentityDetails = sqliteTable(
  "person_identity_details",
  {
    personId: text("person_id")
      .primaryKey()
      .references(() => people.id),
    officialFullName: text("official_full_name").notNull(),
    firstName: text("first_name"),
    middleName: text("middle_name"),
    lastName: text("last_name"),
    dateOfBirth: text("date_of_birth").notNull(),
    gender: text("gender"),
    fatherName: text("father_name"),
    motherName: text("mother_name"),
    occupationStatus: text("occupation_status"),
    identityVerified: integer("identity_verified", { mode: "boolean" }).notNull().default(false),
    identityVerifiedAt: text("identity_verified_at"),
    identityVerifiedBy: text("identity_verified_by"),
    ...timestamps,
  },
  (table) => [
    index("person_identity_details_official_name_idx").on(table.officialFullName),
    index("person_identity_details_dob_idx").on(table.dateOfBirth),
  ],
);

export const personContactDetails = sqliteTable(
  "person_contact_details",
  {
    contactId: text("contact_id")
      .primaryKey()
      .references(() => personContacts.id),
    belongsTo: text("belongs_to").notNull().default("student"),
    contactLabel: text("contact_label"),
    isWhatsapp: integer("is_whatsapp", { mode: "boolean" }).notNull().default(false),
    validFrom: text("valid_from"),
    validUntil: text("valid_until"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    check(
      "person_contact_details_belongs_to_check",
      sql`${table.belongsTo} in ('student', 'father', 'mother', 'guardian', 'family', 'office', 'other')`,
    ),
    check("person_contact_details_status_check", sql`${table.status} in ('active', 'previous', 'inactive')`),
  ],
);

export const students = sqliteTable(
  "students",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    homeBranchId: text("home_branch_id")
      .notNull()
      .references(() => branches.id),
    studentNumber: text("student_number").notNull(),
    sequenceNumber: integer("sequence_number").notNull(),
    studentSince: text("student_since").notNull(),
    currentStatus: text("current_status").notNull().default("active"),
    portalStatus: text("portal_status").notNull().default("not_invited"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("students_organisation_person_unique").on(table.organisationId, table.personId),
    uniqueIndex("students_organisation_number_unique").on(table.organisationId, table.studentNumber),
    uniqueIndex("students_branch_sequence_unique").on(table.homeBranchId, table.sequenceNumber),
    index("students_home_branch_id_idx").on(table.homeBranchId),
    index("students_current_status_idx").on(table.currentStatus),
    check(
      "students_current_status_check",
      sql`${table.currentStatus} in ('active', 'completed', 'alumni', 'on_hold', 'dropped_out', 'cancelled', 'suspended', 'archived')`,
    ),
    check(
      "students_portal_status_check",
      sql`${table.portalStatus} in ('not_invited', 'invited', 'active', 'disabled')`,
    ),
  ],
);

export const personLocalities = sqliteTable(
  "person_localities",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    localityType: text("locality_type").notNull().default("current"),
    locality: text("locality").notNull(),
    city: text("city").notNull(),
    postalCode: text("postal_code"),
    state: text("state"),
    residenceType: text("residence_type"),
    fullAddress: text("full_address"),
    validFrom: text("valid_from"),
    validUntil: text("valid_until"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    index("person_localities_person_id_idx").on(table.personId),
    index("person_localities_locality_city_idx").on(table.locality, table.city),
    check("person_localities_type_check", sql`${table.localityType} in ('current', 'home', 'permanent', 'nsdc')`),
    check("person_localities_status_check", sql`${table.status} in ('active', 'previous', 'inactive')`),
  ],
);

export const personRelationships = sqliteTable(
  "person_relationships",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    relatedName: text("related_name").notNull(),
    relationshipType: text("relationship_type").notNull(),
    mobileNormalized: text("mobile_normalized"),
    occupation: text("occupation"),
    isGuardian: integer("is_guardian", { mode: "boolean" }).notNull().default(false),
    isEmergencyContact: integer("is_emergency_contact", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    index("person_relationships_person_id_idx").on(table.personId),
    index("person_relationships_mobile_idx").on(table.mobileNormalized),
  ],
);

export const educationRecords = sqliteTable(
  "education_records",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    qualificationLevel: text("qualification_level").notNull(),
    qualificationName: text("qualification_name"),
    stream: text("stream"),
    institutionName: text("institution_name"),
    boardUniversity: text("board_university"),
    currentlyPursuing: integer("currently_pursuing", { mode: "boolean" }).notNull().default(false),
    currentYearSemester: text("current_year_semester"),
    passingMonth: integer("passing_month"),
    passingYear: integer("passing_year"),
    resultValue: text("result_value"),
    resultType: text("result_type"),
    ...timestamps,
  },
  (table) => [index("education_records_person_id_idx").on(table.personId)],
);

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    durationLabel: text("duration_label"),
    defaultFeePaise: integer("default_fee_paise"),
    nsdcAvailable: integer("nsdc_available", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("courses_organisation_code_unique").on(table.organisationId, table.code),
    index("courses_organisation_id_idx").on(table.organisationId),
    check("courses_status_check", sql`${table.status} in ('active', 'inactive', 'archived')`),
  ],
);

export const enquiries = sqliteTable(
  "enquiries",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    personId: text("person_id").references(() => people.id),
    enquiryNumber: text("enquiry_number").notNull(),
    mobileUsed: text("mobile_used").notNull(),
    courseInterestId: text("course_interest_id").references(() => courses.id),
    source: text("source").notNull(),
    sourceDetail: text("source_detail"),
    campaignDataJson: text("campaign_data_json"),
    counsellorLoginAccountId: text("counsellor_login_account_id"),
    preferredTiming: text("preferred_timing"),
    preferredJoiningDate: text("preferred_joining_date"),
    status: text("status").notNull().default("new"),
    nextFollowUpAt: text("next_follow_up_at"),
    lostReason: text("lost_reason"),
    convertedEnrolmentId: text("converted_enrolment_id"),
    convertedAt: text("converted_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("enquiries_organisation_number_unique").on(table.organisationId, table.enquiryNumber),
    index("enquiries_mobile_used_idx").on(table.mobileUsed),
    index("enquiries_person_id_idx").on(table.personId),
    index("enquiries_branch_status_idx").on(table.branchId, table.status),
    index("enquiries_next_follow_up_idx").on(table.nextFollowUpAt),
    check(
      "enquiries_status_check",
      sql`${table.status} in ('new', 'attempted_contact', 'contacted', 'follow_up', 'counselling_completed', 'demo_scheduled', 'interested', 'admission_pending', 'converted', 'not_interested', 'lost', 'duplicate', 'invalid')`,
    ),
  ],
);

export const enquiryFollowups = sqliteTable(
  "enquiry_followups",
  {
    id: text("id").primaryKey(),
    enquiryId: text("enquiry_id")
      .notNull()
      .references(() => enquiries.id),
    followupType: text("followup_type").notNull(),
    notes: text("notes"),
    outcome: text("outcome"),
    nextFollowUpAt: text("next_follow_up_at"),
    staffLoginAccountId: text("staff_login_account_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("enquiry_followups_enquiry_id_idx").on(table.enquiryId),
    index("enquiry_followups_next_follow_up_idx").on(table.nextFollowUpAt),
  ],
);

export const enrolments = sqliteTable(
  "enrolments",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id),
    enquiryId: text("enquiry_id").references(() => enquiries.id),
    enrolmentNumber: text("enrolment_number").notNull(),
    trainingMode: text("training_mode").notNull(),
    batchPreference: text("batch_preference"),
    batchId: text("batch_id"),
    admissionDate: text("admission_date").notNull(),
    joiningDate: text("joining_date").notNull(),
    expectedCompletionDate: text("expected_completion_date"),
    actualCompletionDate: text("actual_completion_date"),
    status: text("status").notNull().default("provisional"),
    nsdcPreference: text("nsdc_preference").notNull().default("decide_later"),
    referrerProfileId: text("referrer_profile_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("enrolments_branch_number_unique").on(table.branchId, table.enrolmentNumber),
    index("enrolments_student_id_idx").on(table.studentId),
    index("enrolments_course_id_idx").on(table.courseId),
    index("enrolments_enquiry_id_idx").on(table.enquiryId),
    check("enrolments_training_mode_check", sql`${table.trainingMode} in ('classroom', 'online', 'hybrid')`),
    check(
      "enrolments_status_check",
      sql`${table.status} in ('provisional', 'confirmed', 'not_started', 'active', 'on_hold', 'transferred', 'completed', 'dropped_out', 'cancelled', 'expired')`,
    ),
    check("enrolments_nsdc_preference_check", sql`${table.nsdcPreference} in ('yes', 'no', 'decide_later')`),
  ],
);

export const feeAgreements = sqliteTable(
  "fee_agreements",
  {
    id: text("id").primaryKey(),
    enrolmentId: text("enrolment_id")
      .notNull()
      .references(() => enrolments.id),
    standardFeePaise: integer("standard_fee_paise").notNull(),
    finalAgreedFeePaise: integer("final_agreed_fee_paise").notNull(),
    discountPaise: integer("discount_paise").notNull().default(0),
    discountReason: text("discount_reason"),
    discountApprovedBy: text("discount_approved_by"),
    gstRateBasisPoints: integer("gst_rate_basis_points").notNull().default(0),
    paymentPlanType: text("payment_plan_type").notNull(),
    numberOfInstalments: integer("number_of_instalments"),
    initialPaymentExpectedPaise: integer("initial_payment_expected_paise").notNull().default(0),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("fee_agreements_enrolment_unique").on(table.enrolmentId),
    check("fee_agreements_status_check", sql`${table.status} in ('draft', 'active', 'replaced', 'cancelled')`),
  ],
);

export const nsdcProfiles = sqliteTable(
  "nsdc_profiles",
  {
    id: text("id").primaryKey(),
    enrolmentId: text("enrolment_id")
      .notNull()
      .references(() => enrolments.id),
    aadhaarCiphertext: text("aadhaar_ciphertext"),
    aadhaarLastFour: text("aadhaar_last_four"),
    aadhaarFingerprint: text("aadhaar_fingerprint"),
    aadhaarLinkedMobile: text("aadhaar_linked_mobile"),
    aadhaarVerified: integer("aadhaar_verified", { mode: "boolean" }).notNull().default(false),
    aadhaarVerifiedAt: text("aadhaar_verified_at"),
    religion: text("religion"),
    socialCategory: text("social_category"),
    disabilityStatus: text("disability_status"),
    udidNumber: text("udid_number"),
    bankDetailsCiphertext: text("bank_details_ciphertext"),
    candidateId: text("candidate_id"),
    schemeCode: text("scheme_code"),
    sectorSkillCouncil: text("sector_skill_council"),
    jobRole: text("job_role"),
    qpCode: text("qp_code"),
    nsqfLevel: text("nsqf_level"),
    trainingPartnerId: text("training_partner_id"),
    trainingCentreId: text("training_centre_id"),
    nsdcBatchId: text("nsdc_batch_id"),
    status: text("status").notNull().default("basic_details_pending"),
    submittedAt: text("submitted_at"),
    certificateNumber: text("certificate_number"),
    certificateIssuedAt: text("certificate_issued_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("nsdc_profiles_enrolment_unique").on(table.enrolmentId),
    uniqueIndex("nsdc_profiles_aadhaar_fingerprint_unique").on(table.aadhaarFingerprint),
    index("nsdc_profiles_candidate_id_idx").on(table.candidateId),
    check(
      "nsdc_profiles_status_check",
      sql`${table.status} in ('basic_details_pending', 'aadhaar_pending', 'documents_pending', 'verification_pending', 'correction_required', 'ready_for_sidh', 'registered_on_sidh', 'candidate_id_received', 'batch_enrolled', 'assessment_pending', 'assessment_completed', 'passed', 'failed', 'certificate_issued', 'cancelled')`,
    ),
  ],
);

export const studentDocuments = sqliteTable(
  "student_documents",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    enrolmentId: text("enrolment_id").references(() => enrolments.id),
    documentType: text("document_type").notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename"),
    verificationStatus: text("verification_status").notNull().default("uploaded"),
    uploadedBy: text("uploaded_by"),
    verifiedBy: text("verified_by"),
    verifiedAt: text("verified_at"),
    rejectionReason: text("rejection_reason"),
    expiryDate: text("expiry_date"),
    ...timestamps,
  },
  (table) => [
    index("student_documents_person_id_idx").on(table.personId),
    index("student_documents_enrolment_id_idx").on(table.enrolmentId),
    check(
      "student_documents_verification_status_check",
      sql`${table.verificationStatus} in ('requested', 'uploaded', 'verified', 'rejected', 'expired', 'reupload_required')`,
    ),
  ],
);

export const studentConsents = sqliteTable(
  "student_consents",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    enrolmentId: text("enrolment_id").references(() => enrolments.id),
    consentType: text("consent_type").notNull(),
    consentGiven: integer("consent_given", { mode: "boolean" }).notNull(),
    consentVersion: text("consent_version").notNull(),
    capturedMethod: text("captured_method").notNull(),
    capturedBy: text("captured_by"),
    capturedAt: text("captured_at").notNull(),
    withdrawnAt: text("withdrawn_at"),
  },
  (table) => [
    index("student_consents_person_id_idx").on(table.personId),
    index("student_consents_enrolment_id_idx").on(table.enrolmentId),
  ],
);
