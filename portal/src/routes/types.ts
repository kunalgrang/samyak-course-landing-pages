export type AppRoute =
  | "/app"
  | "/app/enquiries"
  | "/app/students"
  | "/app/education-partners"
  | `/app/enquiries/${string}`
  | `/app/enquiries/${string}/admission`
  | `/app/students/${string}`
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
export type PartnerRoute = "/partner/login" | "/partner/dashboard";

export type RoutePath = "/login" | PartnerRoute | AppRoute;
