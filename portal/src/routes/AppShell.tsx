import { BrandMark } from "../components/BrandMark";
import { switchOrganisation } from "../lib/api";
import type { OrganisationChoice, SessionResponse } from "../lib/api";
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
  session?: SessionResponse | null;
};

const staffPersonaRoleExclusions = new Set(["student", "alumni"]);

export function AppShell({ activePath, navigation, children, onNavigate, onSignOut, organisations = [], session = null }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switchingMembershipId, setSwitchingMembershipId] = useState("");
  const usesMobileDrawer = navigation.some((item) => item.path.startsWith("/app/")) && navigation.length > 5;
  const canSwitchOrganisations = organisations.length > 1;
  const organisationName = session?.activeOrganisation?.organisationName || "Samyak";
  const authenticatedBrandSubtitle = session?.activeOrganisation ? "Education Portal" : "Student Portal";

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
        <BrandMark name={organisationName} subtitle={authenticatedBrandSubtitle} />
        {usesMobileDrawer ? (
          <TenantIdentity session={session} />
        ) : null}
        {canSwitchOrganisations ? (
          <OrganisationSwitcher
            className="organisation-switcher"
            organisations={organisations}
            switchingMembershipId={switchingMembershipId}
            onSwitch={handleOrganisationSwitch}
          />
        ) : null}
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
          <BrandMark name={organisationName} subtitle={authenticatedBrandSubtitle} />
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
              <OrganisationSwitcher
                className="topbar__organisation-switcher"
                organisations={organisations}
                switchingMembershipId={switchingMembershipId}
                onSwitch={handleOrganisationSwitch}
                compact
              />
            ) : null}
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>

      {usesMobileDrawer && drawerOpen ? <button type="button" className="mobile-drawer-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} /> : null}

      {usesMobileDrawer ? (
        <aside className={`mobile-drawer ${drawerOpen ? "mobile-drawer--open" : ""}`} aria-label="Primary navigation" aria-hidden={!drawerOpen}>
          <div className="mobile-drawer__header">
            <BrandMark name={organisationName} subtitle={authenticatedBrandSubtitle} />
            <button type="button" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}>
              Close
            </button>
          </div>
          <TenantIdentity session={session} />
          {canSwitchOrganisations ? (
            <OrganisationSwitcher
              className="organisation-switcher"
              organisations={organisations}
              switchingMembershipId={switchingMembershipId}
              onSwitch={handleOrganisationSwitch}
            />
          ) : null}
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

function TenantIdentity({ session }: { session: SessionResponse | null }) {
  const organisationName = session?.activeOrganisation?.organisationName;
  if (!organisationName) return null;
  const homeCentre = session.homeCentre?.centreName;
  const personName = session.activeProfile?.publicName;
  const roles = roleLabels(session.activeProfile?.effectiveRoles?.length ? session.activeProfile.effectiveRoles : session.accountRoles);
  const userLine = [personName, ...roles].filter(Boolean).join(" · ");

  return (
    <section className="tenant-identity" aria-label="Current organisation">
      <p className="tenant-identity__organisation">{organisationName}</p>
      {homeCentre ? <p className="tenant-identity__meta">Home Centre: {homeCentre}</p> : null}
      {userLine ? <p className="tenant-identity__user">{userLine}</p> : null}
    </section>
  );
}

function OrganisationSwitcher({
  className,
  compact = false,
  organisations,
  switchingMembershipId,
  onSwitch,
}: {
  className: string;
  compact?: boolean;
  organisations: OrganisationChoice[];
  switchingMembershipId: string;
  onSwitch: (membershipId: string) => Promise<void>;
}) {
  if (compact) {
    return (
      <select
        className={className}
        aria-label="Switch organisation"
        value=""
        disabled={Boolean(switchingMembershipId)}
        onChange={(event) => void onSwitch(event.target.value)}
      >
        <option value="">Switch organisation</option>
        {organisations.map((organisation) => (
          <option key={organisation.membershipId} value={organisation.membershipId}>{organisation.organisationName}</option>
        ))}
      </select>
    );
  }

  const select = (
    <select
      aria-label="Switch organisation"
      value=""
      disabled={Boolean(switchingMembershipId)}
      onChange={(event) => void onSwitch(event.target.value)}
    >
      <option value="">{compact ? "Switch organisation" : "Switch"}</option>
      {organisations.map((organisation) => (
        <option key={organisation.membershipId} value={organisation.membershipId}>{organisation.organisationName}</option>
      ))}
    </select>
  );
  return (
    <label className={className}>
      <span>Organisation</span>
      {select}
    </label>
  );
}

function roleLabels(roles: string[] = []) {
  const labels: string[] = [];
  for (const role of roles) {
    if (staffPersonaRoleExclusions.has(role)) continue;
    const label = role
      .split("_")
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ");
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}
