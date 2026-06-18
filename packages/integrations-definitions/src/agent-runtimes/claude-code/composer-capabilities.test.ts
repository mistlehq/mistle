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
        {
          name: "db:migrate",
          description: "Run database migrations",
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
          {
            id: "claude-code.slash.db:migrate",
            name: "db:migrate",
            description: "Run database migrations",
            availability: {
              duringActiveTurn: "disabled",
            },
            submitAs: "typedRuntimeCommand",
          },
        ],
      },
    ]);
  });

  it("omits built-in management and interactive Claude Code slash commands from composer", () => {
    expect(shouldExposeClaudeCodeSlashCommand({ name: "compact" })).toBe(true);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "deploy" })).toBe(true);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "fix-issue" })).toBe(true);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "db:migrate" })).toBe(true);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "add-dir" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "cd" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "config" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "diff" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "exit" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "export" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "init" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "login" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "logout" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "model" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "permissions" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "debug" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "resume" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "rewind" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "terminal-setup" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "upgrade" })).toBe(false);
    expect(shouldExposeClaudeCodeSlashCommand({ name: "web-setup" })).toBe(false);

    expect(
      mapClaudeCodeSlashCommandsToComposerCapabilities([
        {
          name: "model",
          description: "Switch model",
        },
        {
          name: "cd",
          description: "Change directory",
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
