import type { ComposerCapability, ComposerCommandDescriptor } from "@mistle/integrations-core";

const SlashCommandQueryPattern = /^[a-z0-9-]*$/;
const WhitespacePattern = /\s/;

export type ActiveComposerTrigger = {
  capabilityKind: "composerCommand" | "contextMention";
  trigger: "/" | "@";
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
  if (input.selectionStart !== input.selectionEnd) {
    return null;
  }

  const contextMentionTrigger = detectContextMentionTrigger(input);
  if (contextMentionTrigger !== null) {
    return contextMentionTrigger;
  }

  return detectComposerCommandTrigger(input);
}

function detectComposerCommandTrigger(input: {
  composerCapabilities: readonly ComposerCapability[];
  composerText: string;
  selectionStart: number;
  selectionEnd: number;
}): ActiveComposerTrigger | null {
  if (!hasComposerCommandCapability(input.composerCapabilities)) {
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

function detectContextMentionTrigger(input: {
  composerCapabilities: readonly ComposerCapability[];
  composerText: string;
  selectionStart: number;
  selectionEnd: number;
}): ActiveComposerTrigger | null {
  if (!hasContextMentionCapability(input.composerCapabilities)) {
    return null;
  }

  const tokenRange = findWhitespaceDelimitedTokenRange({
    composerText: input.composerText,
    cursorIndex: input.selectionStart,
  });
  if (tokenRange === null) {
    return null;
  }

  const tokenText = input.composerText.slice(tokenRange.start, tokenRange.end);
  if (!tokenText.startsWith("@")) {
    return null;
  }

  return {
    capabilityKind: "contextMention",
    trigger: "@",
    query: input.composerText.slice(tokenRange.start + 1, input.selectionStart),
    range: tokenRange,
  };
}

export function readLeadingSlashCommandName(value: string): string | null {
  const trimmedText = value.trimStart();
  if (!trimmedText.startsWith("/")) {
    return null;
  }

  const commandTokenEnd = findCommandTokenEnd(trimmedText);
  return trimmedText.slice(1, commandTokenEnd);
}

export function listComposerCommands(
  composerCapabilities: readonly ComposerCapability[],
): readonly ComposerCommandDescriptor[] {
  return composerCapabilities.flatMap((capability) =>
    capability.kind === "composerCommand" ? capability.commands : [],
  );
}

export function hasComposerCommand(input: {
  composerCapabilities: readonly ComposerCapability[];
  commandId: string;
}): boolean {
  return input.composerCapabilities.some(
    (capability) =>
      capability.kind === "composerCommand" &&
      capability.commands.some((command) => command.id === input.commandId),
  );
}

function hasComposerCommandCapability(
  composerCapabilities: readonly ComposerCapability[],
): boolean {
  return composerCapabilities.some((capability) => capability.kind === "composerCommand");
}

function hasContextMentionCapability(composerCapabilities: readonly ComposerCapability[]): boolean {
  return composerCapabilities.some((capability) => capability.kind === "contextMention");
}

function findWhitespaceDelimitedTokenRange(input: {
  composerText: string;
  cursorIndex: number;
}): ActiveComposerTrigger["range"] | null {
  if (input.cursorIndex < 1 || input.cursorIndex > input.composerText.length) {
    return null;
  }
  if (WhitespacePattern.test(input.composerText.charAt(input.cursorIndex - 1))) {
    return null;
  }

  let start = input.cursorIndex - 1;
  while (start > 0 && !WhitespacePattern.test(input.composerText.charAt(start - 1))) {
    start -= 1;
  }

  let end = input.cursorIndex;
  while (
    end < input.composerText.length &&
    !WhitespacePattern.test(input.composerText.charAt(end))
  ) {
    end += 1;
  }

  return {
    start,
    end,
  };
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
