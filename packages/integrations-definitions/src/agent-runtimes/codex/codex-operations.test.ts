import { describe, expect, it } from "vitest";

import {
  buildCodexReviewStartRequest,
  buildCodexTurnInputItems,
  buildCodexTurnStartRequest,
  parseCodexThreadListResponse,
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

  it("resolves selected duplicate-name skills by source path", () => {
    expect(
      buildCodexTurnInputItems({
        text: "$duplicate $duplicate",
        selectedSkillMentions: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/one/SKILL.md",
            range: { start: 0, end: "$duplicate".length },
          },
          {
            name: "duplicate",
            sourcePath: "/workspace/.codex/skills/two/SKILL.md",
            range: { start: "$duplicate ".length, end: "$duplicate $duplicate".length },
          },
        ],
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
        text: "$duplicate $duplicate",
      },
      {
        type: "skill",
        name: "duplicate",
        path: "/home/.codex/skills/one/SKILL.md",
      },
      {
        type: "skill",
        name: "duplicate",
        path: "/workspace/.codex/skills/two/SKILL.md",
      },
    ]);
  });

  it("dedupes repeated selected skill mentions by source path", () => {
    expect(
      buildCodexTurnInputItems({
        text: "$duplicate $duplicate",
        selectedSkillMentions: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/one/SKILL.md",
            range: { start: 0, end: "$duplicate".length },
          },
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/one/SKILL.md",
            range: { start: "$duplicate ".length, end: "$duplicate $duplicate".length },
          },
        ],
        skills: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/one/SKILL.md",
          },
        ],
        attachments: [],
      }),
    ).toEqual([
      {
        type: "text",
        text: "$duplicate $duplicate",
      },
      {
        type: "skill",
        name: "duplicate",
        path: "/home/.codex/skills/one/SKILL.md",
      },
    ]);
  });

  it("rejects stale selected skill paths", () => {
    expect(() =>
      buildCodexTurnInputItems({
        text: "$duplicate",
        selectedSkillMentions: [
          {
            name: "duplicate",
            sourcePath: "/stale/.codex/skills/duplicate/SKILL.md",
            range: { start: 0, end: "$duplicate".length },
          },
        ],
        skills: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/duplicate/SKILL.md",
          },
        ],
        attachments: [],
      }),
    ).toThrow('Selected skill "$duplicate" is no longer available.');
  });

  it("rejects selected skill mentions when the skill name changed at the same source path", () => {
    expect(() =>
      buildCodexTurnInputItems({
        text: "$duplicate",
        selectedSkillMentions: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/duplicate/SKILL.md",
            range: { start: 0, end: "$duplicate".length },
          },
        ],
        skills: [
          {
            name: "renamed",
            sourcePath: "/home/.codex/skills/duplicate/SKILL.md",
          },
        ],
        attachments: [],
      }),
    ).toThrow('Selected skill "$duplicate" has changed.');
  });

  it("rejects selected skill mentions that no longer match the submitted text range", () => {
    expect(() =>
      buildCodexTurnInputItems({
        text: "plain text $duplicate",
        selectedSkillMentions: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/duplicate/SKILL.md",
            range: { start: 0, end: "$duplicate".length },
          },
        ],
        skills: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/duplicate/SKILL.md",
          },
        ],
        attachments: [],
      }),
    ).toThrow('Selected skill "$duplicate" no longer matches the submitted text.');
  });

  it("rejects selected skill mentions that became part of a larger token", () => {
    expect(() =>
      buildCodexTurnInputItems({
        text: "$duplicatex",
        selectedSkillMentions: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/duplicate/SKILL.md",
            range: { start: 0, end: "$duplicate".length },
          },
        ],
        skills: [
          {
            name: "duplicate",
            sourcePath: "/home/.codex/skills/duplicate/SKILL.md",
          },
        ],
        attachments: [],
      }),
    ).toThrow('Selected skill "$duplicate" no longer matches the submitted text.');
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

describe("parseCodexThreadListResponse", () => {
  it("preserves Codex thread lineage metadata from thread list responses", () => {
    expect(
      parseCodexThreadListResponse({
        data: [
          {
            id: "thread_subagent",
            name: "Review sidebar hierarchy",
            preview: "Review the implementation",
            threadSource: "subagent",
            source: {
              subAgent: {
                thread_spawn: {
                  parent_thread_id: "thread_parent",
                  depth: 1,
                  agent_path: null,
                  agent_nickname: "atlas",
                  agent_role: "reviewer",
                },
              },
            },
            cwd: "/workspace/repo",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        nextCursor: "cursor_next",
      }),
    ).toEqual({
      threads: [
        {
          id: "thread_subagent",
          name: "Review sidebar hierarchy",
          preview: "Review the implementation",
          parentThreadId: "thread_parent",
          threadSource: "subagent",
          isSubagent: true,
          agentNickname: "atlas",
          agentRole: "reviewer",
          cwd: "/workspace/repo",
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
      nextCursor: "cursor_next",
    });
  });

  it("uses top-level Codex lineage fields while nested subagent source drives classification", () => {
    expect(
      parseCodexThreadListResponse({
        data: [
          {
            id: "thread_subagent",
            name: null,
            preview: undefined,
            parentThreadId: "thread_parent_current",
            threadSource: "memory_consolidation",
            agentNickname: "current-atlas",
            agentRole: "current-reviewer",
            source: {
              subAgent: {
                thread_spawn: {
                  parent_thread_id: "thread_parent_nested",
                  agent_nickname: "nested-atlas",
                  agent_role: "nested-reviewer",
                },
              },
            },
            cwd: "/workspace/repo",
          },
        ],
      }),
    ).toEqual({
      threads: [
        {
          id: "thread_subagent",
          name: null,
          preview: null,
          parentThreadId: "thread_parent_current",
          threadSource: "memory_consolidation",
          isSubagent: true,
          agentNickname: "current-atlas",
          agentRole: "current-reviewer",
          cwd: "/workspace/repo",
          createdAt: null,
          updatedAt: null,
        },
      ],
      nextCursor: null,
    });
  });

  it("marks non-thread-spawn Codex subagent source variants as subagent threads", () => {
    expect(
      parseCodexThreadListResponse({
        data: [
          {
            id: "thread_review",
            source: {
              subAgent: "review",
            },
            cwd: "/workspace/repo",
          },
          {
            id: "thread_other",
            source: {
              subAgent: {
                other: "custom",
              },
            },
            cwd: "/workspace/repo",
          },
        ],
      }),
    ).toEqual({
      threads: [
        {
          id: "thread_review",
          name: null,
          preview: null,
          parentThreadId: null,
          threadSource: "review",
          isSubagent: true,
          agentNickname: null,
          agentRole: null,
          cwd: "/workspace/repo",
          createdAt: null,
          updatedAt: null,
        },
        {
          id: "thread_other",
          name: null,
          preview: null,
          parentThreadId: null,
          threadSource: "custom",
          isSubagent: true,
          agentNickname: null,
          agentRole: null,
          cwd: "/workspace/repo",
          createdAt: null,
          updatedAt: null,
        },
      ],
      nextCursor: null,
    });
  });

  it("marks top-level memory-consolidation thread sources as subagent threads", () => {
    expect(
      parseCodexThreadListResponse({
        data: [
          {
            id: "thread_memory_consolidation",
            threadSource: "memory_consolidation",
            cwd: "/workspace/repo",
          },
        ],
      }),
    ).toEqual({
      threads: [
        {
          id: "thread_memory_consolidation",
          name: null,
          preview: null,
          parentThreadId: null,
          threadSource: "memory_consolidation",
          isSubagent: true,
          agentNickname: null,
          agentRole: null,
          cwd: "/workspace/repo",
          createdAt: null,
          updatedAt: null,
        },
      ],
      nextCursor: null,
    });
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
