import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { branches, loginAccounts, organisations, people } from "./schema";
import { courses, enrolments, students } from "./student-master-schema";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const legacyImportBatches = sqliteTable(
  "legacy_import_batches",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    branchId: text("branch_id")
      .notNull()
      .references(() => branches.id),
    sourceSystem: text("source_system").notNull().default("legacy_student_workbook"),
    sourceFileName: text("source_file_name").notNull(),
    sourceChecksum: text("source_checksum").notNull(),
    mode: text("mode").notNull().default("dry_run"),
    status: text("status").notNull().default("draft"),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    newPersonCount: integer("new_person_count").notNull().default(0),
    existingPersonMatchCount: integer("existing_person_match_count").notNull().default(0),
    reviewRequiredCount: integer("review_required_count").notNull().default(0),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdByLoginAccountId: text("created_by_login_account_id").references(() => loginAccounts.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("legacy_import_batches_source_checksum_unique").on(table.organisationId, table.sourceSystem, table.sourceChecksum),
    index("legacy_import_batches_org_status_idx").on(table.organisationId, table.status, table.createdAt),
    check("legacy_import_batches_mode_check", sql`${table.mode} in ('dry_run', 'apply')`),
    check("legacy_import_batches_status_check", sql`${table.status} in ('draft', 'validated', 'blocked', 'applied', 'failed')`),
    check(
      "legacy_import_batches_counts_check",
      sql`${table.totalRows} >= 0 and ${table.validRows} >= 0 and ${table.errorRows} >= 0 and ${table.newPersonCount} >= 0 and ${table.existingPersonMatchCount} >= 0 and ${table.reviewRequiredCount} >= 0`,
    ),
  ],
);

export const legacyImportRows = sqliteTable(
  "legacy_import_rows",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => legacyImportBatches.id, { onDelete: "cascade" }),
    sourceRowNumber: integer("source_row_number").notNull(),
    rowChecksum: text("row_checksum").notNull(),
    legacyStudentRef: text("legacy_student_ref").notNull(),
    legacyEnrolmentRef: text("legacy_enrolment_ref").notNull(),
    normalisedName: text("normalised_name"),
    mobileLastFour: text("mobile_last_four"),
    courseInput: text("course_input"),
    resolvedCourseId: text("resolved_course_id").references(() => courses.id),
    admissionDate: text("admission_date"),
    legacyStatusInput: text("legacy_status_input"),
    mappedStudentStatus: text("mapped_student_status"),
    mappedEnrolmentStatus: text("mapped_enrolment_status"),
    personMatchStatus: text("person_match_status").notNull().default("not_checked"),
    matchedPersonId: text("matched_person_id").references(() => people.id),
    proposedStudentNumber: text("proposed_student_number"),
    validationStatus: text("validation_status").notNull().default("pending"),
    validationSeverity: text("validation_severity").notNull().default("info"),
    validationCodesJson: text("validation_codes_json").notNull().default("[]"),
    resultPersonId: text("result_person_id").references(() => people.id),
    resultStudentId: text("result_student_id").references(() => students.id),
    resultEnrolmentId: text("result_enrolment_id").references(() => enrolments.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("legacy_import_rows_batch_row_unique").on(table.batchId, table.sourceRowNumber),
    uniqueIndex("legacy_import_rows_batch_enrolment_ref_unique").on(table.batchId, table.legacyEnrolmentRef),
    index("legacy_import_rows_student_ref_idx").on(table.legacyStudentRef),
    index("legacy_import_rows_course_status_idx").on(table.resolvedCourseId, table.validationStatus),
    check("legacy_import_rows_source_row_check", sql`${table.sourceRowNumber} > 0`),
    check("legacy_import_rows_status_check", sql`${table.validationStatus} in ('pending', 'valid', 'review', 'error', 'applied', 'skipped')`),
    check("legacy_import_rows_severity_check", sql`${table.validationSeverity} in ('info', 'warning', 'error')`),
    check(
      "legacy_import_rows_person_match_check",
      sql`${table.personMatchStatus} in ('not_checked', 'new_person', 'exact_existing_match', 'shared_contact_new_person', 'possible_match_review')`,
    ),
  ],
);

export const legacyImportEntityMappings = sqliteTable(
  "legacy_import_entity_mappings",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    sourceSystem: text("source_system").notNull().default("legacy_student_workbook"),
    sourceEntityType: text("source_entity_type").notNull(),
    sourceEntityRef: text("source_entity_ref").notNull(),
    targetEntityType: text("target_entity_type").notNull(),
    targetEntityId: text("target_entity_id").notNull(),
    batchId: text("batch_id")
      .notNull()
      .references(() => legacyImportBatches.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("legacy_import_entity_mappings_source_unique").on(table.organisationId, table.sourceSystem, table.sourceEntityType, table.sourceEntityRef),
    index("legacy_import_entity_mappings_target_idx").on(table.targetEntityType, table.targetEntityId),
    check("legacy_import_entity_mappings_source_type_check", sql`${table.sourceEntityType} in ('person', 'student', 'enrolment')`),
    check("legacy_import_entity_mappings_target_type_check", sql`${table.targetEntityType} in ('person', 'student', 'enrolment')`),
  ],
);
