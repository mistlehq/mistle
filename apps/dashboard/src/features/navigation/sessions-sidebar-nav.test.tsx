// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionsSidebarNavGroup } from "./sessions-sidebar-nav-model.js";
import { SessionsSidebarNav } from "./sessions-sidebar-nav.js";

const groups: SessionsSidebarNavGroup[] = [
  {
    profileId: "sbp_repo",
    profileName: "Repo Maintainer",
    items: [
      {
        id: "sbi_active",
        label: "Investigate flaky test run",
        to: "/sessions/sbi_active",
        attentionState: "active",
      },
      {
        id: "sbi_idle",
        label: "Review migration draft",
        to: "/sessions/sbi_idle",
        attentionState: "idle",
      },
    ],
  },
  {
    profileId: "sbp_docs",
    profileName: "Docs Maintainer",
    items: [
      {
        id: "sbi_docs",
        label: "Draft onboarding guide",
        to: "/sessions/sbi_docs",
        attentionState: "setup",
      },
    ],
  },
];

function renderSidebarNav(): void {
  render(
    <SidebarProvider>
      <MemoryRouter initialEntries={["/sessions"]}>
        <SessionsSidebarNav groups={groups} />
      </MemoryRouter>
    </SidebarProvider>,
  );
}

afterEach(() => {
  cleanup();
});

function installMatchMediaStub(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe("SessionsSidebarNav", () => {
  installMatchMediaStub();

  it("renders a new session action above the search field", () => {
    renderSidebarNav();

    expect(screen.getByRole("button", { name: "New" })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Search sessions" })).toBeDefined();
  });

  it("allows sandbox profile groups to be collapsed and expanded", () => {
    renderSidebarNav();

    const trigger = screen.getByRole("button", {
      name: "Toggle Repo Maintainer sessions",
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Review migration draft" })).toBeDefined();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Review migration draft" })).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Review migration draft" })).toBeDefined();
  });

  it("expands matching groups while search is active", () => {
    renderSidebarNav();

    const trigger = screen.getByRole("button", {
      name: "Toggle Repo Maintainer sessions",
    });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "migration" },
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Review migration draft" })).toBeDefined();
  });

  it("keeps the new session action visible when there are no groups", () => {
    render(
      <SidebarProvider>
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsSidebarNav groups={[]} />
        </MemoryRouter>
      </SidebarProvider>,
    );

    expect(screen.getByRole("button", { name: "New" })).toBeDefined();
    expect(screen.getByText("No openable sessions yet.")).toBeDefined();
  });
});
