// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodexThreadHeaderScope } from "./codex-thread-header-scope.js";
import type { CodexThreadNavigatorRow } from "./codex-thread-navigator-model.js";

function createThreadRow(input?: Partial<CodexThreadNavigatorRow>): CodexThreadNavigatorRow {
  return {
    id: "thread_active",
    title: "Implement thread navigation",
    cwd: "/Users/test/project",
    cwdSectionLabel: "project",
    isActive: true,
    isOpening: false,
    isPinnedCurrent: false,
    pendingServerRequestCount: 0,
    ...input,
  };
}

describe("CodexThreadHeaderScope", () => {
  it("does not render when no Codex thread is active", () => {
    render(<CodexThreadHeaderScope row={null} />);

    expect(screen.queryByLabelText("Active Codex thread")).toBeNull();
  });

  it("shows the active thread title beside the session title", () => {
    render(<CodexThreadHeaderScope row={createThreadRow()} />);

    const scope = screen.getByLabelText("Active Codex thread");
    expect(within(scope).getByText("Thread")).toBeTruthy();
    expect(within(scope).getByText("Implement thread navigation")).toBeTruthy();
  });
});
