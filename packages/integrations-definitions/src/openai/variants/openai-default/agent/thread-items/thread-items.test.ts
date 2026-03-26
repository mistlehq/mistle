import { describe, expect, it } from "vitest";

import {
  buildCodexThreadTimeline,
  buildCodexTurnTimeline,
  buildCodexTurnTimelineFromNormalized,
  classifyCodexThreadItemSemantics,
  normalizeCodexLocalImageAttachment,
  normalizeCodexThreadItem,
} from "./index.js";

function normalizeSingleItem(input: { turnId: string; item: unknown }) {
  const normalizedItem = normalizeCodexThreadItem(input)[0];
  if (normalizedItem === undefined) {
    throw new Error("Expected normalized item.");
  }

  return normalizedItem;
}

describe("openai thread item semantics", () => {
  it("normalizes local image attachment display metadata from a sandbox path", () => {
    expect(
      normalizeCodexLocalImageAttachment({
        path: "/tmp/attachments/thread_123/screenshot.png",
      }),
    ).toEqual({
      kind: "image",
      path: "/tmp/attachments/thread_123/screenshot.png",
      name: "screenshot.png",
    });
  });

  it("normalizes user messages, assistant messages, and plans", () => {
    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "userMessage",
          id: "user_1",
          content: [
            {
              type: "text",
              text: "Inspect the grouped timeline flow",
            },
          ],
        },
      }),
    ).toEqual([
      {
        kind: "user-message",
        id: "user_1",
        turnId: "turn_1",
        text: "Inspect the grouped timeline flow",
        attachments: [],
      },
    ]);

    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "agentMessage",
          id: "assistant_1",
          text: "Finished inspecting the reducer.",
          phase: "final_answer",
          status: "completed",
        },
      }),
    ).toEqual([
      {
        kind: "assistant-message",
        id: "assistant_1",
        turnId: "turn_1",
        text: "Finished inspecting the reducer.",
        phase: "final_answer",
        status: "completed",
      },
    ]);

    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "plan",
          id: "plan_1",
          text: "1. Inspect reducer",
          status: "completed",
        },
      }),
    ).toEqual([
      {
        kind: "plan",
        id: "plan_1",
        turnId: "turn_1",
        text: "1. Inspect reducer",
        status: "completed",
      },
    ]);
  });

  it("preserves local image attachments on user messages", () => {
    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "userMessage",
          id: "user_2",
          content: [
            {
              type: "text",
              text: "Review this screenshot",
            },
            {
              type: "localImage",
              path: "/tmp/attachments/thread_123/screenshot.png",
            },
          ],
        },
      }),
    ).toEqual([
      {
        kind: "user-message",
        id: "user_2",
        turnId: "turn_1",
        text: "Review this screenshot",
        attachments: [
          {
            kind: "image",
            path: "/tmp/attachments/thread_123/screenshot.png",
            name: "screenshot.png",
          },
        ],
      },
    ]);
  });

  it("normalizes reasoning summary and content into separate items", () => {
    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "reasoning",
          id: "reasoning_1",
          summary: [{ type: "text", text: "Inspecting reducer behavior" }],
          content: [{ type: "text", text: "Comparing grouped output to raw item order" }],
          status: "completed",
        },
      }),
    ).toEqual([
      {
        kind: "reasoning",
        id: "reasoning_1",
        turnId: "turn_1",
        source: "summary",
        text: "Inspecting reducer behavior",
        status: "completed",
      },
      {
        kind: "reasoning",
        id: "reasoning_1:content",
        turnId: "turn_1",
        source: "content",
        text: "Comparing grouped output to raw item order",
        status: "completed",
      },
    ]);
  });

  it("normalizes file changes, tool calls, and web searches", () => {
    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "fileChange",
          id: "file_1",
          changes: [
            {
              filePath: "src/app.ts",
              status: "update",
              patch: "@@ -1 +1 @@",
            },
          ],
          aggregatedOutput: "Applied patch",
          status: "completed",
        },
      }),
    ).toEqual([
      {
        kind: "file-change",
        id: "file_1",
        turnId: "turn_1",
        fileChangeStatus: "completed",
        changes: [
          {
            path: "src/app.ts",
            kind: "update",
            diff: "@@ -1 +1 @@",
          },
        ],
        output: "Applied patch",
        status: "completed",
      },
    ]);

    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "mcpToolCall",
          id: "tool_mcp_1",
          server: "github",
          tool: "review_pr",
          arguments: {
            prNumber: 421,
          },
          result: {},
          error: null,
          durationMs: 16,
          status: "completed",
        },
      }),
    ).toEqual([
      {
        kind: "tool-call",
        id: "tool_mcp_1",
        turnId: "turn_1",
        toolType: "mcp",
        title: "review_pr",
        body: null,
        detailsJson: JSON.stringify(
          {
            type: "mcpToolCall",
            id: "tool_mcp_1",
            server: "github",
            tool: "review_pr",
            arguments: {
              prNumber: 421,
            },
            result: {},
            error: null,
            durationMs: 16,
            status: "completed",
          },
          null,
          2,
        ),
        status: "completed",
      },
    ]);

    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "dynamicToolCall",
          id: "tool_dynamic_1",
          tool: "summarize_document",
          arguments: {
            path: "docs/spec.md",
          },
          contentItems: [],
          success: true,
          durationMs: 24,
          status: "completed",
        },
      }),
    ).toEqual([
      {
        kind: "tool-call",
        id: "tool_dynamic_1",
        turnId: "turn_1",
        toolType: "dynamic",
        title: "summarize_document",
        body: null,
        detailsJson: JSON.stringify(
          {
            type: "dynamicToolCall",
            id: "tool_dynamic_1",
            tool: "summarize_document",
            arguments: {
              path: "docs/spec.md",
            },
            contentItems: [],
            success: true,
            durationMs: 24,
            status: "completed",
          },
          null,
          2,
        ),
        status: "completed",
      },
    ]);

    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "collabAgentToolCall",
          id: "tool_collab_1",
          tool: "delegate_review",
          senderThreadId: "turn_1",
          receiverThreadIds: ["turn_2"],
          prompt: "Review the spec diff",
          agentsStates: [],
          status: "completed",
        },
      }),
    ).toEqual([
      {
        kind: "tool-call",
        id: "tool_collab_1",
        turnId: "turn_1",
        toolType: "collab",
        title: "delegate_review",
        body: "Review the spec diff",
        detailsJson: JSON.stringify(
          {
            type: "collabAgentToolCall",
            id: "tool_collab_1",
            tool: "delegate_review",
            senderThreadId: "turn_1",
            receiverThreadIds: ["turn_2"],
            prompt: "Review the spec diff",
            agentsStates: [],
            status: "completed",
          },
          null,
          2,
        ),
        status: "completed",
      },
    ]);

    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "webSearch",
          id: "search_1",
          query: "codex timeline ui",
          action: {},
        },
      }),
    ).toEqual([
      {
        kind: "web-search",
        id: "search_1",
        turnId: "turn_1",
        query: "codex timeline ui",
        detailsJson: JSON.stringify(
          {
            type: "webSearch",
            id: "search_1",
            query: "codex timeline ui",
            action: {},
          },
          null,
          2,
        ),
        status: "completed",
      },
    ]);
  });

  it("classifies exploring command sequences separately from command execution", () => {
    const exploring = classifyCodexThreadItemSemantics({
      kind: "command-execution",
      id: "cmd_explore",
      turnId: "turn_1",
      command: "sed -n '1,80p' reducer.ts",
      cwd: "/workspace",
      commandStatus: "completed",
      exitCode: 0,
      output: "contents",
      durationMs: 18,
      reason: null,
      status: "completed",
      commandActions: [
        {
          type: "read",
          command: "sed -n '1,80p' reducer.ts",
          name: "read reducer",
          path: "reducer.ts",
        },
      ],
    });

    expect(exploring.semanticKind).toBe("exploring");
    expect(exploring.summaryCounts).toEqual({
      reads: 1,
      searches: 0,
      lists: 0,
    });

    const commandExecution = classifyCodexThreadItemSemantics({
      kind: "command-execution",
      id: "cmd_exec",
      turnId: "turn_1",
      command: "pnpm test",
      cwd: "/workspace",
      commandStatus: "completed",
      exitCode: 0,
      output: "ok",
      durationMs: 42,
      reason: null,
      status: "completed",
      commandActions: [
        {
          type: "unknown",
          command: "pnpm test",
        },
      ],
    });

    expect(commandExecution.semanticKind).toBe("running-commands");
    expect(commandExecution.summaryCounts).toBeNull();
  });

  it("preserves command actions during normalization", () => {
    expect(
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "rg token src",
          cwd: "/home/sandbox",
          status: "completed",
          commandActions: [
            {
              type: "search",
              command: "rg token src",
              query: "token",
              path: "src",
            },
          ],
          aggregatedOutput: "src/app.ts",
          exitCode: 0,
          durationMs: 4,
        },
      }),
    ).toEqual([
      {
        kind: "command-execution",
        id: "cmd_1",
        turnId: "turn_1",
        command: "rg token src",
        cwd: "/home/sandbox",
        commandStatus: "completed",
        exitCode: 0,
        output: "src/app.ts",
        durationMs: 4,
        commandActions: [
          {
            type: "search",
            command: "rg token src",
            query: "token",
            path: "src",
          },
        ],
        reason: null,
        status: "completed",
      },
    ]);
  });

  it("maps raw transport statuses to streaming or completed during normalization", () => {
    expect(
      normalizeSingleItem({
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "cmd_streaming",
          command: "rg token src",
          cwd: "/home/sandbox",
          status: "inProgress",
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        },
      }),
    ).toMatchObject({
      kind: "command-execution",
      status: "streaming",
    });

    expect(
      normalizeSingleItem({
        turnId: "turn_1",
        item: {
          type: "fileChange",
          id: "file_failed",
          changes: [],
          status: "failed",
        },
      }),
    ).toMatchObject({
      kind: "file-change",
      status: "completed",
    });

    expect(
      normalizeSingleItem({
        turnId: "turn_1",
        item: {
          type: "mcpToolCall",
          id: "tool_declined",
          server: "github",
          tool: "review_pr",
          status: "declined",
        },
      }),
    ).toMatchObject({
      kind: "tool-call",
      status: "completed",
    });

    expect(
      normalizeSingleItem({
        turnId: "turn_1",
        item: {
          type: "agentMessage",
          id: "assistant_streaming",
          text: "Working...",
          status: "inProgress",
        },
      }),
    ).toMatchObject({
      kind: "assistant-message",
      status: "streaming",
    });

    expect(
      normalizeSingleItem({
        turnId: "turn_1",
        item: {
          type: "reasoning",
          id: "reasoning_streaming",
          summary: [{ type: "text", text: "Inspecting reducer behavior" }],
          content: [],
          status: "inProgress",
        },
      }),
    ).toMatchObject({
      kind: "reasoning",
      status: "streaming",
    });

    expect(
      normalizeSingleItem({
        turnId: "turn_1",
        item: {
          type: "webSearch",
          id: "web_streaming",
          query: "semantic grouping ui",
          action: null,
        },
      }),
    ).toMatchObject({
      kind: "web-search",
      status: "streaming",
    });
  });

  it("classifies concrete item kinds into their semantic groups", () => {
    expect(
      classifyCodexThreadItemSemantics(
        normalizeSingleItem({
          turnId: "turn_1",
          item: {
            type: "fileChange",
            id: "file_1",
            changes: [
              {
                path: "src/app.ts",
                kind: "update",
                diff: "@@ -1 +1 @@",
              },
            ],
            output: "Applied patch",
            status: "completed",
          },
        }),
      ),
    ).toMatchObject({
      semanticKind: "making-edits",
      displayKeys: {
        active: "making-edits.active",
        completed: "making-edits.done",
      },
    });

    expect(
      classifyCodexThreadItemSemantics(
        normalizeSingleItem({
          turnId: "turn_1",
          item: {
            type: "reasoning",
            id: "reasoning_1",
            summary: [{ type: "text", text: "Inspecting reducer behavior" }],
            content: [],
            status: "completed",
          },
        }),
      ),
    ).toMatchObject({
      semanticKind: "thinking",
      displayKeys: {
        active: "thinking.active",
        completed: "thinking.done",
      },
    });

    expect(
      classifyCodexThreadItemSemantics(
        normalizeSingleItem({
          turnId: "turn_1",
          item: {
            type: "webSearch",
            id: "web_1",
            query: "semantic grouping ui",
            action: {
              type: "search",
              query: "semantic grouping ui",
            },
          },
        }),
      ),
    ).toMatchObject({
      semanticKind: "searching-web",
      displayKeys: {
        active: "searching-web.active",
        completed: "searching-web.done",
      },
    });

    expect(
      classifyCodexThreadItemSemantics(
        normalizeSingleItem({
          turnId: "turn_1",
          item: {
            type: "dynamicToolCall",
            id: "tool_1",
            tool: "summarize_document",
            arguments: {
              path: "docs/spec.md",
            },
            contentItems: [],
            success: true,
            durationMs: 32,
            status: "completed",
          },
        }),
      ),
    ).toMatchObject({
      semanticKind: "tool-call",
      displayKeys: {
        active: "tool-call.active",
        completed: "tool-call.done",
      },
    });

    expect(
      classifyCodexThreadItemSemantics(
        normalizeSingleItem({
          turnId: "turn_1",
          item: {
            type: "customToolInvocation",
            id: "tool_future",
            name: "review_pr",
            status: "completed",
          },
        }),
      ),
    ).toMatchObject({
      semanticKind: "tool-call",
      displayKeys: {
        active: "tool-call.active",
        completed: "tool-call.done",
      },
    });
  });

  it("groups adjacent exploring items into a timeline group", () => {
    const timeline = buildCodexTurnTimelineFromNormalized({
      turnId: "turn_1",
      items: [
        {
          kind: "command-execution",
          id: "read_1",
          turnId: "turn_1",
          command: "cat src/a.ts",
          cwd: "/workspace",
          commandStatus: "completed",
          exitCode: 0,
          output: null,
          durationMs: 4,
          reason: null,
          status: "completed",
          commandActions: [
            {
              type: "read",
              command: "cat src/a.ts",
              name: "read a",
              path: "src/a.ts",
            },
          ],
        },
        {
          kind: "command-execution",
          id: "search_1",
          turnId: "turn_1",
          command: "rg reducer src",
          cwd: "/workspace",
          commandStatus: "completed",
          exitCode: 0,
          output: null,
          durationMs: 5,
          reason: null,
          status: "completed",
          commandActions: [
            {
              type: "search",
              command: "rg reducer src",
              query: "reducer",
              path: "src",
            },
          ],
        },
      ],
    });

    expect(timeline).toEqual([
      {
        id: "turn_1:exploring:read_1",
        kind: "exploring",
        status: "completed",
        displayKeys: {
          active: "exploring.active",
          completed: "exploring.done",
        },
        counts: {
          reads: 1,
          searches: 1,
          lists: 0,
        },
        items: [
          {
            kind: "command-execution",
            id: "read_1",
            turnId: "turn_1",
            command: "cat src/a.ts",
            cwd: "/workspace",
            commandStatus: "completed",
            exitCode: 0,
            output: null,
            durationMs: 4,
            reason: null,
            status: "completed",
            commandActions: [
              {
                type: "read",
                command: "cat src/a.ts",
                name: "read a",
                path: "src/a.ts",
              },
            ],
          },
          {
            kind: "command-execution",
            id: "search_1",
            turnId: "turn_1",
            command: "rg reducer src",
            cwd: "/workspace",
            commandStatus: "completed",
            exitCode: 0,
            output: null,
            durationMs: 5,
            reason: null,
            status: "completed",
            commandActions: [
              {
                type: "search",
                command: "rg reducer src",
                query: "reducer",
                path: "src",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("groups adjacent exploring command executions from a raw turn into one block", () => {
    expect(
      buildCodexTurnTimeline({
        turn: {
          id: "turn_1",
          status: "inProgress",
          items: [
            {
              type: "commandExecution",
              id: "cmd_1",
              command: "sed -n '1,120p' app.ts",
              cwd: "/home/sandbox",
              status: "completed",
              commandActions: [
                {
                  type: "read",
                  command: "sed -n '1,120p' app.ts",
                  name: "app.ts",
                  path: "app.ts",
                },
              ],
              aggregatedOutput: "export const App = () => null;",
              exitCode: 0,
              durationMs: 2,
            },
            {
              type: "commandExecution",
              id: "cmd_2",
              command: "rg App src",
              cwd: "/home/sandbox",
              status: "inProgress",
              commandActions: [
                {
                  type: "search",
                  command: "rg App src",
                  query: "App",
                  path: "src",
                },
              ],
              aggregatedOutput: null,
              exitCode: null,
              durationMs: null,
            },
          ],
        },
      }),
    ).toEqual([
      {
        id: "turn_1:exploring:cmd_1",
        kind: "exploring",
        status: "streaming",
        displayKeys: {
          active: "exploring.active",
          completed: "exploring.done",
        },
        counts: {
          reads: 1,
          searches: 1,
          lists: 0,
        },
        items: [
          {
            kind: "command-execution",
            id: "cmd_1",
            turnId: "turn_1",
            command: "sed -n '1,120p' app.ts",
            cwd: "/home/sandbox",
            commandStatus: "completed",
            exitCode: 0,
            output: "export const App = () => null;",
            durationMs: 2,
            commandActions: [
              {
                type: "read",
                command: "sed -n '1,120p' app.ts",
                name: "app.ts",
                path: "app.ts",
              },
            ],
            reason: null,
            status: "completed",
          },
          {
            kind: "command-execution",
            id: "cmd_2",
            turnId: "turn_1",
            command: "rg App src",
            cwd: "/home/sandbox",
            commandStatus: "inProgress",
            exitCode: null,
            output: null,
            durationMs: null,
            commandActions: [
              {
                type: "search",
                command: "rg App src",
                query: "App",
                path: "src",
              },
            ],
            reason: null,
            status: "streaming",
          },
        ],
      },
    ]);
  });

  it("builds timelines from turn and thread reads", () => {
    const turnTimeline = buildCodexTurnTimeline({
      turn: {
        id: "turn_1",
        status: "completed",
        items: [
          {
            type: "agentMessage",
            id: "assistant_1",
            text: "Done",
            status: "completed",
          },
        ],
      },
    });

    expect(turnTimeline).toEqual([
      {
        id: "assistant_1",
        item: {
          kind: "assistant-message",
          id: "assistant_1",
          turnId: "turn_1",
          text: "Done",
          phase: null,
          status: "completed",
        },
        semanticKind: "generic",
        status: "completed",
        displayKeys: {
          active: "generic.active",
          completed: null,
        },
      },
    ]);

    const threadTimeline = buildCodexThreadTimeline({
      turns: [
        {
          id: "turn_1",
          status: "completed",
          items: [
            {
              type: "plan",
              id: "plan_1",
              text: "Inspect reducer",
              status: "completed",
            },
          ],
        },
      ],
    });

    expect(threadTimeline).toEqual([
      {
        id: "plan_1",
        item: {
          kind: "plan",
          id: "plan_1",
          turnId: "turn_1",
          text: "Inspect reducer",
          status: "completed",
        },
        semanticKind: "generic",
        status: "completed",
        displayKeys: {
          active: "generic.active",
          completed: null,
        },
      },
    ]);
  });

  it("does not merge groups across turn boundaries", () => {
    const timeline = buildCodexThreadTimeline({
      turns: [
        {
          id: "turn_1",
          status: "completed",
          items: [
            {
              type: "commandExecution",
              id: "cmd_1",
              command: "rg semantic src",
              cwd: "/home/sandbox",
              status: "completed",
              commandActions: [
                {
                  type: "search",
                  command: "rg semantic src",
                  query: "semantic",
                  path: "src",
                },
              ],
              aggregatedOutput: "src/app.ts",
              exitCode: 0,
              durationMs: 3,
            },
          ],
        },
        {
          id: "turn_2",
          status: "completed",
          items: [
            {
              type: "commandExecution",
              id: "cmd_2",
              command: "rg grouping docs",
              cwd: "/home/sandbox",
              status: "completed",
              commandActions: [
                {
                  type: "search",
                  command: "rg grouping docs",
                  query: "grouping",
                  path: "docs",
                },
              ],
              aggregatedOutput: "docs/spec.md",
              exitCode: 0,
              durationMs: 4,
            },
          ],
        },
      ],
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ id: "turn_1:exploring:cmd_1", kind: "exploring" });
    expect(timeline[1]).toMatchObject({ id: "turn_2:exploring:cmd_2", kind: "exploring" });
  });

  it("breaks groups at semantic-kind boundaries", () => {
    const timeline = buildCodexTurnTimeline({
      turn: {
        id: "turn_1",
        status: "completed",
        items: [
          {
            type: "commandExecution",
            id: "cmd_1",
            command: "sed -n '1,40p' app.ts",
            cwd: "/home/sandbox",
            status: "completed",
            commandActions: [
              {
                type: "read",
                command: "sed -n '1,40p' app.ts",
                name: "app.ts",
                path: "app.ts",
              },
            ],
            aggregatedOutput: "export const App = () => null;",
            exitCode: 0,
            durationMs: 2,
          },
          {
            type: "fileChange",
            id: "file_1",
            changes: [
              {
                path: "src/app.ts",
                kind: "update",
                diff: "@@ -1 +1 @@",
              },
            ],
            output: "Applied patch",
            status: "completed",
          },
        ],
      },
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ id: "turn_1:exploring:cmd_1", kind: "exploring" });
    expect(timeline[1]).toMatchObject({ id: "turn_1:making-edits:file_1", kind: "making-edits" });
  });

  it("breaks groups when standalone items appear between groupable kinds", () => {
    const timeline = buildCodexTurnTimelineFromNormalized({
      turnId: "turn_1",
      items: [
        {
          kind: "reasoning",
          id: "reasoning_1",
          turnId: "turn_1",
          source: "summary",
          text: "Inspecting reducer behavior",
          status: "completed",
        },
        {
          kind: "plan",
          id: "plan_1",
          turnId: "turn_1",
          text: "1. Inspect reducer",
          status: "completed",
        },
        {
          kind: "reasoning",
          id: "reasoning_2",
          turnId: "turn_1",
          source: "content",
          text: "Comparing grouped output to raw item order",
          status: "completed",
        },
      ],
    });

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ id: "turn_1:thinking:reasoning_1", kind: "thinking" });
    expect(timeline[1]).toMatchObject({
      id: "plan_1",
      semanticKind: "generic",
      item: {
        kind: "plan",
      },
    });
    expect(timeline[2]).toMatchObject({ id: "turn_1:thinking:reasoning_2", kind: "thinking" });
  });

  it("breaks exploring groups across assistant-message boundaries", () => {
    const timeline = buildCodexTurnTimelineFromNormalized({
      turnId: "turn_1",
      items: [
        {
          kind: "command-execution",
          id: "cmd_1",
          turnId: "turn_1",
          command: "sed -n '1,40p' app.ts",
          cwd: "/home/sandbox",
          commandStatus: "completed",
          exitCode: 0,
          output: "export const App = () => null;",
          durationMs: 2,
          commandActions: [
            {
              type: "read",
              command: "sed -n '1,40p' app.ts",
              name: "app.ts",
              path: "app.ts",
            },
          ],
          reason: null,
          status: "completed",
        },
        {
          kind: "assistant-message",
          id: "assistant_1",
          turnId: "turn_1",
          text: "I found the relevant file.",
          phase: "analysis",
          status: "completed",
        },
        {
          kind: "command-execution",
          id: "cmd_2",
          turnId: "turn_1",
          command: "rg App src",
          cwd: "/home/sandbox",
          commandStatus: "completed",
          exitCode: 0,
          output: "src/app.ts",
          durationMs: 3,
          commandActions: [
            {
              type: "search",
              command: "rg App src",
              query: "App",
              path: "src",
            },
          ],
          reason: null,
          status: "completed",
        },
      ],
    });

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ id: "turn_1:exploring:cmd_1", kind: "exploring" });
    expect(timeline[1]).toMatchObject({
      id: "assistant_1",
      semanticKind: "generic",
      item: {
        kind: "assistant-message",
      },
    });
    expect(timeline[2]).toMatchObject({ id: "turn_1:exploring:cmd_2", kind: "exploring" });
  });

  it("breaks thinking groups across generic-item boundaries", () => {
    const timeline = buildCodexTurnTimelineFromNormalized({
      turnId: "turn_1",
      items: [
        {
          kind: "reasoning",
          id: "reasoning_1",
          turnId: "turn_1",
          source: "summary",
          text: "Inspecting reducer behavior",
          status: "completed",
        },
        {
          kind: "generic-item",
          id: "generic_1",
          turnId: "turn_1",
          itemType: "imageView",
          title: "imageView",
          body: null,
          detailsJson: '{"path":"diagram.png"}',
          status: "completed",
        },
        {
          kind: "reasoning",
          id: "reasoning_2",
          turnId: "turn_1",
          source: "content",
          text: "Comparing grouped output to raw item order",
          status: "completed",
        },
      ],
    });

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ id: "turn_1:thinking:reasoning_1", kind: "thinking" });
    expect(timeline[1]).toMatchObject({
      id: "generic_1",
      semanticKind: "generic",
      item: {
        kind: "generic-item",
      },
    });
    expect(timeline[2]).toMatchObject({ id: "turn_1:thinking:reasoning_2", kind: "thinking" });
  });

  it("throws for malformed thread items", () => {
    expect(() =>
      normalizeCodexThreadItem({
        turnId: "turn_1",
        item: null,
      }),
    ).toThrow("Thread item must be an object.");

    expect(() =>
      normalizeSingleItem({
        turnId: "turn_1",
        item: {
          type: "commandExecution",
          id: "cmd_1",
        },
      }),
    ).toThrow("Missing commandExecution status.");
  });
});
