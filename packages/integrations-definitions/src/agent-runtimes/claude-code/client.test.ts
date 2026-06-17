import { describe, expect, it } from "vitest";

import { parseClaudeCodeSessionListResult, parseClaudeCodeSessionReadResult } from "./client.js";

describe("parseClaudeCodeSessionListResult", () => {
  it("preserves empty Claude Code session titles for the navigator display fallback", () => {
    expect(
      parseClaudeCodeSessionListResult({
        sessions: [
          {
            id: "ses_empty_title",
            title: "",
            cwd: null,
            createdAt: null,
            updatedAt: 100,
          },
        ],
      }),
    ).toEqual([
      {
        id: "ses_empty_title",
        title: "",
        cwd: null,
        createdAt: null,
        updatedAt: 100,
      },
    ]);
  });
});

describe("parseClaudeCodeSessionReadResult", () => {
  it("parses Claude Code model config and context usage for the composer", () => {
    expect(
      parseClaudeCodeSessionReadResult({
        session: {
          id: "session_123",
          cwd: "/workspace",
          status: {
            type: "idle",
          },
          activeQueryId: null,
          queries: [],
          lastError: null,
          config: {
            availableModels: [
              {
                model: "sonnet",
                displayName: "Claude Sonnet",
                defaultReasoningEffort: "high",
                reasoningEffortOptions: [{ value: "high", label: "High" }],
                inputModalities: ["text", "image"],
                isDefault: false,
              },
            ],
            model: "sonnet",
            modelReasoningEffort: "high",
          },
          contextUsage: {
            tokens: 28000,
            contextWindow: 100000,
            percent: 28,
          },
        },
      }),
    ).toEqual({
      session: {
        id: "session_123",
        cwd: "/workspace",
        status: {
          type: "idle",
        },
        activeQueryId: null,
        queries: [],
        lastError: null,
        config: {
          availableModels: [
            {
              model: "sonnet",
              displayName: "Claude Sonnet",
              defaultReasoningEffort: "high",
              reasoningEffortOptions: [{ value: "high", label: "High" }],
              inputModalities: ["text", "image"],
              isDefault: false,
            },
          ],
          model: "sonnet",
          modelReasoningEffort: "high",
        },
        contextUsage: {
          tokens: 28000,
          contextWindow: 100000,
          percent: 28,
        },
      },
    });
  });

  it("rejects Claude Code model config without reasoning effort options", () => {
    expect(() =>
      parseClaudeCodeSessionReadResult({
        session: {
          id: "session_123",
          cwd: "/workspace",
          status: {
            type: "idle",
          },
          activeQueryId: null,
          queries: [],
          lastError: null,
          config: {
            availableModels: [
              {
                model: "sonnet",
                displayName: "Claude Sonnet",
                defaultReasoningEffort: "high",
                inputModalities: ["text", "image"],
                isDefault: false,
              },
            ],
            model: "sonnet",
            modelReasoningEffort: "high",
          },
          contextUsage: null,
        },
      }),
    ).toThrow("Claude Code session config response included invalid reasoningEffortOptions.");
  });

  it("rejects Claude Code model config with invalid input modalities", () => {
    expect(() =>
      parseClaudeCodeSessionReadResult({
        session: {
          id: "session_123",
          cwd: "/workspace",
          status: {
            type: "idle",
          },
          activeQueryId: null,
          queries: [],
          lastError: null,
          config: {
            availableModels: [
              {
                model: "sonnet",
                displayName: "Claude Sonnet",
                defaultReasoningEffort: "high",
                reasoningEffortOptions: [{ value: "high", label: "High" }],
                inputModalities: ["text", 123],
                isDefault: false,
              },
            ],
            model: "sonnet",
            modelReasoningEffort: "high",
          },
          contextUsage: null,
        },
      }),
    ).toThrow("Claude Code session config response included invalid inputModalities.");
  });
});
