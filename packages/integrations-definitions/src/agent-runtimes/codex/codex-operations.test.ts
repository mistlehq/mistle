import { describe, expect, it } from "vitest";

import {
  buildCodexReviewStartRequest,
  buildCodexTurnInputItems,
  buildCodexTurnStartRequest,
  parseCodexSkillsListResponse,
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

  it("places resolved skill input items after text and before attachments", () => {
    expect(
      buildCodexTurnInputItems({
        text: "  $grill-with-docs review this plan  ",
        skills: [
          {
            name: "grill-with-docs",
            description: "Stress test a plan against docs",
            sourcePath: "/home/.codex/skills/grill-with-docs/SKILL.md",
          },
        ],
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
        text: "$grill-with-docs review this plan",
      },
      {
        type: "skill",
        name: "grill-with-docs",
        path: "/home/.codex/skills/grill-with-docs/SKILL.md",
      },
      {
        type: "localImage",
        path: "/root/.local/attachments/thread_123/image.png",
      },
    ]);
  });

  it("emits one skill input item per distinct resolved skill path", () => {
    expect(
      buildCodexTurnInputItems({
        text: "$grill-with-docs $grill-with-docs $codex-review $grill-with-docs",
        skills: [
          {
            name: "grill-with-docs",
            description: "Stress test a plan against docs",
            sourcePath: "/home/.codex/skills/grill-with-docs/SKILL.md",
          },
          {
            name: "codex-review",
            description: "Review code changes",
            sourcePath: "/home/.codex/skills/codex-review/SKILL.md",
          },
        ],
        attachments: [],
      }),
    ).toEqual([
      {
        type: "text",
        text: "$grill-with-docs $grill-with-docs $codex-review $grill-with-docs",
      },
      {
        type: "skill",
        name: "grill-with-docs",
        path: "/home/.codex/skills/grill-with-docs/SKILL.md",
      },
      {
        type: "skill",
        name: "codex-review",
        path: "/home/.codex/skills/codex-review/SKILL.md",
      },
    ]);
  });

  it("leaves unresolved and duplicate skill names as text-only input", () => {
    expect(
      buildCodexTurnInputItems({
        text: "$missing $duplicate",
        skills: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/one/SKILL.md",
          },
          {
            name: "duplicate",
            sourcePath: "/workspace/.codex/skills/two/SKILL.md",
          },
        ],
        attachments: [],
      }),
    ).toEqual([
      {
        type: "text",
        text: "$missing $duplicate",
      },
    ]);
  });

  it("only resolves conservative whitespace-delimited skill tokens", () => {
    expect(
      buildCodexTurnInputItems({
        text: "$grill-with-docs, `$codex-review` $writing_sharpen $write-a-skill",
        skills: [
          {
            name: "grill-with-docs",
            sourcePath: "/home/.codex/skills/grill-with-docs/SKILL.md",
          },
          {
            name: "codex-review",
            sourcePath: "/home/.codex/skills/codex-review/SKILL.md",
          },
          {
            name: "writing_sharpen",
            sourcePath: "/home/.codex/skills/writing-sharpen/SKILL.md",
          },
          {
            name: "write-a-skill",
            sourcePath: "/home/.codex/skills/write-a-skill/SKILL.md",
          },
        ],
        attachments: [],
      }),
    ).toEqual([
      {
        type: "text",
        text: "$grill-with-docs, `$codex-review` $writing_sharpen $write-a-skill",
      },
      {
        type: "skill",
        name: "write-a-skill",
        path: "/home/.codex/skills/write-a-skill/SKILL.md",
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

describe("parseCodexSkillsListResponse", () => {
  it("reads enabled skill metadata from Codex app-server skills/list responses", () => {
    expect(
      parseCodexSkillsListResponse({
        data: [
          {
            cwd: "/repo",
            skills: [
              {
                name: "grill-with-docs",
                description: "Stress test a plan against docs",
                shortDescription: "Grill docs",
                interface: {
                  shortDescription: "Stress test docs",
                },
                path: "/home/.codex/skills/grill-with-docs/SKILL.md",
                scope: "user",
                enabled: true,
              },
            ],
            errors: [],
          },
        ],
      }),
    ).toEqual({
      data: [
        {
          cwd: "/repo",
          skills: [
            {
              name: "grill-with-docs",
              description: "Stress test a plan against docs",
              shortDescription: "Stress test docs",
              path: "/home/.codex/skills/grill-with-docs/SKILL.md",
              enabled: true,
            },
          ],
          errors: [],
        },
      ],
    });
  });

  it("rejects malformed skills/list responses", () => {
    expect(() =>
      parseCodexSkillsListResponse({
        data: [
          {
            cwd: "/repo",
            skills: [
              {
                name: "",
                description: "Missing a name",
                enabled: true,
              },
            ],
            errors: [],
          },
        ],
      }),
    ).toThrow("skills/list response payload is invalid.");
  });

  it("rejects skills/list entries without a skill path", () => {
    expect(() =>
      parseCodexSkillsListResponse({
        data: [
          {
            cwd: "/repo",
            skills: [
              {
                name: "grill-with-docs",
                description: "Stress test a plan against docs",
                enabled: true,
              },
            ],
            errors: [],
          },
        ],
      }),
    ).toThrow("skills/list response payload is invalid.");
  });
});
