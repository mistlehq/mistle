import { CodexRuntimeCommandIds } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { describe, expect, it } from "vitest";

import {
  buildCodexConversationRuntime,
  buildClaudeCodeConversationRuntime,
  buildOpenCodeConversationRuntime,
  buildPiConversationRuntime,
  resolvePiAttachmentTargetId,
} from "./session-workbench-conversation-runtimes.js";

type CodexRuntimeInput = Parameters<typeof buildCodexConversationRuntime>[0];
type ClaudeCodeRuntimeInput = Parameters<typeof buildClaudeCodeConversationRuntime>[0];
type OpenCodeRuntimeInput = Parameters<typeof buildOpenCodeConversationRuntime>[0];
type PiRuntimeInput = Parameters<typeof buildPiConversationRuntime>[0];
type PiExtensionUIResponseInput = Parameters<
  PiRuntimeInput["chat"]["respondToExtensionUIRequest"]
>[0];

const ReadyBootstrap: CodexRuntimeInput["bootstrap"] = {
  phase: { status: "ready" },
  isActiveThreadSynced: true,
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
    contextUsage: null,
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
    steerTurn: async () => {
      return;
    },
  };
}

function createClaudeCodeRuntimeInput(input: {
  activeSessionId?: string;
  chatSessionId?: string;
  contextUsage?: ClaudeCodeRuntimeInput["contextUsage"];
  isBusy?: boolean;
  pendingPermissions?: ClaudeCodeRuntimeInput["chat"]["chatState"]["pendingPermissions"];
  reportedMessages: string[];
  respondedPermissions?: Parameters<ClaudeCodeRuntimeInput["chat"]["respondToPermission"]>[0][];
  startedPrompts?: string[];
  steeredPrompts: string[];
}): ClaudeCodeRuntimeInput {
  return {
    bootstrap: ReadyBootstrap,
    chat: {
      interruptQuery: async () => {
        return;
      },
      canInterruptTurn: true,
      canSteerTurn: true,
      chatState: {
        completedErrorMessage: null,
        entries: [],
        pendingPermissions: input.pendingPermissions ?? [],
        pendingQueryId: input.isBusy === false ? null : "query_123",
        status: input.isBusy === false ? "idle" : "busy",
        sessionId: input.chatSessionId ?? "session_123",
        queries: [],
      },
      hydrateChatFromSessionOrThrow: async () => {
        return;
      },
      isInterruptingTurn: false,
      isRespondingToPermission: false,
      isStartingTurn: false,
      isSteeringTurn: false,
      respondToPermission: async (permissionInput) => {
        input.respondedPermissions?.push(permissionInput);
      },
      sendPrompt: async () => {
        return;
      },
      steerTurn: async (turnInput) => {
        input.steeredPrompts.push(turnInput.submittedPrompt);
      },
    },
    configControl: ComposerConfigControl,
    contextUsage: input.contextUsage ?? null,
    sessionMessage: {
      clearSessionErrorMessage: () => {
        return;
      },
      reportSessionErrorMessage: (message) => {
        input.reportedMessages.push(message);
      },
      sessionErrorMessage: null,
    },
    sessionSnapshot: {
      activeDirectory: null,
      activeSessionId: input.activeSessionId ?? "session_123",
      connectedAtIso: "2026-05-19T00:00:00.000Z",
      providerSessionId: null,
      sandboxInstanceId: "sandbox_123",
    },
    startTurn: async (turnInput) => {
      input.startedPrompts?.push(turnInput.transcriptPrompt ?? turnInput.submittedPrompt);
    },
    steerTurn: async (turnInput) => {
      input.steeredPrompts.push(turnInput.transcriptPrompt ?? turnInput.submittedPrompt);
    },
  };
}

function createPiRuntimeInput(input: {
  contextUsage?: PiRuntimeInput["contextUsage"];
  executedPromptCommands?: string[];
  isBusy?: boolean;
  pendingExtensionUIRequests?: PiRuntimeInput["chat"]["pendingExtensionUIRequests"];
  queuedPrompts?: string[];
  reportedMessages: string[];
  respondedExtensionUIRequests?: PiExtensionUIResponseInput[];
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
        status: input.isBusy === false ? null : "busy",
        streamingMessage: null,
      },
      confirmChatRestoredAfterReconnect: async () => {
        return;
      },
      isInterruptingTurn: false,
      isRespondingToExtensionUIRequest: false,
      isStartingTurn: false,
      isSteeringTurn: false,
      pendingExtensionUIRequests: input.pendingExtensionUIRequests ?? [],
      respondToExtensionUIRequest: async (responseInput) => {
        input.respondedExtensionUIRequests?.push(responseInput);
      },
      sendPrompt: async (turnInput) => {
        input.executedPromptCommands?.push(turnInput.submittedPrompt);
      },
      followUpTurn: async (turnInput) => {
        input.queuedPrompts?.push(turnInput.submittedPrompt);
      },
      steerTurn: async (turnInput) => {
        input.steeredPrompts.push(turnInput.submittedPrompt);
      },
    },
    configControl: ComposerConfigControl,
    contextUsage: input.contextUsage ?? null,
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
  it("exposes OpenCode active-turn steering when the session is busy", () => {
    const input = createOpenCodeRuntimeInput([]);
    input.chat.chatState.status = "busy";
    const runtime = buildOpenCodeConversationRuntime(input);

    expect(runtime.composerRuntimeInput.turnControl.activeTurnState).toBe("running");
    expect(runtime.composerRuntimeInput.turnControl.canSteer).toBe(true);
  });

  it("does not expose OpenCode steering when the session is idle", () => {
    const runtime = buildOpenCodeConversationRuntime(createOpenCodeRuntimeInput([]));

    expect(runtime.composerRuntimeInput.turnControl.activeTurnState).toBe("idle");
    expect(runtime.composerRuntimeInput.turnControl.canSteer).toBe(false);
  });

  it("routes OpenCode steering to the runtime-native steerer", async () => {
    const steeredPrompts: Parameters<OpenCodeRuntimeInput["steerTurn"]>[0][] = [];
    const input = createOpenCodeRuntimeInput([]);
    input.chat.chatState.status = "busy";
    input.steerTurn = async (turnInput) => {
      steeredPrompts.push(turnInput);
    };
    const runtime = buildOpenCodeConversationRuntime(input);

    await runtime.composerRuntimeInput.turnControl.steerTurn({
      submittedPrompt: "Keep going @notes.txt",
      transcriptPrompt: "Keep going\n\nAttached files:\n- notes.txt",
      uploadedAttachments: [
        {
          attachmentId: "attachment_1",
          kind: "file",
          mimeType: "text/plain",
          originalFilename: "notes.txt",
          path: "/tmp/mistle/uploads/notes.txt",
          sizeBytes: 123,
          threadId: "thread_1",
        },
      ],
    });

    expect(steeredPrompts).toEqual([
      {
        submittedPrompt: "Keep going @notes.txt",
        transcriptPrompt: "Keep going\n\nAttached files:\n- notes.txt",
        uploadedAttachments: [
          {
            attachmentId: "attachment_1",
            kind: "file",
            mimeType: "text/plain",
            originalFilename: "notes.txt",
            path: "/tmp/mistle/uploads/notes.txt",
            sizeBytes: 123,
            threadId: "thread_1",
          },
        ],
      },
    ]);
  });

  it("uses the OpenCode prompt request state as active-turn steering progress", () => {
    const input = createOpenCodeRuntimeInput([]);
    input.chat.chatState.status = "busy";
    input.chat.isStartingTurn = true;

    const runtime = buildOpenCodeConversationRuntime(input);

    expect(runtime.composerRuntimeInput.turnControl.isSteering).toBe(true);
  });

  it("does not expose runtime command execution", () => {
    const runtime = buildOpenCodeConversationRuntime(createOpenCodeRuntimeInput([]));

    expect("executeRuntimeCommand" in runtime.composerRuntimeInput).toBe(false);
  });

  it("exposes OpenCode context usage through the shared composer contract", () => {
    const input = createOpenCodeRuntimeInput([]);
    input.contextUsage = {
      label: "60% context left",
      title: "400 tokens used of 1,000 token context window.",
    };
    const runtime = buildOpenCodeConversationRuntime(input);

    expect(runtime.composerRuntimeInput.contextUsage).toEqual({
      label: "60% context left",
      title: "400 tokens used of 1,000 token context window.",
    });
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

describe("buildClaudeCodeConversationRuntime", () => {
  it("exposes Claude Code active-turn steering when the thread is busy", () => {
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    expect(runtime.composerRuntimeInput.turnControl.activeTurnState).toBe("running");
    expect(runtime.composerRuntimeInput.turnControl.canSteer).toBe(true);
  });

  it("does not expose Claude Code steering when the thread is idle", () => {
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        isBusy: false,
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    expect(runtime.composerRuntimeInput.turnControl.activeTurnState).toBe("idle");
    expect(runtime.composerRuntimeInput.turnControl.canSteer).toBe(false);
  });

  it("routes Claude Code steering to the runtime-native steerer", async () => {
    const steeredPrompts: string[] = [];
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        reportedMessages: [],
        steeredPrompts,
      }),
    );

    await runtime.composerRuntimeInput.turnControl.steerTurn({
      submittedPrompt: "Keep going",
      transcriptPrompt: "Keep going with context",
      uploadedAttachments: [],
    });

    expect(steeredPrompts).toEqual(["Keep going with context"]);
  });

  it("exposes Claude Code context window remaining through the shared composer contract", () => {
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        contextUsage: {
          label: "72% context left",
          title: "28,000 tokens used of 100,000 token context window.",
        },
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    expect(runtime.composerRuntimeInput.contextUsage).toEqual({
      label: "72% context left",
      title: "28,000 tokens used of 100,000 token context window.",
    });
  });

  it("routes Claude Code slash commands through normal turn start when idle", () => {
    const startedPrompts: string[] = [];
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        isBusy: false,
        reportedMessages: [],
        startedPrompts,
        steeredPrompts: [],
      }),
    );

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "claude-code.slash.review",
      text: "/review current changes",
    });

    expect(accepted).toBe(true);
    expect(startedPrompts).toEqual(["/review current changes"]);
  });

  it("routes Claude Code custom slash commands with arguments through normal turn start", () => {
    const startedPrompts: string[] = [];
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        isBusy: false,
        reportedMessages: [],
        startedPrompts,
        steeredPrompts: [],
      }),
    );

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "claude-code.slash.fix-issue",
      text: "/fix-issue 123 high",
    });
    const acceptedNamespaced = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "claude-code.slash.db:migrate",
      text: "/db:migrate production",
    });

    expect(accepted).toBe(true);
    expect(acceptedNamespaced).toBe(true);
    expect(startedPrompts).toEqual(["/fix-issue 123 high", "/db:migrate production"]);
  });

  it("rejects Claude Code slash commands while the session is busy", () => {
    const reportedMessages: string[] = [];
    const startedPrompts: string[] = [];
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        reportedMessages,
        startedPrompts,
        steeredPrompts: [],
      }),
    );

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "claude-code.slash.review",
      text: "/review current changes",
    });

    expect(accepted).toBe(false);
    expect(startedPrompts).toEqual([]);
    expect(reportedMessages).toEqual([
      "Claude Code slash commands are disabled while Claude Code is working.",
    ]);
  });

  it("rejects typed commands outside the Claude Code slash command namespace", () => {
    const reportedMessages: string[] = [];
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        isBusy: false,
        reportedMessages,
        steeredPrompts: [],
      }),
    );

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "opencode.prompt.review",
      text: "/review",
    });

    expect(accepted).toBe(false);
    expect(reportedMessages).toEqual([
      "Unsupported Claude Code runtime command 'opencode.prompt.review'.",
    ]);
  });

  it("exposes and responds to Claude Code permission requests", () => {
    const respondedPermissions: Parameters<
      ClaudeCodeRuntimeInput["chat"]["respondToPermission"]
    >[0][] = [];
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        pendingPermissions: [
          {
            id: "permission-1",
            sessionId: "session_123",
            toolName: "Bash",
            toolInput: {
              command: "pnpm test",
            },
          },
        ],
        reportedMessages: [],
        respondedPermissions,
        steeredPrompts: [],
      }),
    );

    expect(runtime.serverRequestsState.pendingServerRequests).toEqual([
      {
        requestId: "permission-1",
        method: "claude-code/permission/requestApproval",
        kind: "claude-code-permission",
        sessionId: "session_123",
        toolName: "Bash",
        toolInputJson: '{\n  "command": "pnpm test"\n}',
        availableDecisions: ["once", "reject"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);

    runtime.serverRequestsState.respondToServerRequest("permission-1", {
      decision: "once",
    });

    expect(respondedPermissions).toEqual([
      {
        requestId: "permission-1",
        decision: "once",
      },
    ]);
  });

  it("does not expose stale Claude Code permission requests from a previous session", () => {
    const runtime = buildClaudeCodeConversationRuntime(
      createClaudeCodeRuntimeInput({
        activeSessionId: "session_current",
        chatSessionId: "session_previous",
        pendingPermissions: [
          {
            id: "permission-stale",
            sessionId: "session_previous",
            toolName: "Bash",
            toolInput: {
              command: "pnpm test",
            },
          },
        ],
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    expect(runtime.serverRequestsState.pendingServerRequests).toEqual([]);
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

  it("exposes Pi context window remaining through the shared composer contract", () => {
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        contextUsage: {
          label: "60% context left",
          title: "40,000 tokens used of 100,000 token context window.",
        },
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    expect(runtime.composerRuntimeInput.contextUsage).toEqual({
      label: "60% context left",
      title: "40,000 tokens used of 100,000 token context window.",
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

  it("does not expose Pi steering when the conversation is idle", () => {
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        isBusy: false,
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    expect(runtime.composerRuntimeInput.turnControl.activeTurnState).toBe("idle");
    expect(runtime.composerRuntimeInput.turnControl.canSteer).toBe(false);
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

  it("queues Pi prompt and skill commands while a task is running", () => {
    const queuedPrompts: string[] = [];
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        queuedPrompts,
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "pi.prompt.review",
      text: "/review current changes",
    });

    expect(accepted).toBe(true);
    expect(queuedPrompts).toEqual(["/review current changes"]);
  });

  it("rejects Pi extension commands while a task is running", () => {
    const queuedPrompts: string[] = [];
    const reportedMessages: string[] = [];
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        queuedPrompts,
        reportedMessages,
        steeredPrompts: [],
      }),
    );

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "pi.extension.sync-linear",
      text: "/sync-linear",
    });

    expect(accepted).toBe(false);
    expect(queuedPrompts).toEqual([]);
    expect(reportedMessages).toEqual([
      "Pi extension commands are disabled while a task is in progress.",
    ]);
  });

  it("executes Pi commands through Pi prompt delivery when idle", () => {
    const executedPromptCommands: string[] = [];
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        executedPromptCommands,
        isBusy: false,
        reportedMessages: [],
        steeredPrompts: [],
      }),
    );

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "pi.extension.sync-linear",
      text: "/sync-linear",
    });

    expect(accepted).toBe(true);
    expect(executedPromptCommands).toEqual(["/sync-linear"]);
  });

  it("exposes and responds to pending Pi extension UI confirmations", () => {
    const respondedExtensionUIRequests: PiExtensionUIResponseInput[] = [];
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        isBusy: false,
        pendingExtensionUIRequests: [
          {
            type: "extension_ui_request",
            id: "ui_confirm_1",
            method: "confirm",
            title: "Run command?",
            message: "Allow Pi to run pnpm test?",
          },
        ],
        reportedMessages: [],
        respondedExtensionUIRequests,
        steeredPrompts: [],
      }),
    );

    expect(runtime.serverRequestsState.pendingServerRequests).toEqual([
      {
        requestId: "ui_confirm_1",
        method: "pi/extensionUi/confirm",
        kind: "pi-extension-ui-confirm",
        title: "Run command?",
        message: "Allow Pi to run pnpm test?",
        availableDecisions: ["confirm", "cancel"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);

    runtime.serverRequestsState.respondToServerRequest("ui_confirm_1", {
      decision: "confirm",
    });

    expect(respondedExtensionUIRequests).toEqual([
      {
        requestId: "ui_confirm_1",
        confirmed: true,
      },
    ]);
  });

  it("rejects typed commands outside the Pi command namespace", () => {
    const reportedMessages: string[] = [];
    const runtime = buildPiConversationRuntime(
      createPiRuntimeInput({
        reportedMessages,
        steeredPrompts: [],
      }),
    );

    const accepted = runtime.composerRuntimeInput.executeTypedRuntimeCommand?.({
      commandId: "opencode.prompt.review",
      text: "/review",
    });

    expect(accepted).toBe(false);
    expect(reportedMessages).toEqual(["Unsupported Pi runtime command 'opencode.prompt.review'."]);
  });
});
