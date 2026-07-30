import { BrandMark } from "../components/BrandMark";
import { TrustFooter } from "../components/TrustFooter";
import type { NavigationItem } from "../app/navigation";
import type { AppRoute } from "./types";
import type { ReactNode } from "react";

type AppShellProps = {
  activePath: AppRoute;
  navigation: NavigationItem[];
  children: ReactNode;
  onNavigate: (path: AppRoute) => void;
  onSignOut: () => void;
};

export function AppShell({ activePath, navigation, children, onNavigate, onSignOut }: AppShellProps) {
  return (
    <div className="app-layout">
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
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </header>
        <main className="page-content">{children}</main>
        <TrustFooter />
      </div>

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
    </div>
  );
}
