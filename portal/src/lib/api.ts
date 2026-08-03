import { z } from "zod";

const healthResponseSchema = z.object({
  success: z.literal(true),
  service: z.literal("samyak-student-portal"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const data: unknown = await response.json();
  return healthResponseSchema.parse(data);
}

const profileSchema = z.object({
  personId: z.string(),
  publicName: z.string(),
  accessType: z.string(),
  roles: z.array(z.string()).default([]),
  effectiveRoles: z.array(z.string()).default([]),
});

export const sessionSchema = z.object({
  authenticated: z.boolean(),
  activeProfile: profileSchema.nullable(),
  profiles: z.array(profileSchema),
  mobileLastFour: z.string().optional(),
  accountRoles: z.array(z.string()).default([]),
  code: z.string().optional(),
  message: z.string().optional(),
  requestId: z.string().optional(),
});

export type SessionResponse = z.infer<typeof sessionSchema>;

const publicConfigSchema = z.object({
  turnstileSiteKey: z.string(),
  otpEnabled: z.boolean(),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;

const requestOtpResponseSchema = z.object({
  success: z.boolean(),
  challengeId: z.string().optional(),
  maskedMobile: z.string().optional(),
  code: z.string().optional(),
  message: z.string(),
  requestId: z.string(),
});

export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

const verifyOtpResponseSchema = z.object({
  success: z.boolean(),
  code: z.string().optional(),
  message: z.string().optional(),
  session: sessionSchema.optional(),
  requestId: z.string(),
});

export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;

const dashboardSchema = z.object({
  success: z.literal(true),
  profile: z.object({
    externalReferrerId: z.string(),
    fullName: z.string(),
    publicName: z.string(),
    referrerType: z.string(),
    courseStudied: z.string(),
    memberSince: z.string(),
    personalLink: z.string(),
    active: z.boolean(),
  }),
  summary: z.object({
    totalReferrals: z.number(),
    successfulAdmissions: z.number(),
    cashRewardsEarned: z.number(),
    courseCreditEarned: z.number(),
  }),
  referrals: z.array(
    z.object({
      referralId: z.string(),
      prospectPublicName: z.string(),
      courseInterested: z.string(),
      submissionDate: z.string(),
      publicStatus: z.string(),
      rewardStatus: z.string(),
      rewardChoice: z.string(),
      cashReward: z.number(),
      courseCredit: z.number(),
      approvedRewardAmount: z.number(),
      rewardPaymentDate: z.string(),
    }),
  ),
});

export type ReferralDashboard = z.infer<typeof dashboardSchema>;

const enquiryOptionsSchema = z.object({
  branches: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  courses: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      duration_label: z.string().nullable().optional(),
      default_fee_paise: z.number().nullable().optional(),
      nsdc_available: z.union([z.number(), z.boolean()]),
    }),
  ),
  sources: z.array(z.string()),
});

const studentSearchSchema = z.object({
  mobileLastFour: z.string(),
  possiblePeople: z.array(
    z.object({
      person_id: z.string(),
      student_id: z.string().nullable().optional(),
      full_name: z.string(),
      date_of_birth: z.string().nullable(),
      student_number: z.string().nullable(),
      student_status: z.string().nullable(),
      mobile_last_four: z.string().nullable(),
    }),
  ),
  enquiries: z.array(
    z.object({
      id: z.string(),
      enquiry_number: z.string(),
      person_id: z.string().nullable(),
      status: z.string(),
      source: z.string(),
      created_at: z.string(),
      course_name: z.string().nullable(),
    }),
  ),
});

const createEnquiryResponseSchema = z.object({
  success: z.literal(true),
  enquiryId: z.string(),
  enquiryNumber: z.string(),
  personId: z.string(),
});

const courseSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  duration_label: z.string().nullable(),
  duration_months: z.number().nullable().optional(),
  default_fee_paise: z.number().nullable(),
  lowest_acceptable_fee_paise: z.number().nullable().optional(),
  admission_configuration_complete: z.union([z.number(), z.boolean()]).optional(),
  nsdc_available: z.union([z.number(), z.boolean()]),
  status: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const courseListSchema = z.object({ courses: z.array(courseSchema) });

const admissionDraftPayloadSchema = z.record(z.string(), z.unknown());

const admissionDraftSchema = z.object({
  draft: z
    .object({
      id: z.string(),
      currentStep: z.string(),
      status: z.string(),
      payload: admissionDraftPayloadSchema,
      confirmedAt: z.string().nullable(),
      confirmationLockedAt: z.string().nullable().optional(),
      confirmationSnapshotVersion: z.string().nullable().optional(),
    })
    .nullable(),
});

const admissionDraftSaveSchema = z.object({
  success: z.literal(true),
  draftId: z.string(),
  payload: admissionDraftPayloadSchema,
  currentStep: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
});

const admissionConfirmationSchema = z.object({
  success: z.literal(true),
  studentId: z.string(),
  studentNumber: z.string(),
  enrolmentId: z.string(),
  enrolmentNumber: z.string(),
  enquiryNumber: z.string(),
  isNewStudent: z.boolean(),
});

const enquiryDetailSchema = z.object({
  enquiry: z.record(z.string(), z.unknown()),
  primaryMobile: z.string().nullable(),
  alternateMobile: z.string().nullable().optional(),
  mobileDisplay: z.string().nullable(),
  alternateMobileDisplay: z.string().nullable().optional(),
  previousEnrolments: z.array(z.record(z.string(), z.unknown())),
  activeDraft: z.object({ id: z.string(), status: z.string(), currentStep: z.string() }).nullable(),
});

const studentProfileSchema = z.object({
  student: z.record(z.string(), z.unknown()),
  primaryMobile: z.string().nullable(),
  mobileDisplay: z.string().nullable(),
  locality: z.record(z.string(), z.unknown()).nullable(),
  education: z.record(z.string(), z.unknown()).nullable(),
  enrolments: z.array(z.record(z.string(), z.unknown())),
  enquiries: z.array(z.record(z.string(), z.unknown())),
});

const admissionConfigurationSchema = z.object({
  options: z.array(
    z.object({
      category: z.string(),
      code: z.string(),
      label: z.string(),
      sort_order: z.number().optional(),
      requires_custom_label: z.union([z.number(), z.boolean()]),
      is_active: z.union([z.number(), z.boolean()]),
    }),
  ),
  paymentPlanRules: z.array(
    z.object({
      min_duration_months: z.number(),
      max_duration_months: z.number().nullable().optional(),
      plan_type: z.string(),
      fixed_instalments: z.number().nullable().optional(),
      is_active: z.union([z.number(), z.boolean()]),
    }),
  ),
});

const discountApprovalsSchema = z.object({
  approvals: z.array(z.record(z.string(), z.unknown())),
});

export type EnquiryOptions = z.infer<typeof enquiryOptionsSchema>;
export type StudentSearchResult = z.infer<typeof studentSearchSchema>;
export type CreateEnquiryResponse = z.infer<typeof createEnquiryResponseSchema>;
export type StaffCourse = z.infer<typeof courseSchema>;
export type EnquiryDetail = z.infer<typeof enquiryDetailSchema>;
export type AdmissionDraft = z.infer<typeof admissionDraftSchema>["draft"];
export type AdmissionConfirmation = z.infer<typeof admissionConfirmationSchema>;
export type StaffStudentProfile = z.infer<typeof studentProfileSchema>;
export type AdmissionConfiguration = z.infer<typeof admissionConfigurationSchema>;
export type AdmissionOptionValue = AdmissionConfiguration["options"][number];
export type PaymentPlanRule = AdmissionConfiguration["paymentPlanRules"][number];
export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  code?: string;
  fieldErrors?: FieldErrors;

  constructor(message: string, fieldErrors?: FieldErrors, code?: string) {
    super(message);
    this.name = "ApiError";
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

export type CreateEnquiryInput = {
  mobile: string;
  fullName: string;
  branchId: string;
  courseInterestId?: string | null;
  courseInterestText?: string | null;
  source: string;
  sourceDetail?: string | null;
  preferredTiming?: string | null;
  preferredJoiningDate?: string | null;
  existingPersonId?: string | null;
};

export async function getPublicConfig() {
  return getJson("/api/public-config", publicConfigSchema);
}

export async function getSession() {
  return getJson("/api/auth/session", sessionSchema);
}

export async function requestOtp(mobile: string, turnstileToken: string) {
  return postJson("/api/auth/request-otp", { mobile, turnstileToken }, requestOtpResponseSchema);
}

export async function resendOtp(challengeId: string) {
  return postJson("/api/auth/resend-otp", { challengeId }, requestOtpResponseSchema);
}

export async function verifyOtp(challengeId: string, otp: string) {
  return postJson("/api/auth/verify-otp", { challengeId, otp }, verifyOtpResponseSchema);
}

export async function selectProfile(personId: string) {
  return postJson("/api/auth/select-profile", { personId }, verifyOtpResponseSchema);
}

export async function logout() {
  return postJson("/api/auth/logout", {}, z.object({ success: z.boolean(), requestId: z.string() }));
}

export async function getReferralDashboard() {
  return getJson("/api/student/referrals", dashboardSchema);
}

export async function getEnquiryOptions() {
  return getJson("/api/staff/enquiry-options", enquiryOptionsSchema);
}

export async function searchStudentByMobile(mobile: string) {
  return getJson(`/api/staff/student-search?mobile=${encodeURIComponent(mobile)}`, studentSearchSchema);
}

export async function createEnquiry(input: CreateEnquiryInput) {
  return postJson("/api/staff/enquiries", input, createEnquiryResponseSchema);
}

export async function getActiveCourses() {
  return getJson("/api/staff/courses/active", courseListSchema);
}

export async function getAdmissionConfiguration() {
  return getJson("/api/staff/admission-configuration", admissionConfigurationSchema);
}

export async function getStaffCourses() {
  return getJson("/api/staff/courses", courseListSchema);
}

export async function createCourse(input: Record<string, unknown>) {
  return postJson("/api/staff/courses", input, z.object({ success: z.literal(true), courseId: z.string() }));
}

export async function updateCourse(courseId: string, input: Record<string, unknown>) {
  return patchJson(`/api/staff/courses/${encodeURIComponent(courseId)}`, input, z.object({ success: z.literal(true), courseId: z.string() }));
}

export async function getEnquiryDetail(enquiryId: string) {
  return getJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}`, enquiryDetailSchema);
}

export async function updateEnquiryStatus(enquiryId: string, status: string) {
  return patchJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}`, { status }, z.object({ success: z.literal(true) }));
}

export async function getAdmissionDraft(enquiryId: string) {
  return getJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}/admission-draft`, admissionDraftSchema);
}

export async function saveAdmissionDraft(enquiryId: string, payload: Record<string, unknown>, currentStep: string) {
  return postJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}/admission-draft`, { payload, currentStep }, admissionDraftSaveSchema);
}

export async function confirmAdmission(enquiryId: string) {
  return postJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}/confirm-admission`, {}, admissionConfirmationSchema);
}

export async function getStaffStudentProfile(studentId: string) {
  return getJson(`/api/staff/students/${encodeURIComponent(studentId)}`, studentProfileSchema);
}

export async function requestDiscountApproval(enquiryId: string) {
  return postJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}/discount-approval`, {}, z.object({ success: z.literal(true), approvalId: z.string(), status: z.string() }));
}

export async function getDiscountApprovals() {
  return getJson("/api/staff/discount-approvals", discountApprovalsSchema);
}

export async function decideDiscountApproval(approvalId: string, decision: "approved" | "rejected") {
  return postJson(`/api/staff/discount-approvals/${encodeURIComponent(approvalId)}/decision`, { decision }, z.object({ success: z.literal(true), approvalId: z.string(), status: z.string() }));
}

async function getJson<T extends z.ZodType>(url: string, schema: T): Promise<z.infer<T>> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const data: unknown = await response.json();
  if (!response.ok) throw apiError(data);
  return schema.parse(data);
}

async function postJson<T extends z.ZodType>(url: string, body: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) throw apiError(data);
  return schema.parse(data);
}

async function patchJson<T extends z.ZodType>(url: string, body: Record<string, unknown>, schema: T): Promise<z.infer<T>> {
  const response = await fetch(url, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) throw apiError(data);
  return schema.parse(data);
}

function apiErrorMessage(data: unknown) {
  if (!data || typeof data !== "object") return "The request could not be completed.";
  const error = (data as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : "The request could not be completed.";
}

function apiError(data: unknown) {
  const error = data && typeof data === "object" ? (data as { error?: { code?: unknown; fieldErrors?: unknown } }).error : undefined;
  const fieldErrors = error?.fieldErrors;
  const code = typeof error?.code === "string" ? error.code : undefined;
  return new ApiError(apiErrorMessage(data), isFieldErrors(fieldErrors) ? fieldErrors : undefined, code);
}

function isFieldErrors(value: unknown): value is FieldErrors {
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.values(value as Record<string, unknown>).every((messages) => Array.isArray(messages) && messages.every((message) => typeof message === "string")),
  );
}
