import { describe, expect, it } from "vitest";

import { buildCodexTurnInputItems, buildCodexTurnStartRequest } from "./codex-operations.js";

describe("buildCodexTurnInputItems", () => {
  it("prepends trimmed text ahead of local image items", () => {
    expect(
      buildCodexTurnInputItems({
        text: "  describe this screenshot  ",
        attachments: [
          {
            type: "localImage",
            path: "/root/.local/attachments/thread_123/image.png",
          },
        ],
      }),
    ).toEqual([
      {
        type: "text",
        text: "describe this screenshot",
      },
      {
        type: "localImage",
        path: "/root/.local/attachments/thread_123/image.png",
      },
    ]);
  });

  it("returns image-only turn inputs when no text is present", () => {
    expect(
      buildCodexTurnInputItems({
        text: "   ",
        attachments: [
          {
            type: "localImage",
            path: "/root/.local/attachments/thread_123/image.png",
          },
        ],
      }),
    ).toEqual([
      {
        type: "localImage",
        path: "/root/.local/attachments/thread_123/image.png",
      },
    ]);
  });

  it("rejects empty turn inputs", () => {
    expect(() =>
      buildCodexTurnInputItems({
        text: "   ",
        attachments: [],
      }),
    ).toThrow("Provide text or at least one attachment before starting a turn.");
  });
});

describe("buildCodexTurnStartRequest", () => {
  it("includes collaboration mode settings when developer instructions are supplied", () => {
    expect(
      buildCodexTurnStartRequest({
        threadId: "thread_123",
        input: [
          {
            type: "text",
            text: "Write a setup script",
          },
        ],
        collaborationModeSettings: {
          model: "gpt-5.5",
          reasoningEffort: "medium",
          developerInstructions: "You are Setup Assistant.",
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      input: [
        {
          type: "text",
          text: "Write a setup script",
        },
      ],
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: "medium",
          developer_instructions: "You are Setup Assistant.",
        },
      },
    });
  });

  it("omits collaboration mode settings for ordinary turns", () => {
    expect(
      buildCodexTurnStartRequest({
        threadId: "thread_123",
        input: [
          {
            type: "text",
            text: "Explain the repo",
          },
        ],
      }),
    ).toEqual({
      threadId: "thread_123",
      input: [
        {
          type: "text",
          text: "Explain the repo",
        },
      ],
    });
  });
});
