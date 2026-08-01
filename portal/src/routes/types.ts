export type AppRoute =
  | "/app"
  | "/app/enquiries"
  | `/app/enquiries/${string}`
  | `/app/enquiries/${string}/admission`
  | `/app/students/${string}`
  | "/app/courses"
  | "/app/discount-approvals"
  | "/app/referrals"
  | "/app/rules"
  | "/app/profile";

export type RoutePath = "/login" | AppRoute;
