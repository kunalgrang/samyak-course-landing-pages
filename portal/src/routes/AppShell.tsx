import { appNavigation } from "../app/navigation";
import { BrandMark } from "../components/BrandMark";
import type { AppRoute } from "./types";
import type { ReactNode } from "react";

type AppShellProps = {
  activePath: AppRoute;
  children: ReactNode;
  onNavigate: (path: AppRoute) => void;
  onSignOut: () => void;
};

export function AppShell({ activePath, children, onNavigate, onSignOut }: AppShellProps) {
  return (
    <div className="app-layout">
      <aside className="sidebar" aria-label="Primary">
        <BrandMark />
        <nav className="sidebar__nav">
          {appNavigation.map((item) => (
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
      </div>

      <nav className="bottom-nav" aria-label="Primary">
        {appNavigation.map((item) => (
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
