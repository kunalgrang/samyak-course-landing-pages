import { BrandMark } from "../components/BrandMark";
import { TrustFooter } from "../components/TrustFooter";
import type { NavigationItem } from "../app/navigation";
import type { AppRoute } from "./types";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type AppShellProps = {
  activePath: AppRoute;
  navigation: NavigationItem[];
  children: ReactNode;
  onNavigate: (path: AppRoute) => void;
  onSignOut: () => void;
};

export function AppShell({ activePath, navigation, children, onNavigate, onSignOut }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const usesMobileDrawer = navigation.length > 5;

  useEffect(() => {
    if (!drawerOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);

  function navigateAndClose(path: AppRoute) {
    onNavigate(path);
    setDrawerOpen(false);
  }

  return (
    <div className={`app-layout ${usesMobileDrawer ? "app-layout--staff" : ""}`}>
      <aside className="sidebar" aria-label="Primary">
        <BrandMark />
        <nav className="sidebar__nav">
          {navigation.map((item) => (
            <button
              key={item.path}
              type="button"
              className="nav-button"
              aria-current={activePath === item.path ? "page" : undefined}
              onClick={() => onNavigate(item.path)}
            >
              <span className="nav-button__dot" aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </nav>
        <button type="button" className="sidebar__signout" onClick={onSignOut}>
          Sign out
        </button>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <BrandMark />
          <div className="topbar__actions">
            {usesMobileDrawer ? (
              <button type="button" className="topbar__menu-button" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
                Menu
              </button>
            ) : null}
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </header>
        <main className="page-content">{children}</main>
        <TrustFooter />
      </div>

      {usesMobileDrawer && drawerOpen ? <button type="button" className="mobile-drawer-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} /> : null}

      {usesMobileDrawer ? (
        <aside className={`mobile-drawer ${drawerOpen ? "mobile-drawer--open" : ""}`} aria-label="Primary navigation" aria-hidden={!drawerOpen}>
          <div className="mobile-drawer__header">
            <BrandMark />
            <button type="button" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}>
              Close
            </button>
          </div>
          <nav className="mobile-drawer__nav">
            {navigation.map((item) => (
              <button
                key={item.path}
                type="button"
                aria-current={activePath === item.path ? "page" : undefined}
                onClick={() => navigateAndClose(item.path)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button type="button" className="mobile-drawer__signout" onClick={onSignOut}>
            Sign out
          </button>
        </aside>
      ) : (
        <nav className="bottom-nav" aria-label="Primary" style={{ gridTemplateColumns: `repeat(${navigation.length}, minmax(0, 1fr))` }}>
          {navigation.map((item) => (
            <button
              key={item.path}
              type="button"
              aria-current={activePath === item.path ? "page" : undefined}
              onClick={() => onNavigate(item.path)}
            >
              {item.shortLabel}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
