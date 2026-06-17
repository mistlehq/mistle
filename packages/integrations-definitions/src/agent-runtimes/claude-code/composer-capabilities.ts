import type { ComposerCapability } from "@mistle/integrations-core";

import type { ClaudeCodeCommandSummary } from "./client.js";

const ClaudeCodeSlashCommandIdPrefix = "claude-code.slash.";
const ExposedClaudeCodeSlashCommandNames = new Set(["compact", "context", "plan", "review"]);

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
  return ExposedClaudeCodeSlashCommandNames.has(command.name);
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
