import { describe, expect, it } from "vitest";

import {
  buildClaudeCodeSlashCommandId,
  isClaudeCodeSlashCommandId,
  mapClaudeCodeSlashCommandsToComposerCapabilities,
  shouldExposeClaudeCodeSlashCommand,
} from "./composer-capabilities.js";

describe("Claude Code composer capabilities", () => {
  it("maps allowlisted Claude Code slash commands into typed runtime composer commands", () => {
    expect(
      mapClaudeCodeSlashCommandsToComposerCapabilities([
        {
          name: "compact",
          description: "Compact conversation history",
        },
        {
          name: "context",
          description: "Show context usage",
        },
        {
          name: "plan",
          description: "Plan before changing files",
        },
        {
          name: "review",
          description: "Review current changes",
        },
        {
          name: "model",
          description: null,
        },
      ]),
    ).toEqual([
      {
        kind: "composerCommand",
        trigger: "/",
        source: "runtimeCommand",
        commands: [
          {
            id: "claude-code.slash.compact",
            name: "compact",
            description: "Compact conversation history",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
          {
            id: "claude-code.slash.context",
            name: "context",
            description: "Show context usage",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
          {
            id: "claude-code.slash.plan",
            name: "plan",
            description: "Plan before changing files",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
          {
            id: "claude-code.slash.review",
            name: "review",
            description: "Review current changes",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
        ],
      },
    ]);
  });

  it("omits irrelevant and qualified Claude Code slash commands from composer", () => {
    expect(shouldExposeClaudeCodeSlashCommand({ name: "compact" })).toBe(true);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "model" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "apps/web:deploy" })).toBe(false);

    expect(
      mapClaudeCodeSlashCommandsToComposerCapabilities([
        {
          name: "model",
          description: "Switch model",
        },
        {
          name: "apps/web:deploy",
          description: "Deploy the web app",
        },
      ]),
    ).toEqual([]);
  });

  it("recognizes only Claude Code slash command ids", () => {
    expect(buildClaudeCodeSlashCommandId("review")).toBe("claude-code.slash.review");
    expect(isClaudeCodeSlashCommandId("claude-code.slash.review")).toBe(true);
    expect(isClaudeCodeSlashCommandId("opencode.prompt.review")).toBe(false);
  });
});
