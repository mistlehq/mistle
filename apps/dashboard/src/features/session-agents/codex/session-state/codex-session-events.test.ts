import { describe, expect, it } from "vitest";

import {
  parseThreadNameUpdate,
  parseThreadLifecycleEvent,
  parseThreadTokenUsageSnapshot,
  parseTurnDiffSnapshot,
  parseTurnPlanSnapshot,
} from "./codex-session-events.js";

describe("codex session event parsing", () => {
  it("parses thread lifecycle notifications", () => {
    expect(
      parseThreadLifecycleEvent({
        method: "thread/status/changed",
        params: {
          threadId: "thread_123",
          status: {
            value: "completed",
          },
        },
      }),
    ).toEqual({
      method: "thread/status/changed",
      threadId: "thread_123",
      statusJson: '{"value":"completed"}',
    });
  });

  it("parses turn diff notifications", () => {
    expect(
      parseTurnDiffSnapshot({
        method: "turn/diff/updated",
        params: {
          threadId: "thread_123",
          turnId: "turn_123",
          diff: "diff content",
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      turnId: "turn_123",
      diff: "diff content",
    });
  });

  it("parses turn plan notifications", () => {
    expect(
      parseTurnPlanSnapshot({
        method: "turn/plan/updated",
        params: {
          turnId: "turn_123",
          explanation: "Work through steps",
          plan: [
            { step: "Inspect files", status: "completed" },
            { step: "Apply patch", status: "in_progress" },
          ],
        },
      }),
    ).toEqual({
      turnId: "turn_123",
      explanation: "Work through steps",
      steps: [
        { step: "Inspect files", status: "completed" },
        { step: "Apply patch", status: "in_progress" },
      ],
    });
  });

  it("parses token usage notifications", () => {
    expect(
      parseThreadTokenUsageSnapshot({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread_123",
          turnId: "turn_123",
          tokenUsage: {
            total: {
              totalTokens: 120,
              inputTokens: 100,
              cachedInputTokens: 20,
              outputTokens: 20,
              reasoningOutputTokens: 10,
            },
            last: {
              totalTokens: 80,
              inputTokens: 70,
              cachedInputTokens: 10,
              outputTokens: 10,
              reasoningOutputTokens: 5,
            },
            modelContextWindow: 200_000,
          },
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      turnId: "turn_123",
      tokenUsage: {
        total: {
          totalTokens: 120,
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 20,
          reasoningOutputTokens: 10,
        },
        last: {
          totalTokens: 80,
          inputTokens: 70,
          cachedInputTokens: 10,
          outputTokens: 10,
          reasoningOutputTokens: 5,
        },
        modelContextWindow: 200_000,
      },
    });
  });

  it("parses thread name update notifications", () => {
    expect(
      parseThreadNameUpdate({
        method: "thread/name/updated",
        params: {
          threadId: "thread_123",
          name: "Renamed thread",
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      title: "Renamed thread",
    });
  });
});
