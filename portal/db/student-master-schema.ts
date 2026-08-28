import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { branches, loginAccounts, organisations, people, personContacts } from "./schema";

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

export const courseCategories = sqliteTable(
  "course_categories",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("course_categories_organisation_code_unique").on(table.organisationId, table.code),
    index("course_categories_org_active_sort_idx").on(table.organisationId, table.isActive, table.sortOrder),
    check("course_categories_active_check", sql`${table.isActive} in (0, 1)`),
  ],
);

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    categoryId: text("category_id").references(() => courseCategories.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    durationLabel: text("duration_label"),
    durationMonths: real("duration_months"),
    defaultFeePaise: integer("default_fee_paise"),
    lowestAcceptableFeePaise: integer("lowest_acceptable_fee_paise"),
    admissionConfigurationComplete: integer("admission_configuration_complete", { mode: "boolean" }).notNull().default(false),
    nsdcAvailable: integer("nsdc_available", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("courses_organisation_code_unique").on(table.organisationId, table.code),
    index("courses_organisation_id_idx").on(table.organisationId),
    index("courses_category_status_idx").on(table.categoryId, table.status),
    check("courses_status_check", sql`${table.status} in ('active', 'inactive', 'archived')`),
  ],
);

export const admissionOptionValues = sqliteTable(
  "admission_option_values",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    category: text("category").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    requiresCustomLabel: integer("requires_custom_label", { mode: "boolean" }).notNull().default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("admission_option_values_category_code_unique").on(table.organisationId, table.category, table.code),
    index("admission_option_values_category_idx").on(table.organisationId, table.category, table.isActive),
    check(
      "admission_option_values_category_check",
      sql`${table.category} in ('preferred_language', 'qualification_level', 'stream', 'occupation_status', 'batch_preference', 'discount_reason')`,
    ),
  ],
);

export const paymentPlanRules = sqliteTable(
  "payment_plan_rules",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    minDurationMonths: integer("min_duration_months").notNull(),
    maxDurationMonths: integer("max_duration_months"),
    planType: text("plan_type").notNull(),
    fixedInstalments: integer("fixed_instalments"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("payment_plan_rules_duration_idx").on(table.organisationId, table.minDurationMonths, table.maxDurationMonths, table.isActive),
    check("payment_plan_rules_duration_check", sql`${table.minDurationMonths} >= 1 and (${table.maxDurationMonths} is null or ${table.maxDurationMonths} >= ${table.minDurationMonths})`),
    check("payment_plan_rules_plan_check", sql`${table.planType} in ('full', 'two_instalments', 'three_instalments', 'custom')`),
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
    pipelineStage: text("pipeline_stage").notNull().default("new"),
    nextFollowUpAt: text("next_follow_up_at"),
    assignedAt: text("assigned_at"),
    lastContactedAt: text("last_contacted_at"),
    lostReason: text("lost_reason"),
    closedReason: text("closed_reason"),
    convertedEnrolmentId: text("converted_enrolment_id"),
    convertedAt: text("converted_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("enquiries_organisation_number_unique").on(table.organisationId, table.enquiryNumber),
    index("enquiries_mobile_used_idx").on(table.mobileUsed),
    index("enquiries_person_id_idx").on(table.personId),
    index("enquiries_branch_status_idx").on(table.branchId, table.status),
    index("enquiries_branch_pipeline_followup_idx").on(table.branchId, table.pipelineStage, table.nextFollowUpAt),
    index("enquiries_branch_counsellor_pipeline_followup_idx").on(table.branchId, table.counsellorLoginAccountId, table.pipelineStage, table.nextFollowUpAt),
    index("enquiries_branch_created_idx").on(table.branchId, table.createdAt),
    index("enquiries_next_follow_up_idx").on(table.nextFollowUpAt),
    check(
      "enquiries_status_check",
      sql`${table.status} in ('new', 'attempted_contact', 'contacted', 'follow_up', 'counselling_completed', 'demo_scheduled', 'interested', 'admission_pending', 'converted', 'not_interested', 'lost', 'duplicate', 'invalid')`,
    ),
    check(
      "enquiries_pipeline_stage_check",
      sql`${table.pipelineStage} in ('new', 'contacting', 'engaged', 'considering', 'deferred', 'admission_ready', 'converted', 'lost', 'invalid', 'duplicate')`,
    ),
    check(
      "enquiries_closed_reason_check",
      sql`${table.closedReason} is null or ${table.closedReason} in ('not_interested', 'joined_elsewhere', 'fee_budget_issue', 'batch_timing_issue', 'location_travel_issue', 'course_not_suitable', 'no_response', 'postponed_indefinitely', 'other')`,
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

export const enquiryFollowUpEvents = sqliteTable(
  "enquiry_follow_up_events",
  {
    id: text("id").primaryKey(),
    enquiryId: text("enquiry_id")
      .notNull()
      .references(() => enquiries.id),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    actorLoginAccountId: text("actor_login_account_id").notNull(),
    channel: text("channel").notNull(),
    outcome: text("outcome").notNull(),
    note: text("note"),
    occurredAt: text("occurred_at").notNull(),
    nextFollowUpAtSnapshot: text("next_follow_up_at_snapshot"),
    pipelineStageSnapshot: text("pipeline_stage_snapshot").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("enquiry_follow_up_events_enquiry_created_idx").on(table.enquiryId, table.createdAt),
    index("enquiry_follow_up_events_branch_created_idx").on(table.branchId, table.createdAt),
    check("enquiry_follow_up_events_channel_check", sql`${table.channel} in ('call', 'whatsapp', 'in_person', 'email', 'other')`),
    check(
      "enquiry_follow_up_events_outcome_check",
      sql`${table.outcome} in ('call_connected', 'call_no_answer', 'call_busy', 'whatsapp_sent', 'whatsapp_replied', 'whatsapp_no_response', 'callback_requested', 'course_details_shared', 'fee_discussed', 'batch_discussed', 'visit_scheduled', 'demo_scheduled', 'demo_completed', 'thinking', 'deferred_joining', 'not_interested', 'joined_elsewhere', 'invalid_contact', 'other')`,
    ),
    check(
      "enquiry_follow_up_events_pipeline_stage_check",
      sql`${table.pipelineStageSnapshot} in ('new', 'contacting', 'engaged', 'considering', 'deferred', 'admission_ready', 'converted', 'lost', 'invalid', 'duplicate')`,
    ),
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
    referralId: text("referral_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("enrolments_branch_number_unique").on(table.branchId, table.enrolmentNumber),
    index("enrolments_student_id_idx").on(table.studentId),
    index("enrolments_course_id_idx").on(table.courseId),
    index("enrolments_enquiry_id_idx").on(table.enquiryId),
    index("enrolments_referrer_profile_id_idx").on(table.referrerProfileId),
    index("enrolments_referral_id_idx").on(table.referralId),
    check("enrolments_training_mode_check", sql`${table.trainingMode} in ('classroom', 'online', 'hybrid')`),
    check(
      "enrolments_status_check",
      sql`${table.status} in ('provisional', 'confirmed', 'not_started', 'active', 'on_hold', 'transferred', 'completed', 'dropped_out', 'cancelled', 'expired')`,
    ),
    check("enrolments_nsdc_preference_check", sql`${table.nsdcPreference} in ('yes', 'no', 'decide_later')`),
  ],
);

export const batches = sqliteTable(
  "batches",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id),
    name: text("name").notNull(),
    primaryTrainerPersonId: text("primary_trainer_person_id").references(() => people.id),
    daysOfWeekJson: text("days_of_week_json").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    capacity: integer("capacity"),
    status: text("status").notNull().default("active"),
    createdByLoginAccountId: text("created_by_login_account_id").references(() => loginAccounts.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("batches_org_branch_name_unique").on(table.organisationId, table.branchId, table.name),
    index("batches_org_branch_course_status_idx").on(table.organisationId, table.branchId, table.courseId, table.status),
    index("batches_trainer_status_idx").on(table.primaryTrainerPersonId, table.status),
    check("batches_status_check", sql`${table.status} in ('active', 'inactive', 'completed')`),
    check("batches_time_format_check", sql`${table.startTime} glob '[0-2][0-9]:[0-5][0-9]' and ${table.endTime} glob '[0-2][0-9]:[0-5][0-9]' and ${table.startTime} < '24:00' and ${table.endTime} < '24:00' and ${table.endTime} > ${table.startTime}`),
    check("batches_capacity_check", sql`${table.capacity} is null or ${table.capacity} > 0`),
    check("batches_days_json_check", sql`json_valid(${table.daysOfWeekJson}) and json_array_length(${table.daysOfWeekJson}) >= 1`),
  ],
);

export const batchMemberships = sqliteTable(
  "batch_memberships",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id),
    enrolmentId: text("enrolment_id")
      .notNull()
      .references(() => enrolments.id),
    joinedAt: text("joined_at").notNull(),
    leftAt: text("left_at"),
    status: text("status").notNull().default("active"),
    assignedByLoginAccountId: text("assigned_by_login_account_id").references(() => loginAccounts.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("batch_memberships_one_active_enrolment")
      .on(table.enrolmentId)
      .where(sql`${table.status} = 'active' and ${table.leftAt} is null`),
    index("batch_memberships_batch_status_idx").on(table.batchId, table.status, table.joinedAt),
    index("batch_memberships_enrolment_status_idx").on(table.enrolmentId, table.status, table.joinedAt),
    index("batch_memberships_org_enrolment_idx").on(table.organisationId, table.enrolmentId),
    check("batch_memberships_status_check", sql`${table.status} in ('active', 'transferred', 'removed', 'completed')`),
    check("batch_memberships_active_lifecycle_check", sql`(${table.status} = 'active' and ${table.leftAt} is null) or (${table.status} <> 'active' and ${table.leftAt} is not null)`),
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
    discountApprovalId: text("discount_approval_id"),
    gstRateBasisPoints: integer("gst_rate_basis_points").notNull().default(0),
    paymentPlanType: text("payment_plan_type").notNull(),
    numberOfInstalments: integer("number_of_instalments"),
    initialPaymentExpectedPaise: integer("initial_payment_expected_paise").notNull().default(0),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("fee_agreements_enrolment_unique").on(table.enrolmentId),
    index("fee_agreements_discount_approval_idx").on(table.discountApprovalId),
    check("fee_agreements_status_check", sql`${table.status} in ('draft', 'active', 'replaced', 'cancelled')`),
  ],
);

export const receipts = sqliteTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    receiptNumber: text("receipt_number").notNull(),
    receiptYear: integer("receipt_year").notNull(),
    enquiryId: text("enquiry_id").references(() => enquiries.id),
    admissionDraftId: text("admission_draft_id").references(() => admissionDrafts.id),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    studentId: text("student_id").references(() => students.id),
    enrolmentId: text("enrolment_id").references(() => enrolments.id),
    feeAgreementId: text("fee_agreement_id").references(() => feeAgreements.id),
    amountPaise: integer("amount_paise").notNull(),
    receivedAt: text("received_at").notNull(),
    paymentMode: text("payment_mode").notNull(),
    paymentReference: text("payment_reference"),
    notes: text("notes"),
    status: text("status").notNull().default("recorded"),
    createdByLoginAccountId: text("created_by_login_account_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("receipts_number_unique").on(table.organisationId, table.branchId, table.receiptNumber),
    uniqueIndex("receipts_idempotency_unique").on(table.organisationId, table.createdByLoginAccountId, table.idempotencyKey),
    uniqueIndex("receipts_one_preconfirm_token_per_draft")
      .on(table.admissionDraftId)
      .where(sql`${table.enrolmentId} is null and ${table.status} = 'recorded'`),
    index("receipts_enquiry_created_idx").on(table.enquiryId, table.createdAt),
    index("receipts_draft_created_idx").on(table.admissionDraftId, table.createdAt),
    index("receipts_enrolment_created_idx").on(table.enrolmentId, table.createdAt),
    index("receipts_fee_agreement_created_idx").on(table.feeAgreementId, table.createdAt),
    check("receipts_amount_positive_check", sql`${table.amountPaise} > 0`),
    check("receipts_status_check", sql`${table.status} in ('recorded')`),
    check("receipts_payment_mode_check", sql`${table.paymentMode} in ('cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other')`),
  ],
);

export const feeAgreementInstalments = sqliteTable(
  "fee_agreement_instalments",
  {
    id: text("id").primaryKey(),
    feeAgreementId: text("fee_agreement_id")
      .notNull()
      .references(() => feeAgreements.id),
    instalmentNumber: integer("instalment_number").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    dueDate: text("due_date"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("fee_agreement_instalments_unique").on(table.feeAgreementId, table.instalmentNumber),
    index("fee_agreement_instalments_order_idx").on(table.feeAgreementId, table.instalmentNumber),
    check("fee_agreement_instalments_number_check", sql`${table.instalmentNumber} >= 1`),
    check("fee_agreement_instalments_amount_check", sql`${table.amountPaise} > 0`),
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
    uniqueIndex("student_consents_enrolment_type_unique")
      .on(table.enrolmentId, table.consentType)
      .where(sql`${table.enrolmentId} is not null`),
  ],
);

export const numberSequences = sqliteTable(
  "number_sequences",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    sequenceKey: text("sequence_key").notNull(),
    nextSequence: integer("next_sequence").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("number_sequences_branch_key_unique").on(table.organisationId, table.branchId, table.sequenceKey),
    index("number_sequences_branch_id_idx").on(table.branchId),
  ],
);

export const admissionDrafts = sqliteTable(
  "admission_drafts",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    enquiryId: text("enquiry_id")
      .notNull()
      .references(() => enquiries.id),
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    payloadJson: text("payload_json").notNull(),
    currentStep: text("current_step").notNull().default("identity"),
    status: text("status").notNull().default("draft"),
    createdByLoginAccountId: text("created_by_login_account_id").notNull(),
    updatedByLoginAccountId: text("updated_by_login_account_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    confirmedAt: text("confirmed_at"),
    confirmationLockedAt: text("confirmation_locked_at"),
    confirmationSnapshotJson: text("confirmation_snapshot_json"),
    confirmationSnapshotVersion: text("confirmation_snapshot_version"),
    confirmationLockedByLoginAccountId: text("confirmation_locked_by_login_account_id"),
  },
  (table) => [
    index("admission_drafts_enquiry_id_idx").on(table.enquiryId),
    index("admission_drafts_person_id_idx").on(table.personId),
    index("admission_drafts_confirmation_lock_idx").on(table.confirmationLockedAt),
    check("admission_drafts_status_check", sql`${table.status} in ('draft', 'confirmed', 'cancelled')`),
  ],
);

export const admissionDiscountApprovals = sqliteTable(
  "admission_discount_approvals",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    admissionDraftId: text("admission_draft_id")
      .notNull()
      .references(() => admissionDrafts.id),
    enquiryId: text("enquiry_id")
      .notNull()
      .references(() => enquiries.id),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id),
    requestedFinalFeePaise: integer("requested_final_fee_paise").notNull(),
    listedFeePaise: integer("listed_fee_paise").notNull().default(0),
    lowestAcceptableFeePaise: integer("lowest_acceptable_fee_paise").notNull().default(0),
    discountAmountPaise: integer("discount_amount_paise").notNull().default(0),
    approvalFingerprint: text("approval_fingerprint").notNull().default(""),
    discountReasonCode: text("discount_reason_code").notNull(),
    discountReasonText: text("discount_reason_text"),
    status: text("status").notNull().default("pending"),
    requestedByLoginAccountId: text("requested_by_login_account_id").notNull(),
    decidedByLoginAccountId: text("decided_by_login_account_id"),
    decidedAt: text("decided_at"),
    decisionNotes: text("decision_notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("admission_discount_approvals_status_idx").on(table.organisationId, table.status, table.createdAt),
    index("admission_discount_approvals_draft_idx").on(table.admissionDraftId),
    uniqueIndex("admission_discount_approvals_active_fingerprint_unique")
      .on(table.organisationId, table.approvalFingerprint)
      .where(sql`${table.status} in ('pending', 'approved')`),
    check("admission_discount_approvals_status_check", sql`${table.status} in ('pending', 'approved', 'rejected', 'superseded')`),
  ],
);
