import { describe, expect, it } from "vitest";

import {
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
          promptTokens: 100,
        },
      }),
    ).toEqual({
      threadId: "thread_123",
      usageJson: '{"threadId":"thread_123","promptTokens":100}',
    });
  });
});
