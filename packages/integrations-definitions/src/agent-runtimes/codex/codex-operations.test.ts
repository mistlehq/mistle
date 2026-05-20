import { describe, expect, it } from "vitest";

import {
  buildCodexReviewStartRequest,
  buildCodexTurnInputItems,
  buildCodexTurnStartRequest,
  parseCodexThreadSessionResponse,
} from "./codex-operations.js";

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

  it("can request Plan collaboration mode with settings", () => {
    expect(
      buildCodexTurnStartRequest({
        threadId: "thread_123",
        input: [
          {
            type: "text",
            text: "Design the rollout",
          },
        ],
        collaborationMode: "plan",
        collaborationModeSettings: {
          model: "gpt-5.5",
          reasoningEffort: "medium",
          developerInstructions: null,
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      input: [
        {
          type: "text",
          text: "Design the rollout",
        },
      ],
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: "medium",
          developer_instructions: null,
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

  it("includes cwd when the caller supplies a turn working directory", () => {
    expect(
      buildCodexTurnStartRequest({
        threadId: "thread_123",
        cwd: "/root/acme/repo-2",
        input: [
          {
            type: "text",
            text: "Explain the repo",
          },
        ],
      }),
    ).toEqual({
      threadId: "thread_123",
      cwd: "/root/acme/repo-2",
      input: [
        {
          type: "text",
          text: "Explain the repo",
        },
      ],
    });
  });
});

describe("buildCodexReviewStartRequest", () => {
  it("preserves structured review targets and requests inline delivery", () => {
    expect(
      buildCodexReviewStartRequest({
        threadId: "thread_123",
        target: {
          type: "baseBranch",
          branch: "origin/main",
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      target: {
        type: "baseBranch",
        branch: "origin/main",
      },
      delivery: "inline",
    });
  });
});

describe("parseCodexThreadSessionResponse", () => {
  it("reads the live Codex session cwd from thread session responses", () => {
    expect(
      parseCodexThreadSessionResponse({
        method: "thread/resume",
        response: {
          thread: {
            id: "thread_123",
          },
          cwd: "/root/acme/repo-2",
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      cwd: "/root/acme/repo-2",
    });
  });

  it("rejects thread start responses that do not include the live Codex session cwd", () => {
    expect(() =>
      parseCodexThreadSessionResponse({
        method: "thread/start",
        response: {
          thread: {
            id: "thread_123",
          },
        },
      }),
    ).toThrow("thread/start response payload is invalid.");
  });
});
