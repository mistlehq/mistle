import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { createInitialCodexChatState } from "./codex/session-state/codex-chat-state.js";
import { createInitialOpenCodeChatState } from "./opencode/session-state/opencode-chat-state.js";
import { createInitialPiChatState, type PiChatState } from "./pi/session-state/pi-chat-state.js";
import {
  buildClaudeCodeTurnStarter,
  buildCodexTurnStarter,
  buildOpenCodeTurnStarter,
  buildOpenCodeTurnSteerer,
  buildPiTurnQueuer,
  buildPiTurnStarter,
  shouldGenerateInitialSessionTitle,
} from "./session-workbench-turn-starters.js";

type OpenCodeSteerPromptInput = Parameters<
  Parameters<typeof buildOpenCodeTurnSteerer>[0]["chat"]["sendPrompt"]
>[0];

type OpenCodeStartPromptInput = Parameters<
  Parameters<typeof buildOpenCodeTurnStarter>[0]["chat"]["sendPrompt"]
>[0];

function failUnexpectedCall(operation: string): never {
  throw new Error(`Test should not ${operation}.`);
}

function createPiChatState(input?: { messages?: PiChatState["messages"] }): PiChatState {
  return {
    ...createInitialPiChatState(),
    messages: input?.messages ?? [],
    sessionFile: "/root/.pi/agent/sessions/session.jsonl",
    status: "idle",
  };
}

async function unusedEnsureTransportConnected(): Promise<never> {
  throw new Error("Test title generator should not connect to the sandbox.");
}

describe("shouldGenerateInitialSessionTitle", () => {
  it("generates an initial session title only for the first message while the title is unset", () => {
    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: "sbi_123",
        cachedTitle: null,
        messageCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: "sbi_123",
        cachedTitle: undefined,
        messageCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: "sbi_123",
        cachedTitle: "Existing title",
        messageCount: 0,
      }),
    ).toBe(false);

    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: "sbi_123",
        cachedTitle: null,
        messageCount: 1,
      }),
    ).toBe(false);

    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: null,
        cachedTitle: null,
        messageCount: 0,
      }),
    ).toBe(false);
  });
});

describe("buildCodexTurnStarter", () => {
  it("accepts explicit starts only after Codex records the turn", async () => {
    const events: string[] = [];
    const startTurn = buildCodexTurnStarter({
      cachedTitle: "Existing title",
      chat: {
        canInterruptTurn: true,
        canSteerTurn: false,
        chatState: createInitialCodexChatState(),
        dismissUserMessageAction: (actionId) => {
          failUnexpectedCall(`dismiss user message action ${actionId}`);
        },
        hasPendingFollowUp: false,
        hydrateChatFromThread: async () => {
          failUnexpectedCall("hydrate chat from thread");
        },
        interruptTurn: () => {
          failUnexpectedCall("interrupt turn");
        },
        isInterruptingTurn: false,
        isReloadingChat: false,
        isStartingTurn: false,
        isSteeringTurn: false,
        reloadChat: () => {
          failUnexpectedCall("reload chat");
        },
        startTurn: async () => {
          events.push("startTurn");
        },
        steerTurn: async () => {
          failUnexpectedCall("steer turn");
        },
      },
      ensureTransportConnected: unusedEnsureTransportConnected,
      queryClient: new QueryClient(),
      sandboxInstanceId: "sbi_test",
      selectedRepositoryPath: null,
    });

    await startTurn({
      onAccepted: () => {
        events.push("accepted");
      },
      submittedPrompt: "Review the diff",
      uploadedAttachments: [],
    });

    expect(events).toEqual(["startTurn", "accepted"]);
  });

  it("does not accept explicit starts when Codex rejects the turn", async () => {
    const events: string[] = [];
    const startTurn = buildCodexTurnStarter({
      cachedTitle: "Existing title",
      chat: {
        canInterruptTurn: true,
        canSteerTurn: false,
        chatState: createInitialCodexChatState(),
        dismissUserMessageAction: (actionId) => {
          failUnexpectedCall(`dismiss user message action ${actionId}`);
        },
        hasPendingFollowUp: false,
        hydrateChatFromThread: async () => {
          failUnexpectedCall("hydrate chat from thread");
        },
        interruptTurn: () => {
          failUnexpectedCall("interrupt turn");
        },
        isInterruptingTurn: false,
        isReloadingChat: false,
        isStartingTurn: false,
        isSteeringTurn: false,
        reloadChat: () => {
          failUnexpectedCall("reload chat");
        },
        startTurn: async () => {
          events.push("startTurn");
          throw new Error("Codex rejected the turn.");
        },
        steerTurn: async () => {
          failUnexpectedCall("steer turn");
        },
      },
      ensureTransportConnected: unusedEnsureTransportConnected,
      queryClient: new QueryClient(),
      sandboxInstanceId: "sbi_test",
      selectedRepositoryPath: null,
    });

    await expect(
      startTurn({
        onAccepted: () => {
          events.push("accepted");
        },
        submittedPrompt: "Review the diff",
        uploadedAttachments: [],
      }),
    ).rejects.toThrow("Codex rejected the turn.");
    expect(events).toEqual(["startTurn"]);
  });
});

describe("buildClaudeCodeTurnStarter", () => {
  it("passes explicit start acceptance through to Claude Code prompt submission", async () => {
    let acceptedCount = 0;
    const startTurn = buildClaudeCodeTurnStarter({
      chat: {
        sendPrompt: async (input) => {
          input.onAccepted?.();
        },
      },
    });

    await startTurn({
      onAccepted: () => {
        acceptedCount += 1;
      },
      submittedPrompt: "Review the diff",
      transcriptPrompt: "Review the transcript",
      uploadedAttachments: [],
    });

    expect(acceptedCount).toBe(1);
  });
});

describe("buildOpenCodeTurnStarter", () => {
  it("passes explicit start acceptance through to OpenCode prompt submission", async () => {
    const sentPrompts: OpenCodeStartPromptInput[] = [];
    let acceptedCount = 0;
    const startTurn = buildOpenCodeTurnStarter({
      cachedTitle: "Existing title",
      chat: {
        abortSession: async () => {
          failUnexpectedCall("abort OpenCode session");
        },
        canInterruptTurn: true,
        chatState: createInitialOpenCodeChatState(),
        hydrateChatFromSession: async () => {
          failUnexpectedCall("hydrate OpenCode chat from session");
        },
        hydrateChatFromSessionOrThrow: async () => {
          failUnexpectedCall("hydrate OpenCode chat from session or throw");
        },
        isHydratingChat: false,
        isInterruptingTurn: false,
        isRespondingToPermission: false,
        isStartingTurn: false,
        respondToPermission: async () => {
          failUnexpectedCall("respond to OpenCode permission");
        },
        sendPrompt: async (input) => {
          sentPrompts.push(input);
          input.onAccepted?.();
        },
        waitForGeneratedSessionTitle: async () => failUnexpectedCall("generate a session title"),
      },
      modelSelection: {
        hasExplicitModelSelection: false,
        selectedModel: null,
        selectedReasoningEffort: null,
      },
      queryClient: new QueryClient(),
      sandboxInstanceId: "sbi_test",
      selectedRepositoryPath: null,
    });

    await startTurn({
      onAccepted: () => {
        acceptedCount += 1;
      },
      submittedPrompt: "Review the diff",
      transcriptPrompt: "Review the transcript",
      uploadedAttachments: [],
    });

    expect(acceptedCount).toBe(1);
    expect(sentPrompts).toEqual([
      {
        onAccepted: sentPrompts[0]?.onAccepted,
        submittedAttachments: [],
        submittedPrompt: "Review the transcript",
      },
    ]);
  });
});

describe("buildPiTurnStarter", () => {
  it("passes explicit start acceptance through to Pi prompt submission", async () => {
    let acceptedCount = 0;
    const startTurn = buildPiTurnStarter({
      cachedTitle: "Existing title",
      chat: {
        chatState: createPiChatState(),
        sendPrompt: async (input) => {
          input.onAccepted?.();
        },
      },
      ensureTransportConnected: unusedEnsureTransportConnected,
      queryClient: new QueryClient(),
      sandboxInstanceId: "sbi_test",
      selectedRepositoryPath: null,
    });

    await startTurn({
      onAccepted: () => {
        acceptedCount += 1;
      },
      submittedPrompt: "Review the diff",
      uploadedAttachments: [],
    });

    expect(acceptedCount).toBe(1);
  });

  it("submits Pi prompts with uploaded attachments as Pi source file references", async () => {
    let submittedPrompt: string | null = null;
    const startTurn = buildPiTurnStarter({
      cachedTitle: "Existing title",
      chat: {
        chatState: createPiChatState(),
        sendPrompt: async (input) => {
          submittedPrompt = input.submittedPrompt;
        },
      },
      ensureTransportConnected: unusedEnsureTransportConnected,
      queryClient: new QueryClient(),
      sandboxInstanceId: "sbi_test",
      selectedRepositoryPath: null,
    });

    await startTurn({
      submittedPrompt:
        "Review this\n\nAttached files:\n- screen shot.png: /generic/attachment/text.png",
      transcriptPrompt: "Review this",
      uploadedAttachments: [
        {
          attachmentId: "att_image",
          kind: "image",
          threadId: "ses_test",
          originalFilename: "screen shot.png",
          mimeType: "image/png",
          sizeBytes: 12,
          path: "/root/.local/attachments/ses_test/screen shot.png",
        },
      ],
    });

    expect(submittedPrompt).toBe(
      'Review this\n\n<file name="/root/.local/attachments/ses_test/screen shot.png"></file>',
    );
  });

  it("generates the sandbox title only for the first Pi prompt when the sandbox title is unset", async () => {
    const generationInputs: string[] = [];
    const startTurn = buildPiTurnStarter({
      cachedTitle: null,
      chat: {
        chatState: createPiChatState(),
        sendPrompt: async () => {},
      },
      ensureTransportConnected: unusedEnsureTransportConnected,
      generateSessionTitle: async (input) => {
        generationInputs.push(input.messagePayload);
        return {
          id: input.sandboxInstanceId,
          title: "Customer Refund Review",
          updatedAt: "2026-05-20T00:00:00.000Z",
        };
      },
      queryClient: new QueryClient(),
      sandboxInstanceId: "sbi_test",
      selectedRepositoryPath: "/workspace/app",
    });

    await startTurn({
      submittedPrompt: "Review customer refund screenshots",
      transcriptPrompt: "Review customer refund",
      uploadedAttachments: [],
    });

    expect(generationInputs).toEqual(["Review customer refund"]);
  });

  it("does not seed the sandbox title after Pi already has messages", async () => {
    const generationInputs: string[] = [];
    const startTurn = buildPiTurnStarter({
      cachedTitle: null,
      chat: {
        chatState: createPiChatState({
          messages: [{ role: "user", content: "Existing message" }],
        }),
        sendPrompt: async () => {},
      },
      ensureTransportConnected: unusedEnsureTransportConnected,
      generateSessionTitle: async (input) => {
        generationInputs.push(input.messagePayload);
        return {
          id: input.sandboxInstanceId,
          title: "Second Prompt",
          updatedAt: "2026-05-20T00:00:00.000Z",
        };
      },
      queryClient: new QueryClient(),
      sandboxInstanceId: "sbi_test",
      selectedRepositoryPath: null,
    });

    await startTurn({
      submittedPrompt: "Second prompt",
      transcriptPrompt: "Second prompt",
      uploadedAttachments: [],
    });

    expect(generationInputs).toEqual([]);
  });
});

describe("buildOpenCodeTurnSteerer", () => {
  it("steers OpenCode with the selected repository, model, variant, transcript prompt, and attachments", async () => {
    const sentPrompts: OpenCodeSteerPromptInput[] = [];
    const steerTurn = buildOpenCodeTurnSteerer({
      chat: {
        sendPrompt: async (input) => {
          sentPrompts.push(input);
        },
      },
      modelSelection: {
        hasExplicitModelSelection: true,
        selectedModel: "openai/gpt-5",
        selectedReasoningEffort: "high",
      },
      selectedRepositoryPath: "/workspace/project",
    });

    await steerTurn({
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

    expect(sentPrompts).toEqual([
      {
        directory: "/workspace/project",
        model: {
          modelID: "gpt-5",
          providerID: "openai",
        },
        submittedPrompt: "Keep going\n\nAttached files:\n- notes.txt",
        submittedAttachments: [
          {
            type: "file",
            filename: "notes.txt",
            mime: "text/plain",
            url: "file:///tmp/mistle/uploads/notes.txt",
            source: {
              type: "file",
              path: "/tmp/mistle/uploads/notes.txt",
              text: {
                value: "@notes.txt",
                start: 0,
                end: 10,
              },
            },
          },
        ],
        variant: "high",
      },
    ]);
  });
});

describe("buildPiTurnQueuer", () => {
  it("submits Pi follow-ups with uploaded attachments as Pi source file references", async () => {
    let submittedPrompt: string | null = null;
    const queueTurn = buildPiTurnQueuer({
      chat: {
        followUpTurn: async (input) => {
          submittedPrompt = input.submittedPrompt;
        },
      },
    });

    await queueTurn({
      submittedPrompt: "Queue this",
      transcriptPrompt: "Queue this",
      uploadedAttachments: [
        {
          attachmentId: "att_file",
          kind: "file",
          threadId: "ses_test",
          originalFilename: "requirements.pdf",
          mimeType: "application/pdf",
          sizeBytes: 24,
          path: "/root/.local/attachments/ses_test/requirements.pdf",
        },
      ],
    });

    expect(submittedPrompt).toBe(
      'Queue this\n\n<file name="/root/.local/attachments/ses_test/requirements.pdf"></file>',
    );
  });
});
