import type { ComposerCapability } from "@mistle/integrations-core";

import type { ClaudeCodeCommandSummary } from "./client.js";

const ClaudeCodeSlashCommandIdPrefix = "claude-code.slash.";
const ClaudeCodeMcpPromptCommandNamePrefix = "mcp__";
const ExposedClaudeCodeBuiltInSlashCommandNames = new Set(["compact", "context", "plan", "review"]);
const HiddenClaudeCodeBuiltInSlashCommandNames = new Set([
  "add-dir",
  "advisor",
  "agents",
  "allowed-tools",
  "android",
  "app",
  "autofix-pr",
  "background",
  "bashes",
  "batch",
  "bg",
  "branch",
  "btw",
  "bug",
  "cd",
  "checkpoint",
  "chrome",
  "claude-api",
  "clear",
  "code-review",
  "color",
  "config",
  "continue",
  "copy",
  "cost",
  "debug",
  "deep-research",
  "desktop",
  "diff",
  "doctor",
  "effort",
  "exit",
  "export",
  "extra-usage",
  "fast",
  "feedback",
  "fewer-permission-prompts",
  "focus",
  "fork",
  "goal",
  "heapdump",
  "help",
  "hooks",
  "ide",
  "init",
  "insights",
  "install-github-app",
  "install-slack-app",
  "ios",
  "keybindings",
  "login",
  "logout",
  "loop",
  "mcp",
  "memory",
  "mobile",
  "model",
  "new",
  "passes",
  "permissions",
  "plugin",
  "powerup",
  "pr-comments",
  "privacy-settings",
  "proactive",
  "quit",
  "radio",
  "rc",
  "recap",
  "release-notes",
  "reload-plugins",
  "reload-skills",
  "remote-control",
  "remote-env",
  "rename",
  "reset",
  "resume",
  "rewind",
  "routines",
  "run",
  "run-skill-generator",
  "sandbox",
  "schedule",
  "scroll-speed",
  "security-review",
  "settings",
  "setup-bedrock",
  "setup-vertex",
  "share",
  "simplify",
  "skills",
  "stats",
  "status",
  "statusline",
  "stickers",
  "stop",
  "tasks",
  "team-onboarding",
  "teleport",
  "terminal-setup",
  "theme",
  "tp",
  "tui",
  "ultraplan",
  "ultrareview",
  "undo",
  "upgrade",
  "usage",
  "usage-credits",
  "verify",
  "vim",
  "voice",
  "web-setup",
  "workflows",
]);

type ClaudeCodeCommandDescriptor = Pick<ClaudeCodeCommandSummary, "description" | "name">;

export function buildClaudeCodeSlashCommandId(commandName: string): string {
  return `${ClaudeCodeSlashCommandIdPrefix}${commandName}`;
}

export function isClaudeCodeSlashCommandId(commandId: string): boolean {
  return commandId.startsWith(ClaudeCodeSlashCommandIdPrefix);
}

export function shouldExposeClaudeCodeSlashCommand(
  command: Pick<ClaudeCodeCommandSummary, "name">,
): boolean {
  if (ExposedClaudeCodeBuiltInSlashCommandNames.has(command.name)) {
    return true;
  }
  if (command.name.startsWith(ClaudeCodeMcpPromptCommandNamePrefix)) {
    return false;
  }
  return !HiddenClaudeCodeBuiltInSlashCommandNames.has(command.name);
}

export function mapClaudeCodeSlashCommandsToComposerCapabilities(
  commands: readonly ClaudeCodeCommandDescriptor[],
): readonly ComposerCapability[] {
  const visibleCommands = commands.filter(shouldExposeClaudeCodeSlashCommand);
  if (visibleCommands.length === 0) {
    return [];
  }

  return [
    {
      kind: "composerCommand",
      trigger: "/",
      source: "runtimeCommand",
      commands: visibleCommands.map((command) => ({
        id: buildClaudeCodeSlashCommandId(command.name),
        name: command.name,
        ...(command.description === null ? {} : { description: command.description }),
        availability: {
          duringActiveTurn: "disabled",
        },
        submitAs: "typedRuntimeCommand",
      })),
    },
  ];
}
