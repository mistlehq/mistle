import type { ComposerCapability } from "@mistle/integrations-core";

import type { PiCommandSource, PiCommandSummary } from "./client.js";

const PiPromptCommandIdPrefix = "pi.prompt.";
const PiSkillCommandIdPrefix = "pi.skill.";
const PiExtensionCommandIdPrefix = "pi.extension.";

type PiCommandDescriptor = Pick<PiCommandSummary, "description" | "name" | "source">;

export function buildPiCommandId(command: Pick<PiCommandSummary, "name" | "source">): string {
  return `${resolvePiCommandIdPrefix(command.source)}${command.name}`;
}

export function readPiCommandSourceFromId(commandId: string): PiCommandSource | null {
  if (commandId.startsWith(PiPromptCommandIdPrefix)) {
    return "prompt";
  }

  if (commandId.startsWith(PiSkillCommandIdPrefix)) {
    return "skill";
  }

  if (commandId.startsWith(PiExtensionCommandIdPrefix)) {
    return "extension";
  }

  return null;
}

export function isPiCommandId(commandId: string): boolean {
  return readPiCommandSourceFromId(commandId) !== null;
}

export function mapPiCommandsToComposerCapabilities(
  commands: readonly PiCommandDescriptor[],
): readonly ComposerCapability[] {
  if (commands.length === 0) {
    return [];
  }

  return [
    {
      kind: "composerCommand",
      trigger: "/",
      source: "runtimeCommand",
      commands: commands.map((command) => ({
        id: buildPiCommandId(command),
        name: command.name,
        ...(command.description === undefined ? {} : { description: command.description }),
        availability: {
          duringActiveTurn: command.source === "extension" ? "disabled" : "enabled",
        },
        submitAs: "typedRuntimeCommand",
      })),
    },
  ];
}

function resolvePiCommandIdPrefix(source: PiCommandSource): string {
  switch (source) {
    case "extension":
      return PiExtensionCommandIdPrefix;
    case "prompt":
      return PiPromptCommandIdPrefix;
    case "skill":
      return PiSkillCommandIdPrefix;
  }
}
