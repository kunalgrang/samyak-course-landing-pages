import { text, sqliteTable } from "drizzle-orm/sqlite-core";
import { enquiries } from "./student-master-schema";

export const enquiryCourseInterests = sqliteTable("enquiry_course_interests", {
  enquiryId: text("enquiry_id")
    .primaryKey()
    .references(() => enquiries.id),
  courseInterestText: text("course_interest_text").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
