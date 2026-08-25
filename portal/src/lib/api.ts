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
  hasStudentProfile: z.boolean().optional(),
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
  linkStatus: z.object({
    hasActiveLink: z.boolean(),
    lastFour: z.string().nullable(),
    activatedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    canGenerate: z.boolean(),
    canRotate: z.boolean(),
    message: z.string(),
  }),
  summary: z.object({
    totalReferrals: z.number(),
    successfulAdmissions: z.number(),
    cashRewardsEarned: z.number(),
    courseCreditEarned: z.number(),
  }),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }).optional(),
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

const studentHomeSchema = z.object({
  success: z.literal(true),
  identity: z.object({
    personId: z.string(),
    fullName: z.string(),
    publicName: z.string(),
    studentId: z.string(),
    studentStatus: z.string(),
    lifecycleStatus: z.union([z.literal("CURRENT"), z.literal("ALUMNI")]),
    studentSince: z.string(),
    branchName: z.string(),
  }),
  courseHistory: z.array(
    z.object({
      enrolmentId: z.string(),
      enrolmentNumber: z.string(),
      courseId: z.string(),
      courseCode: z.string(),
      courseName: z.string(),
      durationLabel: z.string(),
      admissionDate: z.string(),
      joiningDate: z.string(),
      completionDate: z.string().nullable(),
      status: z.string(),
    }),
  ),
  skillCircle: z.object({
    programmeName: z.string(),
    eligible: z.boolean(),
    hasActiveReferralLink: z.boolean(),
    referralDashboardPath: z.literal("/app/referrals"),
    message: z.string(),
  }),
});

export type StudentHome = z.infer<typeof studentHomeSchema>;

const referralLinkResponseSchema = z.union([
  z.object({
    created: z.literal(true),
    link: z.string(),
    shownOnce: z.literal(true),
    lastFour: z.string(),
    rotated: z.boolean().optional(),
    previousLinkId: z.string().nullable().optional(),
  }),
  z.object({
    created: z.literal(false),
    hasActiveLink: z.literal(true),
    lastFour: z.string().nullable(),
    activatedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    message: z.string(),
  }),
]);

export type ReferralLinkResponse = z.infer<typeof referralLinkResponseSchema>;

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
  category_id: z.string().nullable().optional(),
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

const receiptSummarySchema = z.object({
  finalAgreedFeePaise: z.number(),
  totalReceivedPaise: z.number(),
  overallBalancePaise: z.number(),
  firstInstalmentRequiredPaise: z.number(),
  firstInstalmentReceivedPaise: z.number().optional(),
  firstInstalmentBalancePaise: z.number(),
  classStartEligible: z.boolean(),
  fullyPaid: z.boolean().optional(),
  receiptCount: z.number().optional(),
  instalments: z.array(z.object({
    instalmentNumber: z.number(),
    amountPaise: z.number().optional(),
    requiredPaise: z.number().optional(),
    allocatedReceivedPaise: z.number().optional(),
    balancePaise: z.number().optional(),
    status: z.string().optional(),
    dueDate: z.string().nullable(),
  })),
  tokenReceipt: z.object({
    id: z.string(),
    receiptNumber: z.string(),
    amountPaise: z.number(),
    receivedAt: z.string(),
    paymentMode: z.string(),
    paymentReference: z.string().nullable(),
    notes: z.string().nullable().optional(),
    recordedBy: z.string().nullable().optional(),
    status: z.literal("recorded"),
  }).nullable(),
});

const paymentReceiptSchema = receiptSummarySchema.shape.tokenReceipt.unwrap();

const paymentLedgerSchema = z.object({
  enrolment: z.object({
    id: z.string(),
    enrolmentNumber: z.string(),
    status: z.string(),
    branchName: z.string().nullable(),
    studentId: z.string(),
    studentNumber: z.string(),
    studentName: z.string(),
    courseId: z.string(),
    courseCode: z.string().nullable(),
    courseName: z.string(),
  }),
  financialSummary: receiptSummarySchema,
  receipts: z.array(paymentReceiptSchema),
});

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
  financialSummary: receiptSummarySchema.nullable().optional(),
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
  financialSummary: receiptSummarySchema,
});

const admissionReceiptResponseSchema = z.object({
  success: z.literal(true),
  receipt: paymentReceiptSchema,
  financialSummary: receiptSummarySchema,
});

const admissionPersonLinkResponseSchema = z.object({
  success: z.literal(true),
  enquiryId: z.string(),
  personId: z.string(),
  mode: z.union([z.literal("existing"), z.literal("create")]),
  alreadyLinked: z.boolean().optional(),
});

const enquiryDetailSchema = z.object({
  enquiry: z.record(z.string(), z.unknown()),
  primaryMobile: z.string().nullable(),
  alternateMobile: z.string().nullable().optional(),
  mobileDisplay: z.string().nullable(),
  alternateMobileDisplay: z.string().nullable().optional(),
  personLinkCandidate: z.object({
    displayName: z.string(),
    mobile: z.string().nullable(),
    mobileDisplay: z.string().nullable(),
    enquiryNumber: z.string(),
  }).nullable().optional(),
  previousEnrolments: z.array(z.record(z.string(), z.unknown())),
  activeDraft: z.object({ id: z.string(), status: z.string(), currentStep: z.string() }).nullable(),
});

const crmContactSchema = z.object({
  mobile: z.string().nullable(),
  mobileDisplay: z.string().nullable(),
  whatsappUrl: z.string().nullable(),
  callUrl: z.string().nullable(),
});

const crmItemSchema = z.object({
  enquiry: z.object({
    id: z.string(),
    enquiryNumber: z.string(),
    status: z.string(),
    pipelineStage: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  prospect: z.object({ displayName: z.string() }),
  contact: crmContactSchema,
  prospectContact: crmContactSchema.default({ mobile: null, mobileDisplay: null, whatsappUrl: null, callUrl: null }),
  course: z.object({ id: z.string().nullable(), name: z.string() }),
  source: z.string(),
  sourceDetail: z.string().nullable(),
  referral: z.object({ id: z.string(), status: z.string().nullable(), referrerName: z.string().nullable() }).nullable(),
  pipelineStage: z.string(),
  leadTemperature: z.union([z.literal("hot_urgent"), z.literal("hot"), z.literal("warm"), z.literal("cold")]).nullable(),
  leadTemperatureReason: z.string(),
  assignedCounsellor: z.object({ accountId: z.string(), displayName: z.string() }).nullable().default(null),
  assignedCounsellorLoginAccountId: z.string().nullable(),
  assignedAt: z.string().nullable(),
  lastContactedAt: z.string().nullable(),
  nextFollowUpAt: z.string().nullable(),
  expectedJoiningDate: z.string().nullable(),
  branch: z.object({ id: z.string(), name: z.string().nullable(), code: z.string().nullable() }),
  admission: z.object({
    convertedEnrolmentId: z.string().nullable(),
    convertedAt: z.string().nullable(),
    enrolmentId: z.string().nullable(),
    enrolmentNumber: z.string().nullable(),
    enrolmentStatus: z.string().nullable(),
    studentId: z.string().nullable(),
    studentNumber: z.string().nullable(),
    paymentLedgerAvailable: z.boolean().default(false),
  }),
  closedReason: z.string().nullable(),
  followUpEventCount: z.number(),
});

const crmListSchema = z.object({
  success: z.literal(true),
  filters: z.record(z.string(), z.unknown()),
  pagination: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
  queues: z.array(z.string()),
  items: z.array(crmItemSchema),
});

const crmDetailSchema = z.object({
  success: z.literal(true),
  crm: crmItemSchema,
  timeline: z.array(
    z.object({
      id: z.string(),
      channel: z.string(),
      outcome: z.string(),
      note: z.string().nullable(),
      occurredAt: z.string(),
      nextFollowUpAtSnapshot: z.string().nullable(),
      pipelineStageSnapshot: z.string(),
      actorLoginAccountId: z.string(),
    }),
  ),
  assignees: z.array(z.object({ id: z.string(), label: z.string() })),
});

const studentProfileSchema = z.object({
  student: z.record(z.string(), z.unknown()),
  primaryMobile: z.string().nullable(),
  mobileDisplay: z.string().nullable(),
  canMaintainContact: z.boolean().default(false),
  contactVersion: z.string().nullable().default(null),
  contactHistory: z.array(z.object({
    mobileDisplay: z.string(),
    lastFour: z.string().nullable(),
    isPrimary: z.boolean(),
    status: z.string(),
    changedAt: z.string(),
  })).default([]),
  locality: z.record(z.string(), z.unknown()).nullable(),
  education: z.record(z.string(), z.unknown()).nullable(),
  enrolments: z.array(z.record(z.string(), z.unknown())),
  enquiries: z.array(z.record(z.string(), z.unknown())),
});

const staffStudentDirectoryItemSchema = z.object({
  studentId: z.string(),
  studentNumber: z.string(),
  currentStatus: z.string(),
  studentSince: z.string(),
  displayName: z.string(),
  mobileDisplay: z.string().nullable(),
  latestCourseName: z.string().nullable(),
  latestEnrolmentNumber: z.string().nullable(),
  enrolmentCount: z.number(),
  paymentShortcutEnrolmentId: z.string().nullable(),
});

const staffStudentDirectorySchema = z.object({
  success: z.literal(true),
  filters: z.object({
    status: z.union([z.literal("all"), z.literal("current"), z.literal("alumni")]),
    search: z.string(),
  }),
  pagination: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
  items: z.array(staffStudentDirectoryItemSchema),
});

const sharedMobileMatchSchema = z.object({
  personId: z.string(),
  displayName: z.string(),
  studentId: z.string().nullable(),
  studentNumber: z.string().nullable(),
  status: z.string().nullable(),
});

const studentMobileChangeResponseSchema = z.object({
  success: z.literal(true),
  studentId: z.string(),
  studentNumber: z.string(),
  personId: z.string(),
  idempotent: z.boolean(),
  mobileDisplay: z.string(),
  oldLastFour: z.string().nullable(),
  newLastFour: z.string(),
  sharedMobileMatches: z.array(sharedMobileMatchSchema),
  otpProfiles: z.number(),
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
  configuration: z.object({
    ready: z.boolean(),
    missingCategories: z.array(z.string()),
    paymentPlanRulesConfigured: z.boolean(),
  }),
});

const discountApprovalsSchema = z.object({
  approvals: z.array(z.record(z.string(), z.unknown())),
});

const staffReferralProspectContactSchema = z.object({
  mobile: z.string().nullable(),
  mobileDisplay: z.string().nullable(),
  whatsappUrl: z.string().nullable(),
  callUrl: z.string().nullable(),
});

const staffReferralPayoutSchema = z.object({
  id: z.string(),
  amountPaise: z.number(),
  paymentDate: z.string(),
  paymentMode: z.string(),
  status: z.literal("paid"),
  createdAt: z.string(),
});

const staffReferralRewardSchema = z.object({
  slabId: z.string(),
  rewardModelType: z.string().default("fee_slab"),
  educationPartnerId: z.string().nullable().optional(),
  partnerCommissionBasisPoints: z.number().nullable().optional(),
  gstBasisPointsApplicable: z.number().nullable().optional(),
  preGstFinalFeePaise: z.number().nullable().optional(),
  cashRewardPaise: z.number(),
  courseCreditPaise: z.number(),
  status: z.string(),
  approvedAt: z.string().nullable(),
  payout: staffReferralPayoutSchema.nullable(),
});

const staffReferralListItemSchema = z.object({
  referralId: z.string(),
  shortReference: z.string(),
  branchName: z.string(),
  submittedAt: z.string(),
  validUntil: z.string(),
  validityState: z.string(),
  lastActivityAt: z.string(),
  referrerName: z.string(),
  referrerType: z.string(),
  prospectPublicName: z.string(),
  prospectContact: staffReferralProspectContactSchema,
  courseInterested: z.string(),
  referralStatus: z.string(),
  linkedEnquiry: z.object({ id: z.string(), enquiryNumber: z.string(), status: z.string() }).nullable(),
  linkedEnrolment: z.object({
    id: z.string(),
    enrolmentNumber: z.string(),
    studentNumber: z.string(),
    status: z.string(),
    courseName: z.string(),
    admissionDate: z.string(),
    joiningDate: z.string(),
  }).nullable(),
  admissionStatus: z.string(),
  qualificationState: z.string(),
  rewardStatus: z.string(),
  reward: staffReferralRewardSchema.nullable(),
});

const staffReferralListSchema = z.object({
  success: z.literal(true),
  summary: z.object({
    totalReferrals: z.number(),
    admitted: z.number(),
    awaitingPayment: z.number().default(0),
    qualified: z.number().default(0),
    approved: z.number().default(0),
    paid: z.number().default(0),
    paymentDataUnavailable: z.number(),
    expired: z.number(),
  }),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
    hasMore: z.boolean(),
  }),
  filters: z.record(z.string(), z.unknown()),
  referrals: z.array(staffReferralListItemSchema),
});

const staffReferralDetailSchema = z.object({
  success: z.literal(true),
  referral: staffReferralListItemSchema.extend({
    programmeName: z.string(),
    validityDays: z.number(),
    referrer: z.object({
      externalReferrerId: z.string(),
      publicName: z.string(),
      type: z.string(),
    }),
    matchedPerson: z.object({ personId: z.string(), publicName: z.string() }).nullable(),
    fee: z.object({
      feeAgreementId: z.string(),
      finalAgreedFeePaise: z.number(),
      minimumQualifyingPaymentPaise: z.number(),
      paymentPlanType: z.string(),
      receivedAmountPaise: z.number(),
      receivedAmountAvailable: z.boolean(),
    }).nullable(),
    rewardSlabs: z.array(z.object({
      id: z.string(),
      minFinalFeePaise: z.number(),
      maxFinalFeePaise: z.number().nullable(),
      cashRewardPaise: z.number(),
      courseCreditPaise: z.number(),
      sortOrder: z.number(),
    })),
    timeline: z.array(z.object({
      id: z.string(),
      fromStatus: z.string().nullable(),
      toStatus: z.string(),
      eventType: z.string(),
      actorPublicName: z.string().nullable(),
      internalNote: z.string().nullable(),
      createdAt: z.string(),
    })),
  }),
});

const staffReferralStatusResponseSchema = z.object({
  success: z.literal(true),
  referralId: z.string(),
  status: z.string(),
  idempotent: z.boolean(),
});

const staffReferralRewardResponseSchema = z.object({
  success: z.literal(true),
  referralId: z.string(),
  idempotent: z.boolean(),
  qualificationState: z.string(),
  reward: staffReferralRewardSchema.nullable(),
  payout: staffReferralPayoutSchema.optional(),
});

const educationPartnerSchema = z.object({
  id: z.string(),
  homeBranchId: z.string(),
  branchName: z.string(),
  partnerType: z.string(),
  businessName: z.string(),
  contactPersonName: z.string(),
  maskedMobile: z.string(),
  status: z.string(),
  currentCommissionBasisPoints: z.number(),
  internalNotes: z.string(),
  referrerProfileId: z.string(),
  activeLink: z.object({
    lastFour: z.string(),
    activatedAt: z.string().nullable(),
    publicUrl: z.string().nullable().optional(),
    recoverable: z.boolean().optional(),
  }).nullable(),
  referralCount: z.number(),
  admissionCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const educationPartnerListSchema = z.object({
  success: z.literal(true),
  pagination: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
  partners: z.array(educationPartnerSchema),
});

const educationPartnerDetailSchema = z.object({
  success: z.literal(true),
  partner: educationPartnerSchema,
  commercialTerms: z.object({
    currentGstBasisPoints: z.number(),
  }),
  metrics: z.object({
    totalReferrals: z.number(),
    admissions: z.number(),
    approved: z.number(),
    paid: z.number(),
    totalApprovedCommissionPaise: z.number(),
    totalPaidCommissionPaise: z.number(),
  }),
});

const educationPartnerMutationSchema = z.object({
  success: z.literal(true),
  partnerId: z.string(),
  duplicateWarnings: z.array(z.object({ partnerId: z.string(), businessName: z.string() })),
});

const educationPartnerLinkSchema = z.object({
  success: z.literal(true),
  created: z.boolean(),
  replaced: z.boolean().optional(),
  link: z.string().nullable(),
  shownOnce: z.boolean(),
  lastFour: z.string().nullable(),
  activatedAt: z.string().nullable(),
  previousLinkId: z.string().nullable().optional(),
});

const certificateListItemSchema = z.object({
  id: z.string(),
  certificate_number: z.string(),
  verification_code: z.string(),
  person_id: z.string().optional(),
  student_id_snapshot: z.string(),
  student_name_snapshot: z.string(),
  course_id: z.string().nullable().optional(),
  course_name_snapshot: z.string(),
  course_code_snapshot: z.string().nullable().optional(),
  issue_date: z.string(),
  completion_date_snapshot: z.string().nullable(),
  status: z.string(),
  template_version_snapshot: z.number().optional(),
});

const certificatePaginationSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
});

const certificateListSchema = z.object({
  items: z.array(certificateListItemSchema),
  pagination: certificatePaginationSchema,
});

const eligibleCertificateSchema = z.object({
  enrolment_id: z.string(),
  student_name: z.string(),
  student_number: z.string(),
  course_id: z.string(),
  course_name: z.string(),
  course_code: z.string(),
  duration_label: z.string().nullable(),
  joining_date: z.string(),
  actual_completion_date: z.string().nullable(),
  status: z.string(),
});

const eligibleCertificateListSchema = z.object({
  items: z.array(eligibleCertificateSchema),
  pagination: certificatePaginationSchema,
});

const issueCertificateSchema = z.object({
  success: z.literal(true),
  idempotent: z.boolean(),
  certificate: certificateListItemSchema.extend({
    verification_url: z.string(),
  }).passthrough(),
});

const verifyCertificateSchema = z.object({
  success: z.literal(true),
  verification: z.object({
    status: z.string(),
    issuer: z.string(),
    certificate: z.record(z.string(), z.unknown()).nullable(),
  }),
});

export type EnquiryOptions = z.infer<typeof enquiryOptionsSchema>;
export type StudentSearchResult = z.infer<typeof studentSearchSchema>;
export type CreateEnquiryResponse = z.infer<typeof createEnquiryResponseSchema>;
export type StaffCourse = z.infer<typeof courseSchema>;
export type EnquiryDetail = z.infer<typeof enquiryDetailSchema>;
export type CrmEnquiryItem = z.infer<typeof crmItemSchema>;
export type CrmEnquiryList = z.infer<typeof crmListSchema>;
export type CrmEnquiryDetail = z.infer<typeof crmDetailSchema>;
export type AdmissionDraft = z.infer<typeof admissionDraftSchema>["draft"];
export type AdmissionConfirmation = z.infer<typeof admissionConfirmationSchema>;
export type AdmissionFinancialSummary = z.infer<typeof receiptSummarySchema>;
export type AdmissionReceipt = NonNullable<AdmissionFinancialSummary["tokenReceipt"]>;
export type PaymentLedger = z.infer<typeof paymentLedgerSchema>;
export type PaymentReceipt = z.infer<typeof paymentReceiptSchema>;
export type StaffStudentProfile = z.infer<typeof studentProfileSchema>;
export type StaffStudentDirectory = z.infer<typeof staffStudentDirectorySchema>;
export type StaffStudentDirectoryItem = z.infer<typeof staffStudentDirectoryItemSchema>;
export type StudentMobileChangeResponse = z.infer<typeof studentMobileChangeResponseSchema>;
export type SharedMobileMatch = z.infer<typeof sharedMobileMatchSchema>;
export type StudentSearchPerson = StudentSearchResult["possiblePeople"][number];
export type AdmissionConfiguration = z.infer<typeof admissionConfigurationSchema>;
export type AdmissionOptionValue = AdmissionConfiguration["options"][number];
export type PaymentPlanRule = AdmissionConfiguration["paymentPlanRules"][number];
export type FieldErrors = Record<string, string[]>;
export type CertificateListItem = z.infer<typeof certificateListItemSchema>;
export type EligibleCertificate = z.infer<typeof eligibleCertificateSchema>;
export type CertificateListResponse = z.infer<typeof certificateListSchema>;
export type PublicCertificateVerification = z.infer<typeof verifyCertificateSchema>["verification"];
export type StaffReferralList = z.infer<typeof staffReferralListSchema>;
export type StaffReferralListItem = z.infer<typeof staffReferralListItemSchema>;
export type StaffReferralDetail = z.infer<typeof staffReferralDetailSchema>["referral"];
export type EducationPartnerList = z.infer<typeof educationPartnerListSchema>;
export type EducationPartner = z.infer<typeof educationPartnerSchema>;
export type EducationPartnerDetail = z.infer<typeof educationPartnerDetailSchema>;

export class ApiError extends Error {
  code?: string;
  fieldErrors?: FieldErrors;
  details?: Record<string, unknown>;

  constructor(message: string, fieldErrors?: FieldErrors, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.fieldErrors = fieldErrors;
    this.code = code;
    this.details = details;
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

export async function getStudentHome() {
  return getJson("/api/student/home", studentHomeSchema);
}

export async function generateReferralLink() {
  return postJson("/api/referrals/link", {}, referralLinkResponseSchema);
}

export async function rotateReferralLink() {
  return postJson("/api/referrals/link/rotate", {}, referralLinkResponseSchema);
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

export type CrmEnquiryQuery = {
  queue?: string;
  stage?: string;
  leadTemperature?: string;
  source?: string;
  courseId?: string;
  assignedTo?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export async function getCrmEnquiries(params: CrmEnquiryQuery = {}) {
  return getJson(`/api/staff/enquiries/crm${queryString(params)}`, crmListSchema);
}

export async function getCrmEnquiryDetail(enquiryId: string) {
  return getJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}/crm`, crmDetailSchema);
}

export async function recordEnquiryFollowUp(enquiryId: string, input: Record<string, unknown>) {
  return postJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}/follow-ups`, input, z.object({
    success: z.literal(true),
    enquiryId: z.string(),
    eventId: z.string(),
    leadTemperature: z.string().nullable(),
    leadTemperatureReason: z.string(),
  }));
}

export async function assignEnquiry(enquiryId: string, counsellorLoginAccountId: string | null) {
  return patchJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}/assignment`, { counsellorLoginAccountId }, z.object({
    success: z.literal(true),
    enquiryId: z.string(),
    assignedTo: z.string().nullable(),
  }));
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

export async function recordAdmissionReceipt(enquiryId: string, input: Record<string, unknown>) {
  return postJson(`/api/staff/admissions/${encodeURIComponent(enquiryId)}/receipts`, input, admissionReceiptResponseSchema);
}

export async function getPaymentLedger(enrolmentId: string) {
  return getJson(`/api/staff/enrolments/${encodeURIComponent(enrolmentId)}/payments`, paymentLedgerSchema);
}

export async function recordEnrolmentReceipt(enrolmentId: string, input: Record<string, unknown>) {
  return postJson(`/api/staff/enrolments/${encodeURIComponent(enrolmentId)}/receipts`, input, admissionReceiptResponseSchema);
}

export async function linkAdmissionEnquiryPerson(enquiryId: string, input: { mode: "existing"; personId: string } | { mode: "create"; idempotencyKey: string }) {
  return postJson(`/api/staff/enquiries/${encodeURIComponent(enquiryId)}/person-link`, input, admissionPersonLinkResponseSchema);
}

export async function getStaffStudentProfile(studentId: string) {
  return getJson(`/api/staff/students/${encodeURIComponent(studentId)}`, studentProfileSchema);
}

export type StaffStudentDirectoryQuery = {
  status?: "all" | "current" | "alumni";
  search?: string;
  limit?: number;
  offset?: number;
};

export async function getStaffStudents(params: StaffStudentDirectoryQuery = {}) {
  return getJson(`/api/staff/students${queryString(params)}`, staffStudentDirectorySchema);
}

export async function changeStaffStudentPrimaryMobile(studentId: string, input: { newMobile: string; confirmSharedMobile?: boolean; reason?: string; expectedContactVersion: string }) {
  return patchJson(`/api/staff/students/${encodeURIComponent(studentId)}/contact/mobile`, input, studentMobileChangeResponseSchema);
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

export type StaffReferralQuery = {
  q?: string;
  status?: string;
  rewardStatus?: string;
  referrerType?: string;
  courseId?: string;
  fromDate?: string;
  toDate?: string;
  admission?: string;
  validity?: string;
  limit?: number;
  offset?: number;
};

export async function getStaffReferrals(params: StaffReferralQuery = {}) {
  return getJson(`/api/staff/referrals${queryString(params)}`, staffReferralListSchema);
}

export async function getStaffReferralDetail(referralId: string) {
  return getJson(`/api/staff/referrals/${encodeURIComponent(referralId)}`, staffReferralDetailSchema).then((response) => response.referral);
}

export async function updateStaffReferralStatus(referralId: string, status: string, note?: string) {
  return postJson(`/api/staff/referrals/${encodeURIComponent(referralId)}/status`, { status, note: note || undefined }, staffReferralStatusResponseSchema);
}

export async function approveStaffReferralReward(referralId: string) {
  return postJson(`/api/staff/referrals/${encodeURIComponent(referralId)}/reward/approve`, {}, staffReferralRewardResponseSchema);
}

export async function recordStaffReferralRewardPayout(referralId: string, input: { paymentDate: string; paymentMode: "cash" | "upi" | "bank_transfer" | "cheque" | "other"; paymentReference?: string; notes?: string; idempotencyKey: string }) {
  return postJson(`/api/staff/referrals/${encodeURIComponent(referralId)}/reward/payout`, input, staffReferralRewardResponseSchema);
}

export type EducationPartnerInput = {
  partnerType: string;
  businessName: string;
  contactPersonName: string;
  mobile?: string;
  email?: string;
  homeBranchId: string;
  commissionPercent: string;
  status: "active" | "inactive";
  internalNotes?: string;
};

export async function getEducationPartners(params: { q?: string; status?: string; limit?: number; offset?: number } = {}) {
  return getJson(`/api/staff/education-partners${queryString(params)}`, educationPartnerListSchema);
}

export async function getEducationPartner(partnerId: string) {
  return getJson(`/api/staff/education-partners/${encodeURIComponent(partnerId)}`, educationPartnerDetailSchema);
}

export async function createEducationPartner(input: EducationPartnerInput) {
  return postJson("/api/staff/education-partners", input, educationPartnerMutationSchema);
}

export async function updateEducationPartner(partnerId: string, input: EducationPartnerInput) {
  return patchJson(`/api/staff/education-partners/${encodeURIComponent(partnerId)}`, input, educationPartnerMutationSchema);
}

export async function issueEducationPartnerReferralLink(partnerId: string) {
  return postJson(`/api/staff/education-partners/${encodeURIComponent(partnerId)}/referral-link`, {}, educationPartnerLinkSchema);
}

export async function replaceEducationPartnerReferralLink(partnerId: string) {
  return postJson(`/api/staff/education-partners/${encodeURIComponent(partnerId)}/referral-link/replace`, {}, educationPartnerLinkSchema);
}

export type CertificateQuery = {
  q?: string;
  status?: string;
  courseId?: string;
  limit?: number;
  offset?: number;
};

export async function getEligibleCertificates(params: CertificateQuery = {}) {
  return getJson(`/api/staff/certificates/eligible${queryString(params)}`, eligibleCertificateListSchema);
}

export async function getStaffCertificates(params: CertificateQuery = {}) {
  return getJson(`/api/staff/certificates${queryString(params)}`, certificateListSchema);
}

export async function issueStaffCertificate(enrolmentId: string, issueDate: string) {
  return postJson("/api/staff/certificates/issue", { enrolmentId, issueDate }, issueCertificateSchema);
}

export async function revokeStaffCertificate(certificateId: string, reason: string) {
  return postJson(`/api/staff/certificates/${encodeURIComponent(certificateId)}/revoke`, { reason }, z.object({ success: z.literal(true) }));
}

export async function getStudentCertificates(params: CertificateQuery = {}) {
  return getJson(`/api/student/certificates${queryString(params)}`, certificateListSchema);
}

export async function verifyPublicCertificate(code: string) {
  return getJson(`/api/public/certificates/verify/${encodeURIComponent(code)}`, verifyCertificateSchema);
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
  const error = data && typeof data === "object" ? (data as { error?: { code?: unknown; fieldErrors?: unknown; details?: unknown } }).error : undefined;
  const fieldErrors = error?.fieldErrors;
  const code = typeof error?.code === "string" ? error.code : undefined;
  const details = error?.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : undefined;
  return new ApiError(apiErrorMessage(data), isFieldErrors(fieldErrors) ? fieldErrors : undefined, code, details);
}

function isFieldErrors(value: unknown): value is FieldErrors {
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.values(value as Record<string, unknown>).every((messages) => Array.isArray(messages) && messages.every((message) => typeof message === "string")),
  );
}

function queryString(params: Record<string, string | number | undefined>) {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.set(key, String(value));
  }
  const text = url.toString();
  return text ? `?${text}` : "";
}
