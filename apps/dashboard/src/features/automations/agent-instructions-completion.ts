import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import type { AgentInstructionsEditorToken } from "./agent-instructions-token-catalog.js";

type ActiveTemplateTokenContext = {
  from: number;
  to: number;
  query: string;
};

function isTemplatePathCharacter(character: string): boolean {
  return /^[A-Za-z0-9_.]$/.test(character);
}

function resolveTemplateTokenContext(input: {
  documentText: string;
  cursorOffset: number;
}): ActiveTemplateTokenContext | null {
  const openingOffset = input.documentText.lastIndexOf("{{", input.cursorOffset);
  if (openingOffset < 0) {
    return null;
  }

  const closingBeforeCursor = input.documentText.indexOf("}}", openingOffset);
  if (closingBeforeCursor >= 0 && closingBeforeCursor < input.cursorOffset) {
    return null;
  }

  const query = input.documentText.slice(openingOffset + 2, input.cursorOffset);
  if (query.length > 0 && !/^[A-Za-z0-9_.]*$/.test(query)) {
    return null;
  }

  let replaceEnd = input.cursorOffset;
  while (replaceEnd < input.documentText.length) {
    const currentCharacter = input.documentText[replaceEnd] ?? "";
    if (currentCharacter === "}" && input.documentText[replaceEnd + 1] === "}") {
      replaceEnd += 2;
      break;
    }

    if (!isTemplatePathCharacter(currentCharacter)) {
      break;
    }

    replaceEnd += 1;
  }

  return {
    from: openingOffset,
    to: replaceEnd,
    query,
  };
}

function toCompletion(token: AgentInstructionsEditorToken): Completion {
  return {
    label: token.path,
    detail: token.label,
    ...(token.description === undefined ? {} : { info: token.description }),
    type: "variable",
    apply: token.insertText,
  };
}

export function completeAgentInstructionToken(
  context: CompletionContext,
  input: {
    tokens: readonly AgentInstructionsEditorToken[];
  },
): CompletionResult | null {
  const resolvedContext = resolveTemplateTokenContext({
    documentText: context.state.doc.toString(),
    cursorOffset: context.pos,
  });
  if (resolvedContext === null) {
    return null;
  }

  const query = resolvedContext.query.toLowerCase();
  const options = input.tokens
    .filter((token) => token.replacePath.toLowerCase().startsWith(query))
    .map(toCompletion);

  if (options.length === 0) {
    return null;
  }

  return {
    from: resolvedContext.from,
    to: resolvedContext.to,
    options,
    validFor: /^{{[A-Za-z0-9_.]*}?}?$/,
  };
}

export function resolveAgentInstructionTemplateQuery(input: {
  documentText: string;
  cursorOffset: number;
}): { from: number; to: number; query: string } | null {
  return resolveTemplateTokenContext(input);
}
