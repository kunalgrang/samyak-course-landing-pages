import { BrandMark } from "../components/BrandMark";
import { TrustFooter } from "../components/TrustFooter";
import { switchOrganisation } from "../lib/api";
import type { OrganisationChoice } from "../lib/api";
import type { NavigationItem } from "../app/navigation";
import type { RoutePath } from "./types";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type AppShellProps = {
  activePath: RoutePath;
  navigation: NavigationItem[];
  children: ReactNode;
  onNavigate: (path: RoutePath) => void;
  onSignOut: () => void;
  organisations?: OrganisationChoice[];
};

export function AppShell({ activePath, navigation, children, onNavigate, onSignOut, organisations = [] }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switchingMembershipId, setSwitchingMembershipId] = useState("");
  const usesMobileDrawer = navigation.some((item) => item.path.startsWith("/app/")) && navigation.length > 5;
  const canSwitchOrganisations = organisations.length > 1;

  useEffect(() => {
    if (!drawerOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);

  function navigateAndClose(path: RoutePath) {
    onNavigate(path);
    setDrawerOpen(false);
  }

  async function handleOrganisationSwitch(membershipId: string) {
    if (!membershipId) return;
    setSwitchingMembershipId(membershipId);
    const result = await switchOrganisation(membershipId);
    if (result.success) window.location.assign("/app");
    else setSwitchingMembershipId("");
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
        {canSwitchOrganisations ? (
          <label className="organisation-switcher">
            <span>Organisation</span>
            <select value="" disabled={Boolean(switchingMembershipId)} onChange={(event) => void handleOrganisationSwitch(event.target.value)}>
              <option value="">Switch</option>
              {organisations.map((organisation) => (
                <option key={organisation.membershipId} value={organisation.membershipId}>{organisation.organisationName}</option>
              ))}
            </select>
          </label>
        ) : null}
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
            {canSwitchOrganisations ? (
              <select className="topbar__organisation-switcher" aria-label="Switch organisation" value="" disabled={Boolean(switchingMembershipId)} onChange={(event) => void handleOrganisationSwitch(event.target.value)}>
                <option value="">Switch organisation</option>
                {organisations.map((organisation) => (
                  <option key={organisation.membershipId} value={organisation.membershipId}>{organisation.organisationName}</option>
                ))}
              </select>
            ) : null}
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
