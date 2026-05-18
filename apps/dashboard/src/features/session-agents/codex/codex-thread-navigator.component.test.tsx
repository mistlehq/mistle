// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CodexThreadNavigatorRow } from "./codex-thread-navigator-model.js";
import { CodexThreadNavigator, CodexThreadNavigatorSheet } from "./codex-thread-navigator.js";

const Rows = [
  {
    id: "thread_active",
    title: "Active work",
    preview: "Active preview",
    cwd: "/workspace/repo-a",
    cwdLabel: null,
    createdAt: 10,
    updatedAt: 20,
    isActive: true,
    isLoaded: true,
    isOpening: false,
    isPinnedCurrent: false,
    pendingServerRequestCount: 1,
  },
  {
    id: "thread_other",
    title: "Other work",
    preview: "Other preview",
    cwd: "/workspace/repo-b",
    cwdLabel: "repo-b",
    createdAt: 30,
    updatedAt: 40,
    isActive: false,
    isLoaded: false,
    isOpening: true,
    isPinnedCurrent: true,
    pendingServerRequestCount: 0,
  },
] satisfies readonly CodexThreadNavigatorRow[];

describe("CodexThreadNavigator", () => {
  it("renders thread rows with active and opening metadata", () => {
    render(
      <CodexThreadNavigator
        canUseRepositoryScope
        isStartingThread={false}
        onRefreshThreads={function onRefreshThreads() {}}
        onScopeChange={function onScopeChange() {}}
        onSelectThread={function onSelectThread() {}}
        onStartThread={function onStartThread() {}}
        rows={Rows}
        scope="repository"
      />,
    );

    const navigator = screen.getByRole("complementary", { name: "Threads" });
    expect(within(navigator).getByRole("heading", { name: "Threads" })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: "New thread" })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: /Active work/ })).toBeTruthy();
    expect(within(navigator).getByText("Needs input")).toBeTruthy();
    expect(within(navigator).getByText("Active")).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: /Other work/ })).toBeTruthy();
    expect(within(navigator).getByText("Opening")).toBeTruthy();
    expect(within(navigator).getByText("Current")).toBeTruthy();
    expect(within(navigator).getByText("repo-b")).toBeTruthy();
  });

  it("renders the same thread list inside the mobile sheet", () => {
    render(
      <CodexThreadNavigatorSheet
        isOpen
        navigator={{
          canUseRepositoryScope: true,
          isStartingThread: false,
          onRefreshThreads: function onRefreshThreads() {},
          onScopeChange: function onScopeChange() {},
          onSelectThread: function onSelectThread() {},
          onStartThread: function onStartThread() {},
          rows: Rows,
          scope: "repository",
        }}
        onOpenChange={function onOpenChange() {}}
      />,
    );

    const sheet = screen.getByRole("dialog", { name: "Threads" });
    expect(within(sheet).getAllByRole("heading", { name: "Threads" }).length).toBeGreaterThan(0);
    expect(within(sheet).getByRole("button", { name: /Active work/ })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /Other work/ })).toBeTruthy();
  });
});
