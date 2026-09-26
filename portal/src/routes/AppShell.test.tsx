import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationItem } from "../app/navigation";

const apiMocks = vi.hoisted(() => ({
  switchOrganisation: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    switchOrganisation: apiMocks.switchOrganisation,
  };
});

import { AppShell } from "./AppShell";
import type { SessionResponse } from "../lib/api";

const navigation: NavigationItem[] = [
  { path: "/app", label: "Home", shortLabel: "Home" },
  { path: "/app/profile", label: "Profile", shortLabel: "Profile" },
];

const staffNavigation: NavigationItem[] = [
  { path: "/app", label: "Home", shortLabel: "Home" },
  { path: "/app/enquiries", label: "Enquiries", shortLabel: "Enq" },
  { path: "/app/students", label: "Students", shortLabel: "Students" },
  { path: "/app/collections", label: "Collections", shortLabel: "Collect" },
  { path: "/app/batches", label: "Batches", shortLabel: "Batches" },
  { path: "/app/courses", label: "Courses", shortLabel: "Courses" },
];

function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return {
    authenticated: true,
    activeOrganisation: {
      organisationId: "org_demo",
      organisationName: "Demo Training Institute",
      organisationKind: "demo",
    },
    activeProfile: {
      personId: "person_owner",
      publicName: "Jim Parsons",
      accessType: "staff",
      roles: ["owner"],
      effectiveRoles: ["owner"],
      hasStudentProfile: false,
    },
    profiles: [],
    homeCentre: {
      centreId: "branch_main",
      centreCode: "MAIN",
      centreName: "Main Centre",
    },
    mobileLastFour: "3210",
    accountRoles: ["owner"],
    organisations: [],
    ...overrides,
  };
}

describe("AppShell organisation switcher", () => {
  let root: Root;
  let container: HTMLElement;
  let window: Window;
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window = new Window();
    assign = vi.fn();
    (window.location as unknown as { assign: typeof assign }).assign = assign;
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).HTMLElement = window.HTMLElement;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    apiMocks.switchOrganisation.mockResolvedValue({ success: true, session: null });
  });

  afterEach(() => {
    root?.unmount();
    window.close();
    vi.clearAllMocks();
  });

  it("shows the switcher only for multiple memberships and reloads after a switch", async () => {
    await act(async () => {
      root.render(
        <AppShell activePath="/app" navigation={navigation} onNavigate={vi.fn()} onSignOut={vi.fn()} organisations={[{ membershipId: "omem_a", organisationId: "org_samyak", organisationName: "Samyak" }]}>
          <p>Portal</p>
        </AppShell>,
      );
    });

    expect(container.querySelector(".topbar__organisation-switcher")).toBeNull();

    await act(async () => {
      root.render(
        <AppShell
          activePath="/app"
          navigation={navigation}
          onNavigate={vi.fn()}
          onSignOut={vi.fn()}
          organisations={[
            { membershipId: "omem_a", organisationId: "org_samyak", organisationName: "Samyak" },
            { membershipId: "omem_b", organisationId: "org_other", organisationName: "Other Institute" },
          ]}
        >
          <p>Portal</p>
        </AppShell>,
      );
    });

    const switcher = container.querySelector(".topbar__organisation-switcher") as HTMLSelectElement | null;
    expect(switcher).toBeTruthy();

    await act(async () => {
      switcher!.value = "omem_b";
      switcher!.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    });

    expect(apiMocks.switchOrganisation).toHaveBeenCalledWith("omem_b");
    expect(assign).toHaveBeenCalledWith("/app");
  });

  it("renders Demo Training Institute tenant identity without the hard-coded authenticated footer", async () => {
    await act(async () => {
      root.render(
        <AppShell
          activePath="/app"
          navigation={staffNavigation}
          onNavigate={vi.fn()}
          onSignOut={vi.fn()}
          organisations={[{ membershipId: "omem_demo", organisationId: "org_demo", organisationName: "Demo Training Institute" }]}
          session={session()}
        >
          <p>Portal</p>
        </AppShell>,
      );
    });

    expect(container.textContent).toContain("Demo Training Institute");
    expect(container.textContent).toContain("Home Centre: Main Centre");
    expect(container.textContent).toContain("Jim Parsons · Owner");
    expect(container.textContent).not.toContain("Samyak Computer Classes - Sion");
    expect(container.textContent).not.toContain("Owned and operated by Shree Services");
  });

  it("renders Samyak identity from the same session model", async () => {
    await act(async () => {
      root.render(
        <AppShell
          activePath="/app"
          navigation={staffNavigation}
          onNavigate={vi.fn()}
          onSignOut={vi.fn()}
          organisations={[{ membershipId: "omem_samyak", organisationId: "org_samyak", organisationName: "Samyak Computer Classes" }]}
          session={session({
            activeOrganisation: {
              organisationId: "org_samyak",
              organisationName: "Samyak Computer Classes",
              organisationKind: "normal",
            },
            homeCentre: {
              centreId: "branch_sion",
              centreCode: "SION",
              centreName: "Sion",
            },
            activeProfile: {
              personId: "person_owner",
              publicName: "Samyak Owner",
              accessType: "staff",
              roles: ["owner"],
              effectiveRoles: ["owner"],
            },
          })}
        >
          <p>Portal</p>
        </AppShell>,
      );
    });

    expect(container.textContent).toContain("Samyak Computer Classes");
    expect(container.textContent).toContain("Home Centre: Sion");
    expect(container.textContent).toContain("Samyak Owner · Owner");
    expect(container.querySelector(".nav-button")).toBeTruthy();
  });

  it("uses membership IDs for multi-organisation switching while showing current identity", async () => {
    await act(async () => {
      root.render(
        <AppShell
          activePath="/app"
          navigation={staffNavigation}
          onNavigate={vi.fn()}
          onSignOut={vi.fn()}
          organisations={[
            { membershipId: "omem_demo", organisationId: "org_demo", organisationName: "Demo Training Institute" },
            { membershipId: "omem_samyak", organisationId: "org_samyak", organisationName: "Samyak Computer Classes" },
          ]}
          session={session()}
        >
          <p>Portal</p>
        </AppShell>,
      );
    });

    expect(container.textContent).toContain("Demo Training Institute");
    const switcher = container.querySelector(".topbar__organisation-switcher") as HTMLSelectElement | null;
    expect(switcher).toBeTruthy();

    await act(async () => {
      switcher!.value = "omem_samyak";
      switcher!.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event);
    });

    expect(apiMocks.switchOrganisation).toHaveBeenCalledWith("omem_samyak");
  });

  it("shows the same tenant context in the mobile drawer", async () => {
    await act(async () => {
      root.render(
        <AppShell
          activePath="/app"
          navigation={staffNavigation}
          onNavigate={vi.fn()}
          onSignOut={vi.fn()}
          organisations={[{ membershipId: "omem_demo", organisationId: "org_demo", organisationName: "Demo Training Institute" }]}
          session={session()}
        >
          <p>Portal</p>
        </AppShell>,
      );
    });

    const menu = container.querySelector(".topbar__menu-button") as HTMLButtonElement | null;
    expect(menu).toBeTruthy();
    await act(async () => {
      menu!.click();
    });

    const drawer = container.querySelector(".mobile-drawer") as HTMLElement | null;
    expect(drawer?.textContent).toContain("Demo Training Institute");
    expect(drawer?.textContent).toContain("Home Centre: Main Centre");
    expect(drawer?.textContent).toContain("Jim Parsons · Owner");
  });

  it("handles missing active person, home Centre and roles without crashing", async () => {
    await act(async () => {
      root.render(
        <AppShell
          activePath="/app"
          navigation={staffNavigation}
          onNavigate={vi.fn()}
          onSignOut={vi.fn()}
          organisations={[{ membershipId: "omem_demo", organisationId: "org_demo", organisationName: "Demo Training Institute" }]}
          session={session({
            activeProfile: null,
            homeCentre: null,
            accountRoles: [],
          })}
        >
          <p>Portal</p>
        </AppShell>,
      );
    });

    expect(container.textContent).toContain("Demo Training Institute");
    expect(container.textContent).not.toContain("Home Centre:");
    expect(container.textContent).not.toContain("· Owner");
  });
});
