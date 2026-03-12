import { describe, expect, it } from "vitest";

import { createInitialCodexChatState, reduceCodexChatState } from "./codex-chat-state.js";

describe("reduceCodexChatState", () => {
  it("appends an optimistic user message when a turn starts locally", () => {
    const state = reduceCodexChatState(createInitialCodexChatState(), {
      type: "start_turn_requested",
      clientTurnId: "pending:turn_123",
      prompt: "Reply with exactly PHASE_2_OK.",
    });

    expect(state.activeTurnId).toBe("pending:turn_123");
    expect(state.pendingTurnId).toBe("pending:turn_123");
    expect(state.status).toBe("starting");
    expect(state.entries).toEqual([
      {
        id: "user:pending:turn_123",
        turnId: "pending:turn_123",
        kind: "user-message",
        text: "Reply with exactly PHASE_2_OK.",
        status: "completed",
      },
    ]);
  });

  it("reconciles the optimistic user message from the turn/start response", () => {
    const requested = reduceCodexChatState(createInitialCodexChatState(), {
      type: "start_turn_requested",
      clientTurnId: "pending:turn_123",
      prompt: "Reply with exactly PHASE_2_OK.",
    });

    const state = reduceCodexChatState(requested, {
      type: "turn_started_response",
      clientTurnId: "pending:turn_123",
      turnId: "turn_123",
      status: "inProgress",
    });

    expect(state.activeTurnId).toBe("turn_123");
    expect(state.pendingTurnId).toBeNull();
    expect(state.status).toBe("inProgress");
    expect(state.entries).toEqual([
      {
        id: "user:turn_123",
        turnId: "turn_123",
        kind: "user-message",
        text: "Reply with exactly PHASE_2_OK.",
        status: "completed",
      },
    ]);
  });

  it("removes the optimistic user message when turn start fails", () => {
    const requested = reduceCodexChatState(createInitialCodexChatState(), {
      type: "start_turn_requested",
      clientTurnId: "pending:turn_123",
      prompt: "Test prompt",
    });

    const failed = reduceCodexChatState(requested, {
      type: "start_turn_failed",
      clientTurnId: "pending:turn_123",
    });

    expect(failed.activeTurnId).toBeNull();
    expect(failed.pendingTurnId).toBeNull();
    expect(failed.status).toBeNull();
    expect(failed.entries).toEqual([]);
  });

  it("accumulates assistant deltas for the active turn", () => {
    const started = reduceCodexChatState(
      reduceCodexChatState(createInitialCodexChatState(), {
        type: "start_turn_requested",
        clientTurnId: "pending:turn_123",
        prompt: "Test prompt",
      }),
      {
        type: "turn_started_response",
        clientTurnId: "pending:turn_123",
        turnId: "turn_123",
        status: "inProgress",
      },
    );

    const afterFirstDelta = reduceCodexChatState(started, {
      type: "notification_received",
      notification: {
        method: "item/agentMessage/delta",
        params: {
          turnId: "turn_123",
          itemId: "msg_1",
          delta: "PHASE",
        },
      },
    });
    const afterSecondDelta = reduceCodexChatState(afterFirstDelta, {
      type: "notification_received",
      notification: {
        method: "item/agentMessage/delta",
        params: {
          turnId: "turn_123",
          itemId: "msg_1",
          delta: "_2_OK",
        },
      },
    });

    expect(afterSecondDelta.entries).toEqual([
      {
        id: "user:turn_123",
        turnId: "turn_123",
        kind: "user-message",
        text: "Test prompt",
        status: "completed",
      },
      {
        id: "msg_1",
        turnId: "turn_123",
        kind: "assistant-message",
        text: "PHASE_2_OK",
        phase: null,
        status: "streaming",
      },
    ]);
  });

  it("finalizes the assistant message from item/completed", () => {
    const started = reduceCodexChatState(
      reduceCodexChatState(createInitialCodexChatState(), {
        type: "start_turn_requested",
        clientTurnId: "pending:turn_123",
        prompt: "Test prompt",
      }),
      {
        type: "turn_started_response",
        clientTurnId: "pending:turn_123",
        turnId: "turn_123",
        status: "inProgress",
      },
    );
    const streaming = reduceCodexChatState(started, {
      type: "notification_received",
      notification: {
        method: "item/agentMessage/delta",
        params: {
          turnId: "turn_123",
          itemId: "msg_1",
          delta: "PHASE_2_OK",
        },
      },
    });

    const completed = reduceCodexChatState(streaming, {
      type: "notification_received",
      notification: {
        method: "item/completed",
        params: {
          turnId: "turn_123",
          item: {
            type: "agentMessage",
            id: "msg_1",
            text: "PHASE_2_OK",
            phase: "final_answer",
          },
        },
      },
    });

    expect(completed.entries).toEqual([
      {
        id: "user:turn_123",
        turnId: "turn_123",
        kind: "user-message",
        text: "Test prompt",
        status: "completed",
      },
      {
        id: "msg_1",
        turnId: "turn_123",
        kind: "assistant-message",
        text: "PHASE_2_OK",
        phase: "final_answer",
        status: "completed",
      },
    ]);
  });

  it("captures completed command execution items", () => {
    const started = reduceCodexChatState(
      reduceCodexChatState(createInitialCodexChatState(), {
        type: "start_turn_requested",
        clientTurnId: "pending:turn_123",
        prompt: "Run ls",
      }),
      {
        type: "turn_started_response",
        clientTurnId: "pending:turn_123",
        turnId: "turn_123",
        status: "inProgress",
      },
    );

    const completed = reduceCodexChatState(started, {
      type: "notification_received",
      notification: {
        method: "item/completed",
        params: {
          turnId: "turn_123",
          item: {
            type: "commandExecution",
            id: "cmd_1",
            command: "ls -la",
            aggregatedOutput: "file-a\nfile-b",
            cwd: "/workspace",
            exitCode: 0,
            status: "completed",
            reason: "Inspect repository contents",
          },
        },
      },
    });

    expect(completed.entries).toEqual([
      {
        id: "user:turn_123",
        turnId: "turn_123",
        kind: "user-message",
        text: "Run ls",
        status: "completed",
      },
      {
        id: "turn_123:running-commands:cmd_1",
        turnId: "turn_123",
        kind: "semantic-group",
        semanticKind: "running-commands",
        status: "completed",
        counts: null,
        items: [
          {
            id: "cmd_1",
            label: "Command",
            detail: "ls -la",
            detailKind: "code",
            command: "ls -la",
            output: "file-a\nfile-b",
            status: "completed",
          },
        ],
      },
    ]);
  });

  it("groups adjacent exploring command executions into one exploring transcript block", () => {
    const hydrated = reduceCodexChatState(createInitialCodexChatState(), {
      type: "hydrate_from_thread_read",
      turns: [
        {
          id: "turn_001",
          status: "completed",
          items: [
            {
              type: "userMessage",
              id: "user_1",
              content: [
                {
                  type: "text",
                  text: "Inspect the codebase",
                },
              ],
            },
            {
              type: "commandExecution",
              id: "cmd_1",
              command: "sed -n '1,120p' app.ts",
              aggregatedOutput: "export const App = () => null;",
              cwd: "/workspace",
              exitCode: 0,
              status: "completed",
              commandActions: [
                {
                  type: "read",
                  command: "sed -n '1,120p' app.ts",
                  name: "app.ts",
                  path: "app.ts",
                },
              ],
            },
            {
              type: "commandExecution",
              id: "cmd_2",
              command: "rg App src",
              aggregatedOutput: "src/app.ts",
              cwd: "/workspace",
              exitCode: 0,
              status: "completed",
              commandActions: [
                {
                  type: "search",
                  command: "rg App src",
                  query: "App",
                  path: "src",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(hydrated.entries).toEqual([
      {
        id: "user_1",
        turnId: "turn_001",
        kind: "user-message",
        text: "Inspect the codebase",
        status: "completed",
      },
      {
        id: "turn_001:exploring:cmd_1",
        turnId: "turn_001",
        kind: "semantic-group",
        semanticKind: "exploring",
        status: "completed",
        counts: {
          reads: 1,
          searches: 1,
          lists: 0,
        },
        items: [
          {
            id: "cmd_1",
            label: "Read",
            detail: "app.ts",
            detailKind: "code",
            command: "sed -n '1,120p' app.ts",
            output: "export const App = () => null;",
            status: "completed",
          },
          {
            id: "cmd_2",
            label: "Search",
            detail: "App",
            detailKind: "plain",
            command: "rg App src",
            output: "src/app.ts",
            status: "completed",
          },
        ],
      },
    ]);
  });

  it("groups adjacent reasoning items into one thinking transcript block", () => {
    const hydrated = reduceCodexChatState(createInitialCodexChatState(), {
      type: "hydrate_from_thread_read",
      turns: [
        {
          id: "turn_002",
          status: "completed",
          items: [
            {
              type: "userMessage",
              id: "user_2",
              content: [
                {
                  type: "text",
                  text: "Explain what changed",
                },
              ],
            },
            {
              type: "reasoning",
              id: "reasoning_1",
              summary: [{ type: "text", text: "Inspecting reducer behavior" }],
              content: [],
              status: "completed",
            },
            {
              type: "reasoning",
              id: "reasoning_2",
              summary: [],
              content: [{ type: "text", text: "Comparing grouped output to raw item order" }],
              status: "completed",
            },
          ],
        },
      ],
    });

    expect(hydrated.entries).toEqual([
      {
        id: "user_2",
        turnId: "turn_002",
        kind: "user-message",
        text: "Explain what changed",
        status: "completed",
      },
      {
        id: "turn_002:thinking:reasoning_1",
        turnId: "turn_002",
        kind: "semantic-group",
        semanticKind: "thinking",
        status: "completed",
        counts: null,
        items: [
          {
            id: "reasoning_1",
            label: "Thought",
            detail: "Inspecting reducer behavior",
            detailKind: "plain",
            command: null,
            output: null,
            status: "completed",
          },
          {
            id: "reasoning_2:content",
            label: "Thought",
            detail: "Comparing grouped output to raw item order",
            detailKind: "plain",
            command: null,
            output: null,
            status: "completed",
          },
        ],
      },
    ]);
  });

  it("updates completion status from turn/completed", () => {
    const started = reduceCodexChatState(
      reduceCodexChatState(createInitialCodexChatState(), {
        type: "start_turn_requested",
        clientTurnId: "pending:turn_123",
        prompt: "Test prompt",
      }),
      {
        type: "turn_started_response",
        clientTurnId: "pending:turn_123",
        turnId: "turn_123",
        status: "inProgress",
      },
    );

    const completed = reduceCodexChatState(started, {
      type: "notification_received",
      notification: {
        method: "turn/completed",
        params: {
          turn: {
            id: "turn_123",
            status: "completed",
            error: null,
          },
        },
      },
    });

    expect(completed.status).toBe("completed");
    expect(completed.completedStatus).toBe("completed");
    expect(completed.completedErrorMessage).toBeNull();
  });

  it("preserves prior turns when a new turn starts", () => {
    const firstTurnCompleted = reduceCodexChatState(
      reduceCodexChatState(
        reduceCodexChatState(createInitialCodexChatState(), {
          type: "start_turn_requested",
          clientTurnId: "pending:turn_001",
          prompt: "First prompt",
        }),
        {
          type: "turn_started_response",
          clientTurnId: "pending:turn_001",
          turnId: "turn_001",
          status: "inProgress",
        },
      ),
      {
        type: "notification_received",
        notification: {
          method: "turn/completed",
          params: {
            turn: {
              id: "turn_001",
              status: "completed",
              error: null,
            },
          },
        },
      },
    );

    const secondTurnStarted = reduceCodexChatState(firstTurnCompleted, {
      type: "start_turn_requested",
      clientTurnId: "pending:turn_002",
      prompt: "Second prompt",
    });

    expect(secondTurnStarted.activeTurnId).toBe("pending:turn_002");
    expect(secondTurnStarted.pendingTurnId).toBe("pending:turn_002");
    expect(secondTurnStarted.status).toBe("starting");
    expect(secondTurnStarted.completedStatus).toBeNull();
    expect(secondTurnStarted.entries).toEqual([
      {
        id: "user:turn_001",
        turnId: "turn_001",
        kind: "user-message",
        text: "First prompt",
        status: "completed",
      },
      {
        id: "user:pending:turn_002",
        turnId: "pending:turn_002",
        kind: "user-message",
        text: "Second prompt",
        status: "completed",
      },
    ]);
  });

  it("merges notifications that arrive before turn/start resolves into the real turn", () => {
    const requested = reduceCodexChatState(createInitialCodexChatState(), {
      type: "start_turn_requested",
      clientTurnId: "pending:turn_123",
      prompt: "Test prompt",
    });

    const bufferedDelta = reduceCodexChatState(requested, {
      type: "notification_received",
      notification: {
        method: "item/agentMessage/delta",
        params: {
          turnId: "turn_123",
          itemId: "msg_1",
          delta: "streamed early",
        },
      },
    });

    expect(bufferedDelta.entries).toEqual([
      {
        id: "user:pending:turn_123",
        turnId: "pending:turn_123",
        kind: "user-message",
        text: "Test prompt",
        status: "completed",
      },
      {
        id: "msg_1",
        turnId: "turn_123",
        kind: "assistant-message",
        text: "streamed early",
        phase: null,
        status: "streaming",
      },
    ]);

    const started = reduceCodexChatState(bufferedDelta, {
      type: "turn_started_response",
      clientTurnId: "pending:turn_123",
      turnId: "turn_123",
      status: "inProgress",
    });

    expect(started.entries).toEqual([
      {
        id: "user:turn_123",
        turnId: "turn_123",
        kind: "user-message",
        text: "Test prompt",
        status: "completed",
      },
      {
        id: "msg_1",
        turnId: "turn_123",
        kind: "assistant-message",
        text: "streamed early",
        phase: null,
        status: "streaming",
      },
    ]);
  });

  it("records canonical notifications for other turns additively", () => {
    const started = reduceCodexChatState(
      reduceCodexChatState(createInitialCodexChatState(), {
        type: "start_turn_requested",
        clientTurnId: "pending:turn_123",
        prompt: "Test prompt",
      }),
      {
        type: "turn_started_response",
        clientTurnId: "pending:turn_123",
        turnId: "turn_123",
        status: "inProgress",
      },
    );

    const updated = reduceCodexChatState(started, {
      type: "notification_received",
      notification: {
        method: "item/agentMessage/delta",
        params: {
          turnId: "turn_999",
          itemId: "msg_1",
          delta: "ignored",
        },
      },
    });

    expect(updated.activeTurnId).toBe("turn_999");
    expect(updated.entries).toEqual([
      {
        id: "user:turn_123",
        turnId: "turn_123",
        kind: "user-message",
        text: "Test prompt",
        status: "completed",
      },
      {
        id: "msg_1",
        turnId: "turn_999",
        kind: "assistant-message",
        text: "ignored",
        phase: null,
        status: "streaming",
      },
    ]);
  });

  it("hydrates chat entries from thread/read turns including command execution", () => {
    const hydrated = reduceCodexChatState(createInitialCodexChatState(), {
      type: "hydrate_from_thread_read",
      turns: [
        {
          id: "turn_001",
          status: "completed",
          items: [
            {
              type: "userMessage",
              id: "user_1",
              content: [
                {
                  type: "text",
                  text: "First prompt",
                },
              ],
            },
            {
              type: "reasoning",
              id: "reasoning_1",
              summary: ["**Preparing file list command**"],
            },
            {
              type: "commandExecution",
              id: "cmd_1",
              command: "pwd",
              aggregatedOutput: "/workspace",
              cwd: "/workspace",
              exitCode: 0,
              status: "completed",
            },
            {
              type: "agentMessage",
              id: "assistant_1",
              text: "First answer",
              phase: "final_answer",
            },
          ],
        },
      ],
    });

    expect(hydrated.entries).toEqual([
      {
        id: "user_1",
        turnId: "turn_001",
        kind: "user-message",
        text: "First prompt",
        status: "completed",
      },
      {
        id: "turn_001:thinking:reasoning_1",
        turnId: "turn_001",
        kind: "semantic-group",
        semanticKind: "thinking",
        status: "completed",
        counts: null,
        items: [
          {
            id: "reasoning_1",
            label: "Thought",
            detail: "**Preparing file list command**",
            detailKind: "plain",
            command: null,
            output: null,
            status: "completed",
          },
        ],
      },
      {
        id: "turn_001:running-commands:cmd_1",
        turnId: "turn_001",
        kind: "semantic-group",
        semanticKind: "running-commands",
        status: "completed",
        counts: null,
        items: [
          {
            id: "cmd_1",
            label: "Command",
            detail: "pwd",
            detailKind: "code",
            command: "pwd",
            output: "/workspace",
            status: "completed",
          },
        ],
      },
      {
        id: "assistant_1",
        turnId: "turn_001",
        kind: "assistant-message",
        text: "First answer",
        phase: "final_answer",
        status: "completed",
      },
    ]);
    expect(hydrated.activeTurnId).toBe("turn_001");
    expect(hydrated.completedStatus).toBe("completed");
  });

  it("streams reasoning summaries, reasoning text, and plans", () => {
    const started = reduceCodexChatState(createInitialCodexChatState(), {
      type: "notification_received",
      notification: {
        method: "turn/started",
        params: {
          turn: {
            id: "turn_123",
            status: "inProgress",
          },
        },
      },
    });

    const updated = reduceCodexChatState(
      reduceCodexChatState(
        reduceCodexChatState(
          reduceCodexChatState(started, {
            type: "notification_received",
            notification: {
              method: "item/reasoning/summaryTextDelta",
              params: {
                turnId: "turn_123",
                itemId: "reasoning_1",
                delta: "Inspect files",
              },
            },
          }),
          {
            type: "notification_received",
            notification: {
              method: "item/reasoning/summaryPartAdded",
              params: {
                turnId: "turn_123",
                itemId: "reasoning_1",
              },
            },
          },
        ),
        {
          type: "notification_received",
          notification: {
            method: "item/reasoning/textDelta",
            params: {
              turnId: "turn_123",
              itemId: "reasoning_1",
              delta: "Detailed chain",
            },
          },
        },
      ),
      {
        type: "notification_received",
        notification: {
          method: "item/plan/delta",
          params: {
            turnId: "turn_123",
            itemId: "plan_1",
            delta: "1. Inspect files",
          },
        },
      },
    );

    expect(updated.entries).toEqual([
      {
        id: "turn_123:thinking:reasoning_1",
        turnId: "turn_123",
        kind: "semantic-group",
        semanticKind: "thinking",
        status: "streaming",
        counts: null,
        items: [
          {
            id: "reasoning_1",
            label: "Thought",
            detail: "Inspect files",
            detailKind: "plain",
            command: null,
            output: null,
            status: "streaming",
          },
          {
            id: "reasoning_1:content",
            label: "Thought",
            detail: "Detailed chain",
            detailKind: "plain",
            command: null,
            output: null,
            status: "streaming",
          },
        ],
      },
      {
        id: "plan_1",
        turnId: "turn_123",
        kind: "plan",
        text: "1. Inspect files",
        status: "streaming",
      },
    ]);
  });

  it("streams command and file change output before completion", () => {
    const started = reduceCodexChatState(createInitialCodexChatState(), {
      type: "notification_received",
      notification: {
        method: "item/started",
        params: {
          turnId: "turn_123",
          item: {
            type: "commandExecution",
            id: "cmd_1",
            command: "ls -la",
            cwd: "/workspace",
            reason: "Inspect repository",
          },
        },
      },
    });

    const withCommandOutput = reduceCodexChatState(started, {
      type: "notification_received",
      notification: {
        method: "item/commandExecution/outputDelta",
        params: {
          turnId: "turn_123",
          itemId: "cmd_1",
          delta: "file-a\n",
        },
      },
    });

    const withFileChange = reduceCodexChatState(withCommandOutput, {
      type: "notification_received",
      notification: {
        method: "item/completed",
        params: {
          turnId: "turn_123",
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
        },
      },
    });

    expect(withFileChange.entries).toEqual([
      {
        id: "turn_123:running-commands:cmd_1",
        turnId: "turn_123",
        kind: "semantic-group",
        semanticKind: "running-commands",
        status: "streaming",
        counts: null,
        items: [
          {
            id: "cmd_1",
            label: "Command",
            detail: "ls -la",
            detailKind: "code",
            command: "ls -la",
            output: "file-a\n",
            status: "streaming",
          },
        ],
      },
      {
        id: "turn_123:making-edits:file_1",
        turnId: "turn_123",
        kind: "semantic-group",
        semanticKind: "making-edits",
        status: "completed",
        counts: null,
        items: [
          {
            id: "file_1",
            label: "Updated",
            detail: "src/app.ts",
            detailKind: "code",
            command: null,
            output: "Applied patch",
            status: "completed",
          },
        ],
      },
    ]);
  });

  it("surfaces generic completed items for unsupported transcript item types", () => {
    const state = reduceCodexChatState(createInitialCodexChatState(), {
      type: "notification_received",
      notification: {
        method: "item/completed",
        params: {
          turnId: "turn_123",
          item: {
            type: "dynamicToolCall",
            id: "tool_1",
            name: "custom_tool",
            status: "completed",
          },
        },
      },
    });

    expect(state.entries).toEqual([
      {
        id: "turn_123:tool-call:tool_1",
        turnId: "turn_123",
        kind: "semantic-group",
        semanticKind: "tool-call",
        status: "completed",
        counts: null,
        items: [
          {
            id: "tool_1",
            label: "dynamic",
            detail: "dynamic",
            detailKind: "plain",
            command: null,
            output: JSON.stringify(
              {
                type: "dynamicToolCall",
                id: "tool_1",
                name: "custom_tool",
                status: "completed",
              },
              null,
              2,
            ),
            status: "completed",
          },
        ],
      },
    ]);
  });

  it("does not surface raw userMessage items as generic transcript entries", () => {
    const state = reduceCodexChatState(createInitialCodexChatState(), {
      type: "notification_received",
      notification: {
        method: "item/completed",
        params: {
          turnId: "turn_123",
          item: {
            type: "userMessage",
            id: "user_1",
            content: [
              {
                type: "text",
                text: "what is in the files",
              },
            ],
          },
        },
      },
    });

    expect(state.entries).toEqual([]);
  });

  it("omits empty reasoning content arrays from transcript state", () => {
    const state = reduceCodexChatState(createInitialCodexChatState(), {
      type: "notification_received",
      notification: {
        method: "item/completed",
        params: {
          turnId: "turn_123",
          item: {
            type: "reasoning",
            id: "reasoning_1",
            content: [],
            summary: ["**Creating concise fantasy story**"],
          },
        },
      },
    });

    expect(state.entries).toEqual([
      {
        id: "turn_123:thinking:reasoning_1",
        turnId: "turn_123",
        kind: "semantic-group",
        semanticKind: "thinking",
        status: "completed",
        counts: null,
        items: [
          {
            id: "reasoning_1",
            label: "Thought",
            detail: "**Creating concise fantasy story**",
            detailKind: "plain",
            command: null,
            output: null,
            status: "completed",
          },
        ],
      },
    ]);
  });

  it("surfaces thinking when reasoning summary arrives as structured text parts", () => {
    const state = reduceCodexChatState(createInitialCodexChatState(), {
      type: "notification_received",
      notification: {
        method: "item/completed",
        params: {
          turnId: "turn_123",
          item: {
            type: "reasoning",
            id: "reasoning_1",
            content: [],
            summary: [
              {
                type: "text",
                text: "**Creating concise fantasy story**",
              },
            ],
          },
        },
      },
    });

    expect(state.entries).toEqual([
      {
        id: "turn_123:thinking:reasoning_1",
        turnId: "turn_123",
        kind: "semantic-group",
        semanticKind: "thinking",
        status: "completed",
        counts: null,
        items: [
          {
            id: "reasoning_1",
            label: "Thought",
            detail: "**Creating concise fantasy story**",
            detailKind: "plain",
            command: null,
            output: null,
            status: "completed",
          },
        ],
      },
    ]);
  });

  it("surfaces thinking when reasoning summary is nested under content", () => {
    const state = reduceCodexChatState(createInitialCodexChatState(), {
      type: "notification_received",
      notification: {
        method: "item/completed",
        params: {
          turnId: "turn_123",
          item: {
            type: "reasoning",
            id: "reasoning_1",
            content: [],
            summary: {
              content: [
                {
                  type: "text",
                  text: "**Creating concise fantasy story**",
                },
              ],
            },
          },
        },
      },
    });

    expect(state.entries).toEqual([
      {
        id: "turn_123:thinking:reasoning_1",
        turnId: "turn_123",
        kind: "semantic-group",
        semanticKind: "thinking",
        status: "completed",
        counts: null,
        items: [
          {
            id: "reasoning_1",
            label: "Thought",
            detail: "**Creating concise fantasy story**",
            detailKind: "plain",
            command: null,
            output: null,
            status: "completed",
          },
        ],
      },
    ]);
  });
});
