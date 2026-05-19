// @vitest-environment jsdom

import type { CodexThreadSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import type { SessionConversationPaneState } from "./use-session-workbench-conversation-runtime.js";
import { useSessionWorkbenchThreadNavigation } from "./use-session-workbench-thread-navigation.js";

function createThread(input: { id: string; cwd?: string }): CodexThreadSummary {
  return {
    id: input.id,
    name: input.id,
    preview: null,
    cwd: input.cwd ?? "/workspace/repo",
    updatedAt: null,
    createdAt: null,
  };
}

function createCodexThreadNavigator(input: {
  activeThreadCwd?: string | null;
  activeThreadId?: string | null;
  availableThreads: readonly CodexThreadSummary[];
}): NonNullable<SessionConversationPaneState["codexThreadNavigator"]> {
  return {
    activeThreadCwd: input.activeThreadCwd ?? "/workspace/repo",
    activeThreadId: input.activeThreadId ?? null,
    availableThreads: input.availableThreads,
    hasMoreAvailableThreads: false,
    isStartingNewThread: false,
    pendingThreadId: null,
    providerThreadId: null,
    refreshThreadList: function refreshThreadList() {
      throw new Error("Unexpected thread list refresh in thread navigation visibility test");
    },
    resumeThread: async function resumeThread() {
      throw new Error("Unexpected thread resume in thread navigation visibility test");
    },
    startNewThread: async function startNewThread() {
      throw new Error("Unexpected thread start in thread navigation visibility test");
    },
  };
}

function renderThreadNavigation(input: {
  codexThreadNavigator: SessionConversationPaneState["codexThreadNavigator"];
  sandboxInstanceId: string;
}) {
  return renderHook(() =>
    useSessionWorkbenchThreadNavigation({
      codexThreadNavigator: input.codexThreadNavigator,
      closeDiffPanel: function closeDiffPanel() {
        throw new Error("Unexpected diff panel close in thread navigation visibility test");
      },
      isDiffPanelVisible: false,
      pendingServerRequests: [],
      primaryPanelTransitionState: "stable_chat" satisfies MainPanelTransitionState,
      primaryRepositoryPath: "/workspace/repo",
      requestedThreadId: null,
      sandboxInstanceId: input.sandboxInstanceId,
      searchParams: new URLSearchParams(),
      setSearchParams: function setSearchParams() {
        throw new Error("Unexpected search param update in thread navigation visibility test");
      },
    }),
  );
}

describe("useSessionWorkbenchThreadNavigation", () => {
  it("opens Codex thread navigation by default when multiple unarchived threads are available", () => {
    const sandboxInstanceId = "sbi_thread_navigation_default_open";

    const { result } = renderThreadNavigation({
      sandboxInstanceId,
      codexThreadNavigator: createCodexThreadNavigator({
        availableThreads: [createThread({ id: "thread_one" }), createThread({ id: "thread_two" })],
      }),
    });

    expect(result.current.isPanelVisible).toBe(true);
    expect(result.current.secondaryPanelKind).toBe("threads");
  });

  it("lets the user close auto-opened Codex thread navigation in the current workbench", () => {
    const sandboxInstanceId = "sbi_thread_navigation_close_auto_open";

    const { result } = renderThreadNavigation({
      sandboxInstanceId,
      codexThreadNavigator: createCodexThreadNavigator({
        availableThreads: [createThread({ id: "thread_one" }), createThread({ id: "thread_two" })],
      }),
    });

    expect(result.current.isPanelVisible).toBe(true);

    act(() => {
      result.current.closePanel();
    });

    expect(result.current.isPanelVisible).toBe(false);
    expect(result.current.secondaryPanelKind).toBeNull();
  });

  it("does not count a pinned active thread as an unarchived thread for default visibility", () => {
    const sandboxInstanceId = "sbi_thread_navigation_pinned_active";

    const { result } = renderThreadNavigation({
      sandboxInstanceId,
      codexThreadNavigator: createCodexThreadNavigator({
        activeThreadId: "thread_active",
        availableThreads: [createThread({ id: "thread_one" })],
      }),
    });

    expect(result.current.threadNavigatorProps?.rows).toHaveLength(2);
    expect(result.current.isPanelVisible).toBe(false);
    expect(result.current.secondaryPanelKind).toBeNull();
  });
});
