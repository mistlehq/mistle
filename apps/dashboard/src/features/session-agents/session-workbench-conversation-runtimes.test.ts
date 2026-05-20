import { CodexRuntimeCommandIds } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { describe, expect, it } from "vitest";

import {
  buildCodexConversationRuntime,
  buildOpenCodeConversationRuntime,
  buildPiConversationRuntime,
  resolvePiAttachmentTargetId,
} from "./session-workbench-conversation-runtimes.js";

type CodexRuntimeInput = Parameters<typeof buildCodexConversationRuntime>[0];
type OpenCodeRuntimeInput = Parameters<typeof buildOpenCodeConversationRuntime>[0];
type PiRuntimeInput = Parameters<typeof buildPiConversationRuntime>[0];

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
  reasoningEffortOptions: [],
  canChangeReasoningEffort: false,
  controlsDisabled: false,
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
  composerCapabilities?: CodexRuntimeInput["bootstrap"]["composerCapabilities"];
  compactedThreadIds: string[];
  reportedMessages: string[];
}): CodexRuntimeInput {
  return {
    activeConversationId: input.activeConversationId,
    bootstrap:
      input.composerCapabilities === undefined
        ? ReadyBootstrap
        : {
            ...ReadyBootstrap,
            composerCapabilities: input.composerCapabilities,
          },
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
      hasPendingFollowUp: false,
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
    goals: {
      activeGoal: null,
      activeGoalStatus: null,
      commandPanel: null,
      clearCommandPanel: () => {
        return;
      },
      confirmReplaceGoal: () => {
        return;
      },
      saveEditedGoal: () => {
        return;
      },
      executeTypedComposerCommand: () => false,
    },
    reviews: {
      commandPanel: null,
      clearCommandPanel: () => {
        return;
      },
      executeTypedComposerCommand: () => false,
    },
    plans: {
      activeMode: "default",
      clearContextImplementationThreadId: null,
      acknowledgeClearContextImplementationThread:
        function acknowledgeClearContextImplementationThread() {
          throw new Error(
            "Unexpected clear-context implementation acknowledgement in conversation runtime test",
          );
        },
      commandPanel: null,
      executeTypedComposerCommand: () => false,
      switchActiveThreadToDefault: () => {
        return;
      },
    },
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
    executePromptCommand: async () => {
      return;
    },
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

function createPiRuntimeInput(input: {
  queuedPrompts?: string[];
  reportedMessages: string[];
  steeredPrompts: string[];
}): PiRuntimeInput {
  return {
    bootstrap: ReadyBootstrap,
    chat: {
      abortConversation: async () => {
        return;
      },
      canInterruptTurn: true,
      canSteerTurn: true,
      chatState: {
        completedErrorMessage: null,
        entries: [
          {
            id: "pi:user:1",
            kind: "user-message",
            status: "completed",
            text: "hello",
            turnId: "pi:user:1",
          },
        ],
        messages: [],
        pendingToolExecutions: [],
        pendingTurnId: "pi:user:1",
        sessionFile: "pi-session.json",
        status: "busy",
        streamingMessage: null,
      },
      confirmChatRestoredAfterReconnect: async () => {
        return;
      },
      isInterruptingTurn: false,
      isStartingTurn: false,
      isSteeringTurn: false,
      sendPrompt: async () => {
        return;
      },
      followUpTurn: async (turnInput) => {
        input.queuedPrompts?.push(turnInput.submittedPrompt);
      },
      steerTurn: async (turnInput) => {
        input.steeredPrompts.push(turnInput.submittedPrompt);
      },
    },
    configControl: ComposerConfigControl,
    sessionMessage: {
      clearSessionErrorMessage: () => {
        return;
      },
      reportSessionErrorMessage: (message) => {
        input.reportedMessages.push(message);
      },
      sessionErrorMessage: null,
    },
    queueTurn: async (turnInput) => {
      input.queuedPrompts?.push(turnInput.transcriptPrompt ?? turnInput.submittedPrompt);
    },
    sessionSnapshot: {
      activeConversationId: "pi-session",
      activeDirectory: null,
      activeSessionFile: "pi-session.json",
      connectedAtIso: "2026-05-19T00:00:00.000Z",
      providerConversationId: null,
      sandboxInstanceId: "sandbox_123",
    },
    startTurn: async () => {
      return;
    },
    steerTurn: async (turnInput) => {
      input.steeredPrompts.push(turnInput.transcriptPrompt ?? turnInput.submittedPrompt);
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

  it("reserves typed runtime commands when the runtime reports them disabled", () => {
    const runtime = buildCodexConversationRuntime(
      createCodexRuntimeInput({
        activeConversationId: "thread_123",
        compactedThreadIds: [],
        reportedMessages: [],
      }),
    );

    expect(runtime.composerRuntimeInput.unavailableTypedRuntimeCommands).toEqual([
      {
        name: "review",
        message: "/review is not enabled for this Codex runtime.",
      },
      {
        name: "plan",
        message: "/plan is not enabled for this Codex runtime.",
      },
      {
        name: "goal",
        message: "/goal is not enabled for this Codex runtime.",
      },
    ]);
  });

  it("does not reserve typed runtime commands when the commands are available", () => {
    const runtime = buildCodexConversationRuntime(
      createCodexRuntimeInput({
        activeConversationId: "thread_123",
        composerCapabilities: [
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.review",
                name: "review",
                availability: {
                  duringActiveTurn: "disabled",
                },
                submitAs: "typedRuntimeCommand",
              },
              {
                id: "codex.plan",
                name: "plan",
                availability: {
                  duringActiveTurn: "disabled",
                },
                submitAs: "typedRuntimeCommand",
              },
              {
                id: "codex.goal",
                name: "goal",
                availability: {
                  duringActiveTurn: "enabled",
                },
                submitAs: "typedRuntimeCommand",
              },
            ],
          },
        ],
        compactedThreadIds: [],
        reportedMessages: [],
      }),
    );

    expect(runtime.composerRuntimeInput.unavailableTypedRuntimeCommands).toEqual([]);
  });

  it("renders a review picker ahead of a pending plan prompt", () => {
    const reviewPanel: NonNullable<CodexRuntimeInput["reviews"]["commandPanel"]> = {
      kind: "picker",
      title: "Review target",
      searchPlaceholder: "Search",
      onCancel: () => {
        return;
      },
      options: [],
    };
    const planPanel: NonNullable<CodexRuntimeInput["plans"]["commandPanel"]> = {
      kind: "choice",
      title: "Implement this plan?",
      suppressWhenQueuedPrompts: true,
      choices: [],
    };
    const input = createCodexRuntimeInput({
      activeConversationId: "thread_123",
      compactedThreadIds: [],
      reportedMessages: [],
    });
    input.reviews.commandPanel = reviewPanel;
    input.plans.commandPanel = planPanel;

    const runtime = buildCodexConversationRuntime(input);

    expect(runtime.composerRuntimeInput.commandPanel).toBe(reviewPanel);
  });
});

describe("buildOpenCodeConversationRuntime", () => {
  it("does not expose runtime command execution", () => {
    const runtime = buildOpenCodeConversationRuntime(createOpenCodeRuntimeInput([]));

    expect("executeRuntimeCommand" in runtime.composerRuntimeInput).toBe(false);
  });

  it("routes typed OpenCode prompt commands to the OpenCode command executor", () => {
    const executedCommands: string[] = [];
    const input = createOpenCodeRuntimeInput([]);
    input.executePromptCommand = async (commandInput) => {
      executedCommands.push(commandInput.text);
    };
    const runtime = buildOpenCodeConversationRuntime(input);

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "opencode.prompt.review",
      text: "/review check this",
    });

    expect(accepted).toBe(true);
    expect(executedCommands).toEqual(["/review check this"]);
  });

  it("rejects typed runtime commands outside the OpenCode prompt command namespace", () => {
    const reportedMessages: string[] = [];
    const executedCommands: string[] = [];
    const input = createOpenCodeRuntimeInput(reportedMessages);
    input.executePromptCommand = async (commandInput) => {
      executedCommands.push(commandInput.text);
    };
    const runtime = buildOpenCodeConversationRuntime(input);

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "codex.review",
      text: "/review check this",
    });

    expect(accepted).toBe(false);
    expect(executedCommands).toEqual([]);
    expect(reportedMessages).toEqual(["Unsupported OpenCode runtime command 'codex.review'."]);
  });
});

describe("buildPiConversationRuntime", () => {
  it("maps the active Pi conversation into the shared workbench contract", () => {
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    expect(runtime.displayName).toBe("Pi");
    expect(runtime.conversation.activeConversationId).toBe("pi-session");
    expect(runtime.conversation.attachmentTargetId).toBe(
      resolvePiAttachmentTargetId("pi-session.json"),
    );
    expect(runtime.conversation.attachmentTargetId).toMatch(/^pi_[a-z0-9]+_\d+$/);
    expect(runtime.conversation.chatState.activeTurnId).toBe("pi:user:1");
    expect(runtime.conversation.chatState.pendingTurnId).toBe("pi:user:1");
    expect(runtime.conversation.chatState.status).toBe("inProgress");
    expect(runtime.composerRuntimeInput.turnControl.activeTurnState).toBe("running");
    expect(runtime.composerRuntimeInput.turnControl.canSteer).toBe(true);
    expect(runtime.composerRuntimeInput.modelSelection).toEqual({
      required: false,
      showControls: true,
    });
  });

  it("uses a safe Pi attachment target for session file paths", () => {
    expect(resolvePiAttachmentTargetId("/root/.pi/agent/sessions/session.jsonl")).toMatch(
      /^pi_[a-z0-9]+_\d+$/,
    );
  });

  it("steers Pi with the submitted transcript prompt", async () => {
    const steeredPrompts: string[] = [];
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        reportedMessages: [],
        steeredPrompts,
      }),
    );

    await runtime.composerRuntimeInput.turnControl.steerTurn({
      submittedPrompt: "raw prompt",
      transcriptPrompt: "prompt with attachments",
      uploadedAttachments: [],
    });

    expect(steeredPrompts).toEqual(["prompt with attachments"]);
  });

  it("exposes Pi follow-up as a runtime-native queue turn", async () => {
    const queuedPrompts: string[] = [];
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        queuedPrompts,
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    await runtime.composerRuntimeInput.turnControl.queueTurn?.({
      submittedPrompt: "queued prompt",
      transcriptPrompt: "queued transcript",
      uploadedAttachments: [],
    });

    expect(queuedPrompts).toEqual(["queued transcript"]);
  });
});
