import { describe, expect, it } from "vitest";

import {
  buildStartTurnRequest,
  buildTextOnlyTurnRequest,
  resolveTurnCwdCommit,
} from "./use-codex-chat-controller.js";

describe("buildStartTurnRequest", () => {
  it("keeps the visible prompt text while adding structured skill input items", () => {
    expect(
      buildStartTurnRequest({
        submittedPrompt: "  $grill-with-docs check this plan  ",
        skills: [
          {
            name: "grill-with-docs",
            description: "Stress test a plan against docs",
            sourcePath: "/home/.codex/skills/grill-with-docs/SKILL.md",
          },
        ],
      }),
    ).toMatchObject({
      submittedPrompt: "$grill-with-docs check this plan",
      transcriptPrompt: "$grill-with-docs check this plan",
      items: [
        {
          type: "text",
          text: "$grill-with-docs check this plan",
        },
        {
          type: "skill",
          name: "grill-with-docs",
          path: "/home/.codex/skills/grill-with-docs/SKILL.md",
        },
      ],
    });
  });
});

describe("buildTextOnlyTurnRequest", () => {
  it("leaves skill-looking text unstructured by construction", () => {
    expect(
      buildTextOnlyTurnRequest({
        submittedPrompt: "$grill-with-docs check this plan",
      }),
    ).toMatchObject({
      submittedPrompt: "$grill-with-docs check this plan",
      transcriptPrompt: "$grill-with-docs check this plan",
      items: [
        {
          type: "text",
          text: "$grill-with-docs check this plan",
        },
      ],
    });
  });
});

describe("resolveTurnCwdCommit", () => {
  it("commits the turn cwd for the active thread when a cwd-scoped turn starts", () => {
    expect(
      resolveTurnCwdCommit({
        threadId: "thread_123",
        cwd: "/root/acme/repo-2",
      }),
    ).toEqual({
      threadId: "thread_123",
      cwd: "/root/acme/repo-2",
    });
  });

  it("does not commit a cwd update for turns without a cwd override", () => {
    expect(
      resolveTurnCwdCommit({
        threadId: "thread_123",
      }),
    ).toBeNull();
  });
});
