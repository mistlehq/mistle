import type { ComposerCapability, ComposerCommandDescriptor } from "@mistle/integrations-core";

const SlashCommandQueryPattern = /^[a-z0-9-]*$/;
const WhitespacePattern = /\s/;

export type ActiveComposerTrigger = {
  capabilityKind: "composerCommand";
  trigger: "/";
  query: string;
  range: {
    start: number;
    end: number;
  };
};

export function detectActiveComposerTrigger(input: {
  composerCapabilities: readonly ComposerCapability[];
  composerText: string;
  selectionStart: number;
  selectionEnd: number;
}): ActiveComposerTrigger | null {
  if (!hasComposerCommandCapability(input.composerCapabilities)) {
    return null;
  }

  if (input.selectionStart !== input.selectionEnd) {
    return null;
  }

  const cursorIndex = input.selectionStart;
  if (cursorIndex < 1 || cursorIndex > input.composerText.length) {
    return null;
  }

  if (!input.composerText.startsWith("/")) {
    return null;
  }

  const commandTokenEnd = findCommandTokenEnd(input.composerText);
  if (cursorIndex > commandTokenEnd) {
    return null;
  }

  const commandToken = input.composerText.slice(1, commandTokenEnd);
  if (!isSlashCommandQuery(commandToken)) {
    return null;
  }

  return {
    capabilityKind: "composerCommand",
    trigger: "/",
    query: input.composerText.slice(1, cursorIndex),
    range: {
      start: 0,
      end: commandTokenEnd,
    },
  };
}

export function listComposerCommands(
  composerCapabilities: readonly ComposerCapability[],
): readonly ComposerCommandDescriptor[] {
  return composerCapabilities.flatMap((capability) =>
    capability.kind === "composerCommand" ? capability.commands : [],
  );
}

function hasComposerCommandCapability(
  composerCapabilities: readonly ComposerCapability[],
): boolean {
  return composerCapabilities.some((capability) => capability.kind === "composerCommand");
}

function findCommandTokenEnd(composerText: string): number {
  for (let index = 1; index < composerText.length; index += 1) {
    if (WhitespacePattern.test(composerText.charAt(index))) {
      return index;
    }
  }

  return composerText.length;
}

function isSlashCommandQuery(commandToken: string): boolean {
  return SlashCommandQueryPattern.test(commandToken);
}
