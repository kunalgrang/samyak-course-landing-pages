import { useEffect, useMemo, useState } from "react";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../features/auth/AuthContext";
import { LoginPage } from "../features/auth/LoginPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { ReferralsPage } from "../features/referrals/ReferralsPage";
import { RulesPage } from "./RulesPage";
import { ShellHomePage } from "./ShellHomePage";
import { AppShell } from "./AppShell";
import type { AppRoute, RoutePath } from "./types";

const appRoutes = new Set<RoutePath>(["/app", "/app/referrals", "/app/rules", "/app/profile"]);

function normalizePath(pathname: string): RoutePath {
  if (pathname === "/login") return "/login";
  if (appRoutes.has(pathname as RoutePath)) return pathname as RoutePath;
  return "/login";
}

export function Router() {
  const { isAuthenticated, isLoading, hasSessionError, refreshSession, sessionMessage, signOut } = useAuth();
  const [path, setPath] = useState<RoutePath>(() => normalizePath(window.location.pathname));

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

  const activeAppPath = useMemo<AppRoute>(
    () => (path.startsWith("/app") ? (path as AppRoute) : "/app"),
    [path],
  );

  function navigate(nextPath: RoutePath, replace = false) {
    const next = normalizePath(nextPath);
    if (replace) {
      window.history.replaceState({}, "", next);
    } else {
      window.history.pushState({}, "", next);
    }
    setPath(next);
  }

  async function handleSignOut() {
    await signOut();
    navigate("/login", true);
  }

  if (isLoading) {
    return (
      <main className="login-page">
        <section className="login-shell">
          <LoadingState label="Checking session" />
        </section>
      </main>
    );
  }

  if (hasSessionError && !isAuthenticated) {
    return (
      <main className="login-page">
        <section className="login-shell">
          <ErrorState title="Could not check session" message="Please check your connection and try again." />
          <button type="button" onClick={() => void refreshSession()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (path === "/login" || !isAuthenticated) {
    return <LoginPage sessionMessage={sessionMessage} onAuthenticated={() => navigate("/app", true)} />;
  }

  return (
    <AppShell activePath={activeAppPath} onNavigate={navigate} onSignOut={handleSignOut}>
      {activeAppPath === "/app" ? <ShellHomePage /> : null}
      {activeAppPath === "/app/referrals" ? <ReferralsPage /> : null}
      {activeAppPath === "/app/rules" ? <RulesPage /> : null}
      {activeAppPath === "/app/profile" ? <ProfilePage /> : null}
    </AppShell>
  );
}
