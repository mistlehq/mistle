// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { SessionsSidebarNavItem } from "./sessions-sidebar-nav-model.js";
import { SessionsSidebarNav } from "./sessions-sidebar-nav.js";

const items: SessionsSidebarNavItem[] = [
  {
    id: "sbi_active",
    label: "Investigate flaky test run",
    profileName: "Repo Maintainer",
    metadataLabel: "Working",
    to: "/sessions/sbi_active",
    showActivityIndicator: true,
    updatedAt: "2026-04-08T00:00:00.000Z",
  },
  {
    id: "sbi_idle",
    label: "Review migration draft",
    profileName: "Repo Maintainer",
    metadataLabel: "Idle",
    to: "/sessions/sbi_idle",
    showActivityIndicator: false,
    updatedAt: "2026-04-07T00:00:00.000Z",
  },
  {
    id: "sbi_docs",
    label: "Draft onboarding guide",
    profileName: "Docs Maintainer",
    metadataLabel: "1h",
    to: "/sessions/sbi_docs",
    showActivityIndicator: false,
    updatedAt: "2026-04-09T23:00:00.000Z",
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

function installIntersectionObserverStub(): void {
  Object.defineProperty(window, "IntersectionObserver", {
    configurable: true,
    value: class IntersectionObserver {
      public constructor(
        _callback: IntersectionObserverCallback,
        _options?: IntersectionObserverInit,
      ) {}

      public disconnect(): void {}

      public observe(): void {}

      public unobserve(): void {}

      public takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    },
  });
}

function SearchAutoLoadHarness(): React.JSX.Element {
  const [loadCount, setLoadCount] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    if (isLoadingMore && loadCount > 0) {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, loadCount]);

  return (
    <div>
      <span>load-count:{loadCount}</span>
      <SidebarProvider>
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsSidebarNav
            items={items}
            infiniteScroll={{
              hasMore: loadCount === 0,
              onReachEnd: () => {
                setIsLoadingMore(true);
                setLoadCount((currentCount) => currentCount + 1);
              },
              ...(isLoadingMore ? {} : {}),
              ...(isLoadingMore
                ? {
                    statusBanner: {
                      kind: "loading" as const,
                      label: "Loading more",
                    },
                  }
                : {}),
            }}
          />
        </MemoryRouter>
      </SidebarProvider>
    </div>
  );
}

describe("SessionsSidebarNav", () => {
  installMatchMediaStub();
  installIntersectionObserverStub();

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

    expect(
      screen.getByRole("link", { name: "Create a new session" }).getAttribute("data-active"),
    ).not.toBeNull();
  });

  it("renders the profile name inline with each session row", () => {
    renderSidebarNav();

    expect(screen.getAllByText("Repo Maintainer")).toHaveLength(2);
    expect(screen.getByText("Docs Maintainer")).toBeDefined();
  });

  it("filters sessions by title and profile name", () => {
    renderSidebarNav();

    fireEvent.change(getSearchInput(), {
      target: { value: "docs" },
    });

    expect(screen.getByRole("link", { name: /Draft onboarding guide/ })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Investigate flaky test run/ })).toBeNull();
  });

  it("keeps requesting older pages while a search is active with no visible matches", async () => {
    render(<SearchAutoLoadHarness />);

    fireEvent.change(getSearchInput(), {
      target: { value: "nonexistent-session" },
    });

    await waitFor(() => {
      expect(screen.getByText((content) => content === "load-count:1")).toBeDefined();
    });
    expect(screen.getByText("No sessions match your search.")).toBeDefined();
  });

  it("shows no terminal hint once older-session loading is exhausted", () => {
    render(
      <SidebarProvider>
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsSidebarNav
            items={items}
            infiniteScroll={{
              hasMore: false,
            }}
          />
        </MemoryRouter>
      </SidebarProvider>,
    );

    expect(screen.queryByText("No older sessions")).toBeNull();
    expect(screen.queryByText("Loading more")).toBeNull();
  });

  it("renders a loading hint while older sessions are being fetched", () => {
    render(
      <SidebarProvider>
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsSidebarNav
            items={items}
            infiniteScroll={{
              hasMore: true,
              statusBanner: {
                kind: "loading",
                label: "Loading more",
              },
            }}
          />
        </MemoryRouter>
      </SidebarProvider>,
    );
    expect(screen.getByText("Loading more")).toBeDefined();
  });

  it("shows working for active running sessions and idle for inactive running sessions", () => {
    renderSidebarNav();

    expect(screen.getByText("Working")).toBeDefined();
    expect(screen.getAllByText("Working")).toHaveLength(1);
    expect(screen.getByText("Idle")).toBeDefined();
  });

  it("keeps the new session action visible when there are no items", () => {
    renderSidebarNav({
      items: [],
    });

    expect(screen.getByRole("link", { name: "Create a new session" })).toBeDefined();
    expect(screen.getByText("No sessions yet.")).toBeDefined();
  });
});
