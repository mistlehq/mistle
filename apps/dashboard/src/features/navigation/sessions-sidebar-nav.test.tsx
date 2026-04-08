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
        metadataLabel: "Working",
        to: "/sessions/sbi_active",
        showActivityIndicator: true,
      },
      {
        id: "sbi_idle",
        label: "Review migration draft",
        metadataLabel: "Idle",
        to: "/sessions/sbi_idle",
        showActivityIndicator: false,
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
        metadataLabel: "1h",
        to: "/sessions/sbi_docs",
        showActivityIndicator: false,
      },
    ],
  },
];

function renderSidebarNav(input?: { groups?: readonly SessionsSidebarNavGroup[] }): void {
  render(
    <SidebarProvider>
      <MemoryRouter initialEntries={["/sessions"]}>
        <SessionsSidebarNav groups={input?.groups ?? groups} />
      </MemoryRouter>
    </SidebarProvider>,
  );
}

function getRepoMaintainerTrigger(): HTMLElement {
  return screen.getByRole("button", {
    name: "Toggle Repo Maintainer sessions",
  });
}

function getSearchInput(): HTMLElement {
  return screen.getByRole("textbox", { name: "Search sessions" });
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

  it("renders a new session link above the search field", () => {
    renderSidebarNav();

    expect(screen.getByRole("link", { name: "Create a new session" }).getAttribute("href")).toBe(
      "/sessions/new",
    );
    expect(screen.getByRole("textbox", { name: "Search sessions" })).toBeDefined();
  });

  it("allows sandbox profile groups to be collapsed and expanded", () => {
    renderSidebarNav();

    const trigger = getRepoMaintainerTrigger();

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /Review migration draft/ })).toBeDefined();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /Review migration draft/ })).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /Review migration draft/ })).toBeDefined();
  });

  it("expands matching groups while search is active", () => {
    renderSidebarNav();

    const trigger = getRepoMaintainerTrigger();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.change(getSearchInput(), {
      target: { value: "migration" },
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: /Review migration draft/ })).toBeDefined();
  });

  it("shows working for active running sessions and idle for inactive running sessions", () => {
    renderSidebarNav();

    expect(screen.getByText("Working")).toBeDefined();
    expect(screen.getAllByText("Working")).toHaveLength(1);
    expect(screen.getByText("Idle")).toBeDefined();
  });

  it("keeps the new session action visible when there are no groups", () => {
    renderSidebarNav({
      groups: [],
    });

    expect(screen.getByRole("link", { name: "Create a new session" })).toBeDefined();
    expect(screen.getByText("No openable sessions yet.")).toBeDefined();
  });
});
