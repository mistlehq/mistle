import { describe, expect, it } from "vitest";

import {
  buildCodexTurnTimeline,
  classifyCodexThreadItemSemantics,
  normalizeCodexThreadItem,
} from "./index.js";

describe("thread item semantics", () => {
  it("preserves command actions during normalization", () => {
    const items = normalizeCodexThreadItem({
      turnId: "turn_1",
      item: {
        type: "commandExecution",
        id: "cmd_1",
        command: "rg token src",
        cwd: "/workspace",
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
    });

    expect(items).toEqual([
      {
        kind: "command-execution",
        id: "cmd_1",
        turnId: "turn_1",
        command: "rg token src",
        cwd: "/workspace",
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

  it("classifies mixed exploratory and unknown command actions as running commands", () => {
    const normalizedItem = normalizeCodexThreadItem({
      turnId: "turn_1",
      item: {
        type: "commandExecution",
        id: "cmd_1",
        command: "rg token src && git status",
        cwd: "/workspace",
        status: "completed",
        commandActions: [
          {
            type: "search",
            command: "rg token src",
            query: "token",
            path: "src",
          },
          {
            type: "unknown",
            command: "git status",
          },
        ],
        aggregatedOutput: null,
        exitCode: 0,
        durationMs: 4,
      },
    })[0];

    if (normalizedItem === undefined) {
      throw new Error("Expected normalized item.");
    }

    expect(classifyCodexThreadItemSemantics(normalizedItem)).toMatchObject({
      semanticKind: "running-commands",
      displayKeys: {
        active: "running-commands.active",
        completed: "running-commands.done",
      },
    });
  });

  it("groups adjacent exploring command executions into one exploring block", () => {
    const timeline = buildCodexTurnTimeline({
      turn: {
        id: "turn_1",
        status: "inProgress",
        items: [
          {
            type: "commandExecution",
            id: "cmd_1",
            command: "sed -n '1,120p' app.ts",
            cwd: "/workspace",
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
            cwd: "/workspace",
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
    });

    expect(timeline).toEqual([
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
            cwd: "/workspace",
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
            cwd: "/workspace",
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

  it("groups adjacent reasoning items into one thinking block", () => {
    const timeline = buildCodexTurnTimeline({
      turn: {
        id: "turn_1",
        status: "completed",
        items: [
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
            status: "inProgress",
          },
        ],
      },
    });

    expect(timeline).toEqual([
      {
        id: "turn_1:thinking:reasoning_1",
        kind: "thinking",
        status: "streaming",
        displayKeys: {
          active: "thinking.active",
          completed: "thinking.done",
        },
        counts: null,
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
            kind: "reasoning",
            id: "reasoning_2:content",
            turnId: "turn_1",
            source: "content",
            text: "Comparing grouped output to raw item order",
            status: "streaming",
          },
        ],
      },
    ]);
  });
});
