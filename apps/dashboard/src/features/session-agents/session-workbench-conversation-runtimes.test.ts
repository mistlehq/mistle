import { CodexRuntimeCommandIds } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { describe, expect, it } from "vitest";

import {
  buildCodexConversationRuntime,
  buildOpenCodeConversationRuntime,
} from "./session-workbench-conversation-runtimes.js";

type CodexRuntimeInput = Parameters<typeof buildCodexConversationRuntime>[0];
type OpenCodeRuntimeInput = Parameters<typeof buildOpenCodeConversationRuntime>[0];

const ReadyBootstrap: CodexRuntimeInput["bootstrap"] = {
  phase: { status: "ready" },
  composerCapabilities: [],
  establishedSnapshot: {
    availableModels: [],
    configSnapshot: {
      model: null,
      modelReasoningEffort: null,
    },
  },
};

const ComposerConfigControl: CodexRuntimeInput["configControl"] = {
  selectedModel: null,
  selectedReasoningEffort: null,
  hasExplicitModelSelection: false,
  modelOptions: [],
  canChangeReasoningEffort: false,
  isUpdating: false,
  setModel: () => {
    return;
  },
  setReasoningEffort: () => {
    return;
  },
};

function createCodexRuntimeInput(input: {
  activeConversationId: string | null;
  compactedThreadIds: string[];
  reportedMessages: string[];
}): CodexRuntimeInput {
  return {
    activeConversationId: input.activeConversationId,
    bootstrap: ReadyBootstrap,
    chat: {
      chatState: {
        activeTurnId: null,
        pendingTurnId: null,
        status: null,
        completedStatus: null,
        completedErrorMessage: null,
        turnOrder: [],
        turnsById: {},
        entries: [],
      },
      isStartingTurn: false,
      isReloadingChat: false,
      isInterruptingTurn: false,
      isSteeringTurn: false,
      canInterruptTurn: false,
      canSteerTurn: false,
      hydrateChatFromThread: async () => {
        return;
      },
      startTurn: async () => {
        return;
      },
      interruptTurn: () => {
        return;
      },
      dismissUserMessageAction: () => {
        return;
      },
      steerTurn: async () => {
        return;
      },
      reloadChat: () => {
        return;
      },
    },
    compactThread: (threadId) => {
      input.compactedThreadIds.push(threadId);
    },
    configControl: ComposerConfigControl,
    contextUsage: null,
    serverRequests: {
      pendingServerRequests: [],
      isRespondingToServerRequest: false,
      respondToServerRequest: () => {
        return;
      },
      resetServerRequests: () => {
        return;
      },
    },
    sessionMessage: {
      clearSessionErrorMessage: () => {
        return;
      },
      reportSessionErrorMessage: (message) => {
        input.reportedMessages.push(message);
      },
      sessionErrorMessage: null,
    },
    startTurn: async () => {
      return;
    },
  };
}

function getRuntimeCommandExecutor(
  runtime: ReturnType<typeof buildCodexConversationRuntime>,
): (commandId: string) => boolean {
  const executor = runtime.composerRuntimeInput.executeRuntimeCommand;
  if (executor === undefined) {
    throw new Error("Expected Codex runtime to expose runtime command execution.");
  }

  return executor;
}

function createOpenCodeRuntimeInput(reportedMessages: string[]): OpenCodeRuntimeInput {
  return {
    bootstrap: ReadyBootstrap,
    chat: {
      abortSession: async () => {
        return;
      },
      canInterruptTurn: false,
      chatState: {
        completedErrorMessage: null,
        entries: [],
        messageOrder: [],
        messagesById: {},
        pendingPermissions: [],
        sessionId: null,
        status: "idle",
      },
      hydrateChatFromSession: async () => {
        return;
      },
      hydrateChatFromSessionOrThrow: async () => {
        return;
      },
      isHydratingChat: false,
      isInterruptingTurn: false,
      isRespondingToPermission: false,
      isStartingTurn: false,
      respondToPermission: async () => {
        return;
      },
      waitForGeneratedSessionTitle: async () => "",
      sendPrompt: async () => {
        return;
      },
    },
    configControl: ComposerConfigControl,
    sessionMessage: {
      clearSessionErrorMessage: () => {
        return;
      },
      reportSessionErrorMessage: (message) => {
        reportedMessages.push(message);
      },
      sessionErrorMessage: null,
    },
    sessionSnapshot: null,
    startTurn: async () => {
      return;
    },
  };
}

describe("buildCodexConversationRuntime", () => {
  it("accepts the compact runtime command for an active Codex conversation", () => {
    const compactedThreadIds: string[] = [];
    const reportedMessages: string[] = [];
    const runtime = buildCodexConversationRuntime(
      createCodexRuntimeInput({
        activeConversationId: "thread_123",
        compactedThreadIds,
        reportedMessages,
      }),
    );

    const accepted = getRuntimeCommandExecutor(runtime)(CodexRuntimeCommandIds.COMPACT_THREAD);

    expect(accepted).toBe(true);
    expect(compactedThreadIds).toEqual(["thread_123"]);
    expect(reportedMessages).toEqual([]);
  });

  it("rejects compact runtime commands when no Codex conversation is active", () => {
    const compactedThreadIds: string[] = [];
    const reportedMessages: string[] = [];
    const runtime = buildCodexConversationRuntime(
      createCodexRuntimeInput({
        activeConversationId: null,
        compactedThreadIds,
        reportedMessages,
      }),
    );

    const accepted = getRuntimeCommandExecutor(runtime)(CodexRuntimeCommandIds.COMPACT_THREAD);

    expect(accepted).toBe(false);
    expect(compactedThreadIds).toEqual([]);
    expect(reportedMessages).toEqual(["Choose a Codex thread before compacting context."]);
  });

  it("rejects unsupported Codex runtime commands", () => {
    const compactedThreadIds: string[] = [];
    const reportedMessages: string[] = [];
    const runtime = buildCodexConversationRuntime(
      createCodexRuntimeInput({
        activeConversationId: "thread_123",
        compactedThreadIds,
        reportedMessages,
      }),
    );

    const accepted = getRuntimeCommandExecutor(runtime)("codex.unsupported");

    expect(accepted).toBe(false);
    expect(compactedThreadIds).toEqual([]);
    expect(reportedMessages).toEqual(["Unsupported Codex runtime command 'codex.unsupported'."]);
  });
});

describe("buildOpenCodeConversationRuntime", () => {
  it("does not expose runtime command execution", () => {
    const runtime = buildOpenCodeConversationRuntime(createOpenCodeRuntimeInput([]));

    expect("executeRuntimeCommand" in runtime.composerRuntimeInput).toBe(false);
  });
});
