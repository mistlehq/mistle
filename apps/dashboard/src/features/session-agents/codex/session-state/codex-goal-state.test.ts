import type { CodexThreadGoal } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { describe, expect, it } from "vitest";

import {
  editedGoalStatus,
  formatCodexGoalStatus,
  parseCodexGoalCommand,
  parseThreadGoalClearedNotification,
  parseThreadGoalUpdatedNotification,
} from "./codex-goal-state.js";

describe("parseCodexGoalCommand", () => {
  it("recognizes only exact leading goal commands", () => {
    expect(parseCodexGoalCommand("/goal")).toEqual({
      status: "valid",
      command: { kind: "show" },
    });
    expect(parseCodexGoalCommand("/goal ship the feature")).toEqual({
      status: "valid",
      command: { kind: "setObjective", objective: "ship the feature" },
    });
    expect(parseCodexGoalCommand("/goal\tship the feature")).toEqual({
      status: "valid",
      command: { kind: "setObjective", objective: "ship the feature" },
    });
    expect(parseCodexGoalCommand("/goalie ship the feature")).toEqual({
      status: "notGoalCommand",
    });
  });

  it("recognizes goal subcommands case-insensitively", () => {
    expect(parseCodexGoalCommand("/goal CLEAR")).toEqual({
      status: "valid",
      command: { kind: "clear" },
    });
    expect(parseCodexGoalCommand("/goal Edit")).toEqual({
      status: "valid",
      command: { kind: "edit" },
    });
    expect(parseCodexGoalCommand("/goal pause")).toEqual({
      status: "valid",
      command: { kind: "setStatus", status: "paused" },
    });
    expect(parseCodexGoalCommand("/goal resume")).toEqual({
      status: "valid",
      command: { kind: "setStatus", status: "active" },
    });
  });

  it("rejects objectives over the Codex limit", () => {
    const result = parseCodexGoalCommand(`/goal ${"a".repeat(4_001)}`);

    expect(result).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("Goal objective is too long: 4,001 characters."),
    });
    expect(result).toMatchObject({
      status: "invalid",
      message: expect.stringContaining("Limit: 4,000 characters."),
    });
  });
});

describe("Codex goal notifications", () => {
  it("extracts goal updates and cleared thread ids", () => {
    const goal: CodexThreadGoal = {
      threadId: "thread_123",
      objective: "ship the feature",
      status: "active",
      tokenBudget: 10_000,
      tokensUsed: 1250,
      timeUsedSeconds: 90,
      createdAt: 1,
      updatedAt: 2,
    };

    expect(
      parseThreadGoalUpdatedNotification({
        method: "thread/goal/updated",
        params: { goal },
      }),
    ).toEqual(goal);
    expect(
      parseThreadGoalClearedNotification({
        method: "thread/goal/cleared",
        params: { threadId: "thread_123" },
      }),
    ).toBe("thread_123");
  });
});

describe("formatCodexGoalStatus", () => {
  it("formats active usage and full tooltip details", () => {
    expect(
      formatCodexGoalStatus({
        threadId: "thread_123",
        objective: "ship the feature",
        status: "active",
        tokenBudget: 10_000,
        tokensUsed: 1250,
        timeUsedSeconds: 90,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toEqual({
      label: "Pursuing goal (1.3K / 10K)",
      title: "Objective: ship the feature Time: 1m. Tokens: 1.3K/10K.",
    });
  });

  it("matches Codex TUI labels for stopped goal states", () => {
    const baseGoal: Omit<CodexThreadGoal, "status"> = {
      threadId: "thread_123",
      objective: "ship the feature",
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1,
      updatedAt: 2,
    };

    expect(formatCodexGoalStatus({ ...baseGoal, status: "paused" }).label).toBe(
      "Goal paused (/goal resume)",
    );
    expect(formatCodexGoalStatus({ ...baseGoal, status: "blocked" }).label).toBe(
      "Goal blocked (/goal resume)",
    );
    expect(formatCodexGoalStatus({ ...baseGoal, status: "usageLimited" }).label).toBe(
      "Goal hit usage limits (/goal resume)",
    );
    expect(
      formatCodexGoalStatus({
        ...baseGoal,
        status: "budgetLimited",
        tokenBudget: 10_000,
        tokensUsed: 12_500,
      }).label,
    ).toBe("Goal unmet (12.5K / 10K tokens)");
    expect(formatCodexGoalStatus({ ...baseGoal, status: "complete" }).label).toBe(
      "Goal achieved (0s)",
    );
  });

  it("keeps editable states while restarting terminal states", () => {
    expect(editedGoalStatus("active")).toBe("active");
    expect(editedGoalStatus("paused")).toBe("paused");
    expect(editedGoalStatus("budgetLimited")).toBe("active");
    expect(editedGoalStatus("complete")).toBe("active");
  });
});
