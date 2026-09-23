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

const navigation: NavigationItem[] = [
  { path: "/app", label: "Home", shortLabel: "Home" },
  { path: "/app/profile", label: "Profile", shortLabel: "Profile" },
];

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
});
