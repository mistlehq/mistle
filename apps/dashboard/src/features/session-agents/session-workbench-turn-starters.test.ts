import { describe, expect, it } from "vitest";

import {
  buildPiTurnQueuer,
  buildPiTurnStarter,
  shouldGenerateInitialSessionTitle,
} from "./session-workbench-turn-starters.js";

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
      chat: {
        sendPrompt: async (input) => {
          submittedPrompt = input.submittedPrompt;
        },
      },
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
