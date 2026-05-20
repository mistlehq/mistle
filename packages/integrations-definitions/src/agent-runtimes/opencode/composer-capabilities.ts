import type { ComposerCapability } from "@mistle/integrations-core";

import type { OpenCodeCommandSummary } from "./client.js";

const OpenCodePromptCommandIdPrefix = "opencode.prompt.";
const HiddenOpenCodePromptCommandNames = new Set(["customize-opencode"]);

type OpenCodePromptCommandDescriptor = Pick<OpenCodeCommandSummary, "description" | "name">;

export function buildOpenCodePromptCommandId(commandName: string): string {
  return `${OpenCodePromptCommandIdPrefix}${commandName}`;
}

export function isOpenCodePromptCommandId(commandId: string): boolean {
  return commandId.startsWith(OpenCodePromptCommandIdPrefix);
}

export function shouldExposeOpenCodePromptCommand(
  command: Pick<OpenCodeCommandSummary, "name">,
): boolean {
  return !HiddenOpenCodePromptCommandNames.has(command.name);
}

export function mapOpenCodePromptCommandsToComposerCapabilities(
  commands: readonly OpenCodePromptCommandDescriptor[],
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
