export type AppRoute =
  | "/app"
  | "/app/enquiries"
  | "/app/students"
  | "/app/batches"
  | "/app/education-partners"
  | `/app/enquiries/${string}`
  | `/app/enquiries/${string}/admission`
  | `/app/students/${string}`
  | `/app/batches/${string}`
  | `/app/education-partners/${string}`
  | `/app/education-partners/${string}/preview`
  | `/app/enrolments/${string}/payments`
  | "/app/referral-operations"
  | `/app/referral-operations/${string}`
  | "/app/courses"
  | "/app/discount-approvals"
  | "/app/certificates"
  | "/app/referrals"
  | "/app/rules"
  | "/app/profile";
export type StudentRoute =
  | "/student/dashboard"
  | "/student/learning"
  | "/student/certificates"
  | "/student/referrals"
  | "/student/rules"
  | "/student/profile";
export type PartnerRoute = "/partner/login" | "/partner/dashboard";
export type TrainerRoute =
  | "/trainer/login"
  | "/trainer/dashboard"
  | "/trainer/sessions"
  | `/trainer/batches/${string}`
  | `/trainer/sessions/${string}`;

export type RoutePath = "/login" | "/student/login" | PartnerRoute | TrainerRoute | AppRoute | StudentRoute;
