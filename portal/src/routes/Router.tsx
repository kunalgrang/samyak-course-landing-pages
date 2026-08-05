import { useEffect, useMemo, useState } from "react";
import { studentNavigation, staffNavigation } from "../app/navigation";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../features/auth/AuthContext";
import { LoginPage } from "../features/auth/LoginPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { ReferralsPage } from "../features/referrals/ReferralsPage";
import { EnquiriesPage } from "../features/staff/EnquiriesPage";
import { AdmissionPage } from "../features/staff/AdmissionPage";
import { CourseMasterPage } from "../features/staff/CourseMasterPage";
import { DiscountApprovalsPage } from "../features/staff/DiscountApprovalsPage";
import { EnquiryDetailPage } from "../features/staff/EnquiryDetailPage";
import { StudentProfilePage } from "../features/staff/StudentProfilePage";
import { RulesPage } from "./RulesPage";
import { ShellHomePage } from "./ShellHomePage";
import { AppShell } from "./AppShell";
import type { AppRoute, RoutePath } from "./types";

const appRoutes = new Set<RoutePath>(["/app", "/app/enquiries", "/app/courses", "/app/discount-approvals", "/app/referrals", "/app/rules", "/app/profile"]);
const staffRoles = new Set(["owner", "admin", "system_admin", "counsellor", "admission_admin"]);
const courseAdminRoles = new Set(["owner", "admin", "system_admin"]);
const discountApproverRoles = new Set(["owner"]);

function normalizePath(pathname: string): RoutePath {
  if (pathname === "/login") return "/login";
  if (appRoutes.has(pathname as RoutePath)) return pathname as RoutePath;
  if (/^\/app\/enquiries\/[^/]+\/admission$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/enquiries\/[^/]+$/.test(pathname)) return pathname as RoutePath;
  if (/^\/app\/students\/[^/]+$/.test(pathname)) return pathname as RoutePath;
  return "/login";
}

export function Router() {
  const { isAuthenticated, isLoading, hasSessionError, refreshSession, session, sessionMessage, signOut } = useAuth();
  const [path, setPath] = useState<RoutePath>(() => normalizePath(window.location.pathname));
  const isStaff = Boolean(session?.accountRoles.some((role) => staffRoles.has(role)));
  const isCourseAdmin = Boolean(session?.accountRoles.some((role) => courseAdminRoles.has(role)));
  const isDiscountApprover = canAccessDiscountApprovals(session?.accountRoles || []);
  const navigation = navigationForRoles(session?.accountRoles || [], isStaff);

  useEffect(() => {
    function handlePopState() {
      setPath(normalizePath(window.location.pathname));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!isLoading && !hasSessionError && path.startsWith("/app") && !isAuthenticated) {
      navigate("/login", true);
    }
  }, [hasSessionError, isAuthenticated, isLoading, path]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && (path === "/app/enquiries" || path === "/app/courses" || path === "/app/discount-approvals" || path.startsWith("/app/enquiries/") || path.startsWith("/app/students/")) && !isStaff) {
      navigate("/app", true);
    }
    if (!isLoading && isAuthenticated && path === "/app/courses" && !isCourseAdmin) {
      navigate("/app/enquiries", true);
    }
    if (!isLoading && isAuthenticated && path === "/app/discount-approvals" && !isDiscountApprover) {
      navigate("/app/enquiries", true);
    }
  }, [isAuthenticated, isCourseAdmin, isDiscountApprover, isLoading, isStaff, path]);

  const activeAppPath = useMemo<AppRoute>(
    () => (path.startsWith("/app") ? (path as AppRoute) : "/app"),
    [path],
  );
  const enquiryAdmissionMatch = activeAppPath.match(/^\/app\/enquiries\/([^/]+)\/admission$/);
  const enquiryDetailMatch = activeAppPath.match(/^\/app\/enquiries\/([^/]+)$/);
  const studentProfileMatch = activeAppPath.match(/^\/app\/students\/([^/]+)$/);

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
    return <LoginPage sessionMessage={sessionMessage} onAuthenticated={() => navigate("/app", true)} />;
  }

  return (
    <AppShell activePath={activeAppPath} navigation={navigation} onNavigate={navigate} onSignOut={handleSignOut}>
      {activeAppPath === "/app" ? <ShellHomePage /> : null}
      {activeAppPath === "/app/enquiries" && isStaff ? <EnquiriesPage /> : null}
      {activeAppPath === "/app/courses" && isStaff ? <CourseMasterPage /> : null}
      {activeAppPath === "/app/discount-approvals" && isDiscountApprover ? <DiscountApprovalsPage /> : null}
      {enquiryDetailMatch && isStaff ? <EnquiryDetailPage enquiryId={enquiryDetailMatch[1]} /> : null}
      {enquiryAdmissionMatch && isStaff ? <AdmissionPage enquiryId={enquiryAdmissionMatch[1]} /> : null}
      {studentProfileMatch && isStaff ? <StudentProfilePage studentId={studentProfileMatch[1]} /> : null}
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
    if (item.path === "/app/courses") return isCourseAdmin;
    if (item.path === "/app/discount-approvals") return isDiscountApprover;
    return true;
  });
}

export function canAccessDiscountApprovals(accountRoles: string[]) {
  return accountRoles.some((role) => discountApproverRoles.has(role));
}
