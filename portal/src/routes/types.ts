export type AppRoute =
  | "/app"
  | "/app/enquiries"
  | `/app/enquiries/${string}`
  | `/app/enquiries/${string}/admission`
  | `/app/students/${string}`
  | `/app/enrolments/${string}/payments`
  | "/app/referral-operations"
  | `/app/referral-operations/${string}`
  | "/app/courses"
  | "/app/discount-approvals"
  | "/app/certificates"
  | "/app/referrals"
  | "/app/rules"
  | "/app/profile";

export type RoutePath = "/login" | AppRoute;
