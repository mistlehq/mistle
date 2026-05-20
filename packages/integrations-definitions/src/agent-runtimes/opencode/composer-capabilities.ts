import type { ComposerCapability } from "@mistle/integrations-core";

import type { OpenCodeCommandSummary } from "./client.js";

const OpenCodePromptCommandIdPrefix = "opencode.prompt.";
const HiddenOpenCodePromptCommandNames = new Set(["customize-opencode"]);

export function buildOpenCodePromptCommandId(commandName: string): string {
  return `${OpenCodePromptCommandIdPrefix}${commandName}`;
}

export function shouldExposeOpenCodePromptCommand(command: OpenCodeCommandSummary): boolean {
  return !HiddenOpenCodePromptCommandNames.has(command.name);
}

export function mapOpenCodePromptCommandsToComposerCapabilities(
  commands: readonly OpenCodeCommandSummary[],
): readonly ComposerCapability[] {
  const visibleCommands = commands.filter(shouldExposeOpenCodePromptCommand);
  if (visibleCommands.length === 0) {
    return [];
  }

  return [
    {
      kind: "composerCommand",
      trigger: "/",
      source: "runtimeCommand",
      commands: visibleCommands.map((command) => ({
        id: buildOpenCodePromptCommandId(command.name),
        name: command.name,
        ...(command.description === undefined ? {} : { description: command.description }),
        availability: {
          duringActiveTurn: "disabled",
        },
        submitAs: "typedRuntimeCommand",
      })),
    },
  ];
}
