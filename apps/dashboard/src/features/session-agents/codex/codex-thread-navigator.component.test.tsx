// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { CodexThreadNavigatorRow } from "./codex-thread-navigator-model.js";
import { CodexThreadNavigator, CodexThreadNavigatorSheet } from "./codex-thread-navigator.js";

const Rows = [
  {
    id: "thread_active",
    title: "Active work",
    cwd: "/workspace/repo-a",
    cwdSectionLabel: "repo-a",
    lastActivityAt: Date.now() - 2 * 86_400_000,
    isActive: true,
    isOpening: false,
    isOriginal: true,
    isPinnedCurrent: false,
    pendingServerRequestCount: 1,
  },
  {
    id: "thread_other",
    title: "Other work",
    cwd: "/workspace/repo-b",
    cwdSectionLabel: "repo-b",
    lastActivityAt: Date.now() - 3 * 3_600_000,
    isActive: false,
    isOpening: true,
    isOriginal: false,
    isPinnedCurrent: false,
    pendingServerRequestCount: 0,
  },
] satisfies readonly CodexThreadNavigatorRow[];

describe("CodexThreadNavigator", () => {
  it("renders thread rows with compact status indicators", () => {
    render(
      <CodexThreadNavigator
        isThreadListLimited={false}
        isStartingThread={false}
        onRefreshThreads={function onRefreshThreads() {}}
        onSelectThread={function onSelectThread() {}}
        onStartThread={function onStartThread() {}}
        rows={Rows}
      />,
    );

    const navigator = screen.getByRole("complementary", { name: "Threads" });
    expect(within(navigator).getByRole("heading", { name: "Threads" })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: "New thread" })).toBeTruthy();
    expect(within(navigator).queryByText("Showing latest 20 only")).toBeNull();
    expect(within(navigator).getByRole("button", { name: "Refresh threads" })).toBeTruthy();
    expect(within(navigator).getByRole("region", { name: "repo-a" })).toBeTruthy();
    expect(within(navigator).getByRole("region", { name: "repo-b" })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: /Active work/ })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: /original/ })).toBeTruthy();
    expect(within(navigator).getByText("2d")).toBeTruthy();
    expect(within(navigator).getByText("3h")).toBeTruthy();
    expect(within(navigator).getByRole("status", { name: "Needs input" })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: /Other work/ })).toBeTruthy();
    expect(within(navigator).queryByLabelText("Opening thread")).toBeNull();
    expect(within(navigator).queryByText("Active")).toBeNull();
    expect(within(navigator).queryByText("Loaded")).toBeNull();
    expect(within(navigator).queryByText("Current")).toBeNull();
  });

  it("renders pinned active placeholders as italic new threads", () => {
    render(
      <CodexThreadNavigator
        isThreadListLimited={false}
        isStartingThread={false}
        onRefreshThreads={function onRefreshThreads() {}}
        onSelectThread={function onSelectThread() {}}
        onStartThread={function onStartThread() {}}
        rows={[
          {
            id: "thread_new",
            title: "New thread",
            cwd: "/root",
            cwdSectionLabel: "root",
            lastActivityAt: null,
            isActive: true,
            isOpening: false,
            isOriginal: false,
            isPinnedCurrent: true,
            pendingServerRequestCount: 0,
          },
        ]}
      />,
    );

    const navigator = screen.getByRole("complementary", { name: "Threads" });
    const title = within(navigator).getByText("New thread");
    expect(title.className).toContain("italic");
    expect(within(navigator).queryByText("root")).toBeNull();
  });

  it("states when the thread list is limited to the latest 20", () => {
    render(
      <CodexThreadNavigator
        isThreadListLimited
        isStartingThread={false}
        onRefreshThreads={function onRefreshThreads() {}}
        onSelectThread={function onSelectThread() {}}
        onStartThread={function onStartThread() {}}
        rows={Rows}
      />,
    );

    const navigator = screen.getByRole("complementary", { name: "Threads" });
    expect(within(navigator).getByText("Showing latest 20 only")).toBeTruthy();
  });

  it("renders the same thread list inside the mobile sheet", () => {
    render(
      <CodexThreadNavigatorSheet
        isOpen
        navigator={{
          isThreadListLimited: false,
          isStartingThread: false,
          onRefreshThreads: function onRefreshThreads() {},
          onSelectThread: function onSelectThread() {},
          onStartThread: function onStartThread() {},
          rows: Rows,
        }}
        onOpenChange={function onOpenChange() {}}
      />,
    );

    const sheet = screen.getByRole("dialog", { name: "Threads" });
    expect(within(sheet).getAllByRole("heading", { name: "Threads" }).length).toBeGreaterThan(0);
    expect(within(sheet).getByRole("button", { name: /Active work/ })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /Other work/ })).toBeTruthy();
  });

  it("closes the mobile sheet after starting a thread", () => {
    function SheetHarness(): React.JSX.Element {
      const [isOpen, setOpen] = useState(true);

      return (
        <CodexThreadNavigatorSheet
          isOpen={isOpen}
          navigator={{
            isThreadListLimited: false,
            isStartingThread: false,
            onRefreshThreads: function onRefreshThreads() {},
            onSelectThread: function onSelectThread() {},
            onStartThread: function onStartThread() {},
            rows: Rows,
          }}
          onOpenChange={setOpen}
        />
      );
    }

    render(<SheetHarness />);

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));

    expect(screen.queryByRole("dialog", { name: "Threads" })).toBeNull();
  });

  it("closes the mobile sheet after selecting a thread", () => {
    function SheetHarness(): React.JSX.Element {
      const [isOpen, setOpen] = useState(true);

      return (
        <CodexThreadNavigatorSheet
          isOpen={isOpen}
          navigator={{
            isThreadListLimited: false,
            isStartingThread: false,
            onRefreshThreads: function onRefreshThreads() {},
            onSelectThread: function onSelectThread() {},
            onStartThread: function onStartThread() {},
            rows: Rows,
          }}
          onOpenChange={setOpen}
        />
      );
    }

    render(<SheetHarness />);

    fireEvent.click(screen.getByRole("button", { name: /Active work/ }));

    expect(screen.queryByRole("dialog", { name: "Threads" })).toBeNull();
  });
});
