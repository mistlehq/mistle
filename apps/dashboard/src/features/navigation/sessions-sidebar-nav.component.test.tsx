// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionsSidebarNavItem } from "./sessions-sidebar-nav-model.js";
import { SessionsSidebarNav } from "./sessions-sidebar-nav.js";

const items: SessionsSidebarNavItem[] = [
  {
    id: "sbi_active",
    label: "Investigate flaky test run",
    profileName: "Repo Maintainer",
    status: "running",
    updatedAtLabel: "2m",
    to: "/sessions/sbi_active",
  },
  {
    id: "sbi_idle",
    label: "Review migration draft",
    profileName: "Repo Maintainer",
    status: "running",
    updatedAtLabel: "1h",
    to: "/sessions/sbi_idle",
  },
  {
    id: "sbi_failed",
    label: "Broken launch attempt",
    profileName: "Docs Maintainer",
    status: "failed",
    updatedAtLabel: "2d",
  },
];

function renderSidebarNav(input?: {
  items?: readonly SessionsSidebarNavItem[];
  initialEntries?: string[];
}): void {
  render(
    <SidebarProvider>
      <MemoryRouter initialEntries={input?.initialEntries ?? ["/sessions"]}>
        <SessionsSidebarNav items={input?.items ?? items} />
      </MemoryRouter>
    </SidebarProvider>,
  );
}

function getSearchInput(): HTMLElement {
  return screen.getByRole("textbox", { name: "Search sessions" });
}

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
  afterEach(() => {
    cleanup();
  });

  it("renders a new session link above the search field", () => {
    renderSidebarNav();

    expect(screen.getByRole("link", { name: "Create a new session" }).getAttribute("href")).toBe(
      "/sessions/new",
    );
    expect(screen.getByRole("textbox", { name: "Search sessions" })).toBeDefined();
  });

  it("marks the new session link active on the dedicated new-session route", () => {
    renderSidebarNav({
      initialEntries: ["/sessions/new"],
    });

    const newSessionLinks = screen.getAllByRole("link", { name: "Create a new session" });
    expect(newSessionLinks.some((link) => link.getAttribute("data-active") !== null)).toBe(true);
  });

  it("renders clickable and non-clickable items in API order", () => {
    renderSidebarNav();

    const links = screen.getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toContain("/sessions/sbi_active");
    expect(links.map((link) => link.getAttribute("href"))).toContain("/sessions/sbi_idle");
    expect(screen.queryByRole("link", { name: /Broken launch attempt/ })).toBeNull();
    expect(screen.getAllByText("Broken launch attempt").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Docs Maintainer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2d").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
  });

  it("filters by title and profile name", () => {
    renderSidebarNav();

    fireEvent.change(getSearchInput(), {
      target: { value: "docs" },
    });

    expect(screen.queryByText("Investigate flaky test run")).toBeNull();
    expect(screen.getByText("Broken launch attempt")).toBeDefined();
  });

  it("shows the no-results message when search matches nothing", () => {
    renderSidebarNav();

    fireEvent.change(getSearchInput(), {
      target: { value: "missing" },
    });

    expect(screen.getByText("No sessions match your search.")).toBeDefined();
  });

  it("keeps the new session action visible when there are no items", () => {
    renderSidebarNav({
      items: [],
    });

    expect(screen.getAllByRole("link", { name: "Create a new session" }).length).toBeGreaterThan(0);
    expect(screen.getByText("No sessions yet.")).toBeDefined();
  });
});
