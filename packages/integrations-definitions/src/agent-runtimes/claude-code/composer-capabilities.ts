import type { ComposerCapability } from "@mistle/integrations-core";

import type { ClaudeCodeCommandSummary } from "./client.js";

const ClaudeCodeSlashCommandIdPrefix = "claude-code.slash.";
const HiddenClaudeCodeSlashCommandNames = new Set([
  "agents",
  "clear",
  "cost",
  "debug",
  "doctor",
  "help",
  "hooks",
  "mcp",
  "memory",
  "model",
  "permissions",
  "plugin",
  "status",
  "usage",
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
  return !HiddenClaudeCodeSlashCommandNames.has(command.name) && !command.name.includes(":");
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
