import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { createInitialPiChatState, type PiChatState } from "./pi/session-state/pi-chat-state.js";
import {
  buildPiTurnQueuer,
  buildPiTurnStarter,
  shouldGenerateInitialSessionTitle,
} from "./session-workbench-turn-starters.js";

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

describe("buildPiTurnStarter", () => {
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
