import { useEffect, useMemo, useState } from "react";
import { studentNavigation, staffNavigation } from "../app/navigation";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../features/auth/AuthContext";
import { LoginPage } from "../features/auth/LoginPage";
import { PartnerLoginPage } from "../features/partner/PartnerLoginPage";
import { PartnerPortalPage } from "../features/partner/PartnerPortalPage";
import { TrainerLoginPage } from "../features/trainer/TrainerLoginPage";
import { TrainerPortalPage } from "../features/trainer/TrainerPortalPage";
import { StudentLearningPage } from "../features/student/StudentLearningPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { ReferralsPage } from "../features/referrals/ReferralsPage";
import { ReferralOperationsDetailPage, ReferralOperationsPage } from "../features/staff/ReferralOperationsPage";
import { CertificatesPage } from "../features/certificates/CertificatesPage";
import { EnquiriesPage } from "../features/staff/EnquiriesPage";
import { StudentsPage } from "../features/staff/StudentsPage";
import { EducationPartnerDetailPage, EducationPartnersPage } from "../features/staff/EducationPartnersPage";
import { AdmissionPage } from "../features/staff/AdmissionPage";
import { CourseMasterPage } from "../features/staff/CourseMasterPage";
import { BatchManagementPage } from "../features/staff/BatchManagementPage";
import { DiscountApprovalsPage } from "../features/staff/DiscountApprovalsPage";
import { EnquiryDetailPage } from "../features/staff/EnquiryDetailPage";
import { StudentProfilePage } from "../features/staff/StudentProfilePage";
import { PaymentsLedgerPage } from "../features/staff/PaymentsLedgerPage";
import { RulesPage } from "./RulesPage";
import { ShellHomePage } from "./ShellHomePage";
import { AppShell } from "./AppShell";
import type { AppRoute, RoutePath, StudentRoute } from "./types";

const appRoutes = new Set<RoutePath>(["/app", "/app/enquiries", "/app/students", "/app/batches", "/app/education-partners", "/app/referral-operations", "/app/courses", "/app/discount-approvals", "/app/certificates", "/app/referrals", "/app/rules", "/app/profile"]);
const studentRoutes = new Set<RoutePath>(["/student/dashboard", "/student/learning", "/student/certificates", "/student/referrals", "/student/rules", "/student/profile"]);
const staffBlockedSelfServiceRoutes = new Set<RoutePath>(["/app", "/app/referrals", "/app/rules", "/app/profile"]);
const staffRoles = new Set(["owner", "admin", "system_admin", "counsellor", "admission_admin"]);
const courseAdminRoles = new Set(["owner", "admin", "system_admin"]);
const discountApproverRoles = new Set(["owner"]);

type RedirectState = {
  path: RoutePath;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasSessionError: boolean;
  isStaff: boolean;
  canAccessEnquiries: boolean;
  canAccessStudents: boolean;
  isCourseAdmin: boolean;
  isDiscountApprover: boolean;
};

export function normalizePath(pathname: string): RoutePath {
  if (pathname === "/login" || pathname === "/student/login") return pathname;
  if (pathname === "/partner/login" || pathname === "/partner/dashboard") return pathname;
  if (pathname === "/trainer/login" || pathname === "/trainer/dashboard" || pathname === "/trainer/sessions") return pathname;
  if (studentRoutes.has(pathname as RoutePath)) return pathname as RoutePath;
  if (appRoutes.has(pathname as RoutePath)) return pathname as RoutePath;
  if (/^\/trainer\/batches\/[^/]+$/.test(pathname)) return pathname as RoutePath;
  if (/^\/trainer\/sessions\/[^/]+$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/enquiries\/[^/]+\/admission$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/enquiries\/[^/]+$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/referral-operations\/[^/]+$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/students\/[^/]+$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/batches\/[^/]+$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/education-partners\/[^/]+\/preview$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/education-partners\/[^/]+$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/enrolments\/[^/]+\/payments$/.test(pathname)) return pathname as RoutePath;
  return "/login";
}

export function Router() {
  const { isAuthenticated, isLoading, hasSessionError, refreshSession, session, sessionMessage, signOut } = useAuth();
  const [path, setPath] = useState<RoutePath>(() => normalizePath(window.location.pathname));
  const isStaff = Boolean(session?.accountRoles.some((role) => staffRoles.has(role)));
  const canAccessEnquiries = canViewEnquiries(session?.accountRoles || []);
  const canAccessStudents = canViewStudents(session?.accountRoles || []);
  const isCourseAdmin = Boolean(session?.accountRoles.some((role) => courseAdminRoles.has(role)));
  const isDiscountApprover = canAccessDiscountApprovals(session?.accountRoles || []);
  const navigation = navigationForRoles(session?.accountRoles || [], isStaff);
  const isStudentPath = path === "/student/login" || path.startsWith("/student/");

  useEffect(() => {
    function handlePopState() {
      setPath(normalizePath(window.location.pathname));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const redirect = redirectForRouteState({
      path,
      isAuthenticated,
      isLoading,
      hasSessionError,
      isStaff,
      canAccessEnquiries,
      canAccessStudents,
      isCourseAdmin,
      isDiscountApprover,
    });
    if (redirect && redirect !== path) navigate(redirect, true);
  }, [canAccessEnquiries, canAccessStudents, hasSessionError, isAuthenticated, isCourseAdmin, isDiscountApprover, isLoading, isStaff, path]);

  const activeAppPath = useMemo<AppRoute>(
    () => (path.startsWith("/app") ? (path as AppRoute) : "/app"),
    [path],
  );
  const activeStudentPath = useMemo<StudentRoute>(
    () => (path.startsWith("/student/") && path !== "/student/login" ? (path as StudentRoute) : "/student/dashboard"),
    [path],
  );
  const enquiryAdmissionMatch = activeAppPath.match(/^\/app\/enquiries\/([^/]+)\/admission$/);
  const enquiryDetailMatch = activeAppPath.match(/^\/app\/enquiries\/([^/]+)$/);
  const referralOperationsMatch = activeAppPath.match(/^\/app\/referral-operations\/([^/]+)$/);
  const studentProfileMatch = activeAppPath.match(/^\/app\/students\/([^/]+)$/);
  const batchMatch = activeAppPath.match(/^\/app\/batches\/([^/]+)$/);
  const educationPartnerPreviewMatch = activeAppPath.match(/^\/app\/education-partners\/([^/]+)\/preview$/);
  const educationPartnerMatch = activeAppPath.match(/^\/app\/education-partners\/([^/]+)$/);
  const paymentsMatch = activeAppPath.match(/^\/app\/enrolments\/([^/]+)\/payments$/);

  function navigate(nextPath: RoutePath, replace = false) {
    const next = normalizePath(nextPath);
    if (replace) window.history.replaceState({}, "", next);
    else window.history.pushState({}, "", next);
    setPath(next);
  }

  async function handleSignOut() {
    await signOut();
    navigate("/login", true);
  }

  async function handleStudentSignOut() {
    await signOut();
    navigate("/student/login", true);
  }

  if (path === "/trainer/login") {
    return <TrainerLoginPage sessionMessage={sessionMessage} onAuthenticated={() => navigate("/trainer/dashboard", true)} />;
  }

  if (path.startsWith("/trainer/")) {
    return <TrainerPortalPage path={path} onNavigate={navigate} />;
  }

  if (isLoading) {
    return (
      <main className="login-page">
        <section className="login-shell"><LoadingState label="Checking session" /></section>
      </main>
    );
  }

  if (hasSessionError && !isAuthenticated) {
    return (
      <main className="login-page">
        <section className="login-shell">
          <ErrorState title="Could not check session" message="Please check your connection and try again." />
          <button type="button" onClick={() => void refreshSession()}>Retry</button>
        </section>
      </main>
    );
  }

  if (path === "/login" || !isAuthenticated) {
    if (path === "/student/login" || isStudentPath) {
      return <LoginPage sessionMessage={sessionMessage} onAuthenticated={() => navigate("/student/dashboard", true)} />;
    }
    if (path === "/partner/login") {
      return <PartnerLoginPage sessionMessage={sessionMessage} onAuthenticated={() => navigate("/partner/dashboard", true)} />;
    }
    if (path === "/partner/dashboard") {
      return <PartnerPortalPage mode="self" onNavigate={navigate} />;
    }
    return <LoginPage sessionMessage={sessionMessage} onAuthenticated={() => navigate("/app", true)} />;
  }

  if (path === "/partner/login") {
    return <PartnerLoginPage sessionMessage={sessionMessage} onAuthenticated={() => navigate("/partner/dashboard", true)} />;
  }
  if (path === "/partner/dashboard") {
    return <PartnerPortalPage mode="self" onNavigate={navigate} />;
  }

  if (path.startsWith("/student/") && !isStaff) {
    return (
      <AppShell activePath={activeStudentPath} navigation={studentNavigation} onNavigate={navigate} onSignOut={handleStudentSignOut}>
        {activeStudentPath === "/student/dashboard" ? <ShellHomePage referralPath="/student/referrals" profilePath="/student/profile" /> : null}
        {activeStudentPath === "/student/learning" ? <StudentLearningPage /> : null}
        {activeStudentPath === "/student/certificates" ? <CertificatesPage /> : null}
        {activeStudentPath === "/student/referrals" ? <ReferralsPage rulesPath="/student/rules" /> : null}
        {activeStudentPath === "/student/rules" ? <RulesPage /> : null}
        {activeStudentPath === "/student/profile" ? <ProfilePage /> : null}
      </AppShell>
    );
  }

  return (
    <AppShell activePath={activeAppPath} navigation={navigation} onNavigate={navigate} onSignOut={handleSignOut}>
      {activeAppPath === "/app" ? <ShellHomePage /> : null}
      {activeAppPath === "/app/enquiries" && canAccessEnquiries ? <EnquiriesPage /> : null}
      {activeAppPath === "/app/students" && canAccessStudents ? <StudentsPage /> : null}
      {activeAppPath === "/app/batches" && isStaff ? <BatchManagementPage /> : null}
      {activeAppPath === "/app/education-partners" && isStaff ? <EducationPartnersPage onNavigate={navigate} isOwner={isDiscountApprover} /> : null}
      {activeAppPath === "/app/referral-operations" && isStaff ? <ReferralOperationsPage onNavigate={navigate} /> : null}
      {activeAppPath === "/app/courses" && isStaff ? <CourseMasterPage /> : null}
      {activeAppPath === "/app/discount-approvals" && isDiscountApprover ? <DiscountApprovalsPage /> : null}
      {activeAppPath === "/app/certificates" ? <CertificatesPage /> : null}
      {enquiryDetailMatch && isStaff ? <EnquiryDetailPage enquiryId={enquiryDetailMatch[1]} /> : null}
      {enquiryAdmissionMatch && isStaff ? <AdmissionPage enquiryId={enquiryAdmissionMatch[1]} /> : null}
      {referralOperationsMatch && isStaff ? <ReferralOperationsDetailPage referralId={referralOperationsMatch[1]} onNavigate={navigate} isOwner={isDiscountApprover} /> : null}
      {studentProfileMatch && isStaff ? <StudentProfilePage studentId={studentProfileMatch[1]} /> : null}
      {batchMatch && isStaff ? <BatchManagementPage batchId={batchMatch[1]} /> : null}
      {educationPartnerPreviewMatch && isDiscountApprover ? <PartnerPortalPage mode="preview" partnerId={educationPartnerPreviewMatch[1]} onNavigate={navigate} /> : null}
      {educationPartnerMatch && isStaff ? <EducationPartnerDetailPage partnerId={educationPartnerMatch[1]} onNavigate={navigate} isOwner={isDiscountApprover} /> : null}
      {paymentsMatch && isStaff ? <PaymentsLedgerPage enrolmentId={paymentsMatch[1]} /> : null}
      {activeAppPath === "/app/referrals" ? <ReferralsPage /> : null}
      {activeAppPath === "/app/rules" ? <RulesPage /> : null}
      {activeAppPath === "/app/profile" ? <ProfilePage /> : null}
    </AppShell>
  );
}

export function navigationForRoles(accountRoles: string[], isStaff = accountRoles.some((role) => staffRoles.has(role))) {
  if (!isStaff) return studentNavigation;
  const isCourseAdmin = accountRoles.some((role) => courseAdminRoles.has(role));
  const isDiscountApprover = canAccessDiscountApprovals(accountRoles);
  return staffNavigation.filter((item) => {
    if (item.path === "/app/enquiries") return canViewEnquiries(accountRoles);
    if (item.path === "/app/students") return canViewStudents(accountRoles);
    if (item.path === "/app/courses") return isCourseAdmin;
    if (item.path === "/app/discount-approvals") return isDiscountApprover;
    return true;
  });
}

export function redirectForRouteState({
  path,
  isAuthenticated,
  isLoading,
  hasSessionError,
  isStaff,
  canAccessEnquiries,
  canAccessStudents,
  isCourseAdmin,
  isDiscountApprover,
}: RedirectState): RoutePath | null {
  if (isLoading) return null;
  if (!hasSessionError && !isAuthenticated && (path.startsWith("/app") || path.startsWith("/student/"))) {
    return path.startsWith("/student/") ? "/student/login" : "/login";
  }
  if (!isAuthenticated) return null;
  if (path === "/login" || path === "/student/login") return isStaff ? "/app/enquiries" : "/student/dashboard";
  if (isStaff && path.startsWith("/student/")) return "/app/enquiries";
  if (isStaff && staffBlockedSelfServiceRoutes.has(path)) return "/app/enquiries";

  const studentRoute = legacyStudentRouteFor(path);
  if (!isStaff && studentRoute) return studentRoute;
  if ((path === "/app/enquiries" || path.startsWith("/app/enquiries/")) && !canAccessEnquiries) return isStaff ? "/app" : "/student/dashboard";
  if ((path === "/app/students" || path.startsWith("/app/students/")) && !canAccessStudents) return isStaff ? "/app" : "/student/dashboard";
  if ((path === "/app/education-partners" || path === "/app/referral-operations" || path === "/app/batches" || path === "/app/courses" || path === "/app/discount-approvals" || path.startsWith("/app/education-partners/") || path.startsWith("/app/referral-operations/") || path.startsWith("/app/batches/") || path.startsWith("/app/enrolments/")) && !isStaff) {
    return "/student/dashboard";
  }
  if (/^\/app\/education-partners\/[^/]+\/preview$/.test(path) && !isDiscountApprover) return isStaff ? "/app" : "/student/dashboard";
  if (path === "/app/courses" && !isCourseAdmin) return "/app/enquiries";
  if (path === "/app/discount-approvals" && !isDiscountApprover) return "/app/enquiries";
  return null;
}

function legacyStudentRouteFor(path: RoutePath): StudentRoute | null {
  if (path === "/app") return "/student/dashboard";
  if (path === "/app/certificates") return "/student/certificates";
  if (path === "/app/referrals") return "/student/referrals";
  if (path === "/app/rules") return "/student/rules";
  if (path === "/app/profile") return "/student/profile";
  return null;
}

export function canViewEnquiries(accountRoles: string[]) {
  return accountRoles.some((role) => staffRoles.has(role));
}

export function canViewStudents(accountRoles: string[]) {
  return accountRoles.some((role) => staffRoles.has(role));
}

export function canAccessDiscountApprovals(accountRoles: string[]) {
  return accountRoles.some((role) => discountApproverRoles.has(role));
}
