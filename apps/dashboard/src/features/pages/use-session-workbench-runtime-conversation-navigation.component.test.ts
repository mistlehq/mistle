// @vitest-environment jsdom

import type { CodexThreadSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RuntimeConversationSummary } from "../session-agents/runtime-conversations/runtime-conversation-navigator-model.js";
import type { MainPanelTransitionState } from "./session-main-panel-handoff-state.js";
import type { SessionConversationPaneState } from "./use-session-workbench-conversation-runtime.js";
import { mapCodexThreadToRuntimeConversationSummary } from "./use-session-workbench-conversation-runtime.js";
import { useSessionWorkbenchRuntimeConversationNavigation } from "./use-session-workbench-runtime-conversation-navigation.js";

function createConversation(input: { id: string; cwd?: string }): RuntimeConversationSummary {
  return {
    id: input.id,
    title: input.id,
    cwd: input.cwd ?? "/workspace/repo",
    updatedAt: null,
    createdAt: null,
    lineage: null,
  };
}

function createRuntimeConversationNavigator(input: {
  activeConversationCwd?: string | null;
  activeConversationId?: string | null;
  availableConversations: readonly RuntimeConversationSummary[];
  originalConversationId?: string | null;
  providerConversationId?: string | null;
  refreshedConversationCwds?: Array<string | null>;
  resumedConversationIds?: string[];
}): NonNullable<SessionConversationPaneState["runtimeConversationNavigator"]> {
  return {
    activeConversationCwd: input.activeConversationCwd ?? "/workspace/repo",
    activeConversationId: input.activeConversationId ?? null,
    acknowledgeClearContextImplementationConversation:
      function acknowledgeClearContextImplementationConversation() {
        throw new Error(
          "Unexpected clear-context implementation acknowledgement in conversation navigation visibility test",
        );
      },
    availableConversations: input.availableConversations,
    clearContextImplementationConversationId: null,
    hasMoreAvailableConversations: false,
    isStartingNewConversation: false,
    originalConversationId: input.originalConversationId ?? null,
    pendingConversationId: null,
    providerConversationId: input.providerConversationId ?? null,
    refreshConversationList: function refreshConversationList(refreshInput) {
      input.refreshedConversationCwds?.push(refreshInput?.cwd ?? null);
      return;
    },
    resumeConversation: async function resumeConversation(conversationId) {
      if (input.resumedConversationIds === undefined) {
        throw new Error(
          "Unexpected conversation resume in conversation navigation visibility test",
        );
      }
      input.resumedConversationIds.push(conversationId);
      return conversationId;
    },
    startNewConversation: async function startNewConversation() {
      throw new Error("Unexpected conversation start in conversation navigation visibility test");
    },
  };
}

function renderConversationNavigation(input: {
  requestedRuntimeConversationId?: string | null;
  runtimeConversationNavigator: SessionConversationPaneState["runtimeConversationNavigator"];
  sandboxInstanceId: string;
}) {
  return renderHook(() =>
    useSessionWorkbenchRuntimeConversationNavigation({
      runtimeConversationNavigator: input.runtimeConversationNavigator,
      closeDiffPanel: function closeDiffPanel() {
        throw new Error("Unexpected diff panel close in conversation navigation visibility test");
      },
      isDiffPanelVisible: false,
      pendingServerRequests: [],
      primaryPanelTransitionState: "stable_chat" satisfies MainPanelTransitionState,
      primaryRepositoryPath: "/workspace/repo",
      requestedRuntimeConversationId: input.requestedRuntimeConversationId ?? null,
      sandboxInstanceId: input.sandboxInstanceId,
      searchParams: new URLSearchParams(),
      setSearchParams: function setSearchParams() {
        throw new Error(
          "Unexpected search param update in conversation navigation visibility test",
        );
      },
    }),
  );
}

describe("useSessionWorkbenchRuntimeConversationNavigation", () => {
  it("maps parentless Codex subagent threads to navigator lineage", () => {
    const thread = {
      id: "thread_memory_consolidation",
      name: "Condense context",
      preview: null,
      parentThreadId: null,
      threadSource: "memory_consolidation",
      isSubagent: true,
      agentNickname: null,
      agentRole: null,
      cwd: "/workspace/repo",
      createdAt: 1,
      updatedAt: 2,
    } satisfies CodexThreadSummary;

    expect(mapCodexThreadToRuntimeConversationSummary(thread)).toEqual({
      id: "thread_memory_consolidation",
      title: "Condense context",
      cwd: "/workspace/repo",
      createdAt: 1,
      updatedAt: 2,
      lineage: {
        parentConversationId: null,
        label: "Memory Consolidation",
        detail: null,
      },
    });
  });

  it("opens runtime conversation navigation by default when multiple unarchived conversations are available", () => {
    const sandboxInstanceId = "sbi_conversation_navigation_default_open";

    const { result } = renderConversationNavigation({
      sandboxInstanceId,
      runtimeConversationNavigator: createRuntimeConversationNavigator({
        availableConversations: [
          createConversation({ id: "conversation_one" }),
          createConversation({ id: "conversation_two" }),
        ],
      }),
    });

    expect(result.current.isPanelVisible).toBe(true);
    expect(result.current.secondaryPanelKind).toBe("conversations");
  });

  it("lets the user close auto-opened runtime conversation navigation in the current workbench", () => {
    const sandboxInstanceId = "sbi_conversation_navigation_close_auto_open";

    const { result } = renderConversationNavigation({
      sandboxInstanceId,
      runtimeConversationNavigator: createRuntimeConversationNavigator({
        availableConversations: [
          createConversation({ id: "conversation_one" }),
          createConversation({ id: "conversation_two" }),
        ],
      }),
    });

    expect(result.current.isPanelVisible).toBe(true);

    act(() => {
      result.current.closePanel();
    });

    expect(result.current.isPanelVisible).toBe(false);
    expect(result.current.secondaryPanelKind).toBeNull();
  });

  it("does not count a pinned active conversation as an unarchived conversation for default visibility", () => {
    const sandboxInstanceId = "sbi_conversation_navigation_pinned_active";

    const { result } = renderConversationNavigation({
      sandboxInstanceId,
      runtimeConversationNavigator: createRuntimeConversationNavigator({
        activeConversationId: "conversation_active",
        availableConversations: [createConversation({ id: "conversation_one" })],
      }),
    });

    expect(result.current.runtimeConversationNavigatorProps?.rows).toHaveLength(2);
    expect(result.current.isPanelVisible).toBe(false);
    expect(result.current.secondaryPanelKind).toBeNull();
  });

  it("uses the resolved original conversation id for row metadata", () => {
    const sandboxInstanceId = "sbi_conversation_navigation_provider_original";

    const { result } = renderConversationNavigation({
      sandboxInstanceId,
      runtimeConversationNavigator: createRuntimeConversationNavigator({
        availableConversations: [
          createConversation({ id: "conversation_earliest" }),
          createConversation({ id: "conversation_provider" }),
        ],
        originalConversationId: "conversation_provider",
      }),
    });

    expect(result.current.runtimeConversationNavigatorProps).not.toBeNull();
    const rows = result.current.runtimeConversationNavigatorProps?.rows;
    if (rows === undefined) {
      throw new Error("Expected conversation navigator rows.");
    }
    const rowsById = new Map(rows.map((row) => [row.id, row.isOriginal]));

    expect(rowsById.get("conversation_provider")).toBe(true);
    expect(rowsById.get("conversation_earliest")).toBe(false);
  });

  it("keeps URL conversation navigation available after leaving the provider original", async () => {
    const resumedConversationIds: string[] = [];
    renderConversationNavigation({
      requestedRuntimeConversationId: "conversation_requested",
      sandboxInstanceId: "sbi_conversation_navigation_provider_restore",
      runtimeConversationNavigator: createRuntimeConversationNavigator({
        activeConversationId: "conversation_active",
        availableConversations: [
          createConversation({ id: "conversation_active" }),
          createConversation({ id: "conversation_requested" }),
        ],
        originalConversationId: "conversation_provider",
        providerConversationId: "conversation_provider",
        resumedConversationIds,
      }),
    });

    await expect.poll(() => resumedConversationIds).toEqual(["conversation_requested"]);
  });

  it("keeps URL conversation navigation available from the provider original", async () => {
    const resumedConversationIds: string[] = [];
    renderConversationNavigation({
      requestedRuntimeConversationId: "conversation_requested",
      sandboxInstanceId: "sbi_conversation_navigation_provider_original_restore",
      runtimeConversationNavigator: createRuntimeConversationNavigator({
        activeConversationId: "conversation_provider",
        availableConversations: [
          createConversation({ id: "conversation_provider" }),
          createConversation({ id: "conversation_requested" }),
        ],
        originalConversationId: "conversation_provider",
        providerConversationId: "conversation_provider",
        resumedConversationIds,
      }),
    });

    await expect.poll(() => resumedConversationIds).toEqual(["conversation_requested"]);
  });

  it("waits for the runtime to establish an active conversation before URL conversation navigation", async () => {
    const resumedConversationIds: string[] = [];
    renderConversationNavigation({
      requestedRuntimeConversationId: "conversation_requested",
      sandboxInstanceId: "sbi_conversation_navigation_wait_for_active",
      runtimeConversationNavigator: createRuntimeConversationNavigator({
        activeConversationId: null,
        availableConversations: [],
        resumedConversationIds,
      }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(resumedConversationIds).toEqual([]);
  });

  it("does not refresh again only because the navigator adapter callback identity changed", async () => {
    const refreshedConversationCwds: Array<string | null> = [];
    const createNavigator = () =>
      createRuntimeConversationNavigator({
        availableConversations: [
          createConversation({ id: "conversation_one" }),
          createConversation({ id: "conversation_two" }),
        ],
        refreshedConversationCwds,
      });

    const { rerender } = renderHook(
      (input: {
        runtimeConversationNavigator: SessionConversationPaneState["runtimeConversationNavigator"];
      }) =>
        useSessionWorkbenchRuntimeConversationNavigation({
          runtimeConversationNavigator: input.runtimeConversationNavigator,
          closeDiffPanel: function closeDiffPanel() {
            throw new Error("Unexpected diff panel close in refresh loop regression test");
          },
          isDiffPanelVisible: false,
          pendingServerRequests: [],
          primaryPanelTransitionState: "stable_chat" satisfies MainPanelTransitionState,
          primaryRepositoryPath: "/workspace/repo",
          requestedRuntimeConversationId: null,
          sandboxInstanceId: "sbi_conversation_navigation_refresh_loop",
          searchParams: new URLSearchParams(),
          setSearchParams: function setSearchParams() {
            throw new Error("Unexpected search param update in refresh loop regression test");
          },
        }),
      {
        initialProps: {
          runtimeConversationNavigator: createNavigator(),
        },
      },
    );

    await expect.poll(() => refreshedConversationCwds).toEqual(["/workspace/repo"]);

    rerender({
      runtimeConversationNavigator: createNavigator(),
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshedConversationCwds).toEqual(["/workspace/repo"]);
  });
});
