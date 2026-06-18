import { describe, expect, it } from "vitest";

import {
  buildClaudeCodeSlashCommandId,
  isClaudeCodeSlashCommandId,
  mapClaudeCodeSlashCommandsToComposerCapabilities,
  shouldExposeClaudeCodeSlashCommand,
} from "./composer-capabilities.js";

describe("Claude Code composer capabilities", () => {
  it("maps supported and custom Claude Code slash commands into typed runtime composer commands", () => {
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
          name: "deploy",
          description: "Deploy the app",
        },
        {
          name: "fix-issue",
          description: "Fix a GitHub issue",
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
          {
            id: "claude-code.slash.deploy",
            name: "deploy",
            description: "Deploy the app",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
          {
            id: "claude-code.slash.fix-issue",
            name: "fix-issue",
            description: "Fix a GitHub issue",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
        ],
      },
    ]);
  });

  it("omits management, interactive, and qualified Claude Code slash commands from composer", () => {
    expect(shouldExposeClaudeCodeSlashCommand({ name: "compact" })).toBe(true);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "deploy" })).toBe(true);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "fix-issue" })).toBe(true);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "model" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "permissions" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "debug" })).toBe(false);
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
        {
          name: "debug",
          description: "Debug failures",
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
