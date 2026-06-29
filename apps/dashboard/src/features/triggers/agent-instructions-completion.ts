import {
  insertCompletionText,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import type {
  AgentInstructionsEditorToken,
  AgentInstructionsResourceReference,
} from "./agent-instructions-token-catalog.js";

type ActiveTemplateTokenContext = {
  from: number;
  to: number;
  query: string;
};

type ActiveResourceReferenceContext = {
  from: number;
  to: number;
  query: string;
};

export type AgentInstructionsResourceReferenceLoader = (input: {
  query: string;
  signal: AbortSignal;
}) => Promise<readonly AgentInstructionsResourceReference[]>;

function isTemplatePathCharacter(character: string): boolean {
  return /^[A-Za-z0-9_.]$/.test(character);
}

function isResourceReferenceQueryCharacter(character: string): boolean {
  return /^[^\s@{}()[\]]$/.test(character);
}

export function resolveTemplateTokenContext(input: {
  documentText: string;
  cursorOffset: number;
}): ActiveTemplateTokenContext | null {
  const openingOffset = input.documentText.lastIndexOf("{{", input.cursorOffset);
  if (openingOffset < 0) {
    return null;
  }

  if (input.cursorOffset < openingOffset + 2) {
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
  let hasTrailingPathCharacters = false;
  while (replaceEnd < input.documentText.length) {
    const currentCharacter = input.documentText[replaceEnd] ?? "";
    if (currentCharacter === "}" && input.documentText[replaceEnd + 1] === "}") {
      break;
    }

    if (!isTemplatePathCharacter(currentCharacter)) {
      break;
    }

    hasTrailingPathCharacters = true;
    replaceEnd += 1;
  }

  if (hasTrailingPathCharacters) {
    return null;
  }

  return {
    from: openingOffset + 2,
    to: replaceEnd,
    query,
  };
}

export function applyAgentInstructionCompletion(
  view: EditorView,
  path: string,
  from: number,
  to: number,
): void {
  const insertTransaction = insertCompletionText(view.state, path, from, to);
  view.dispatch(insertTransaction);
}

export function resolveResourceReferenceContext(input: {
  documentText: string;
  cursorOffset: number;
}): ActiveResourceReferenceContext | null {
  const prefixText = input.documentText.slice(0, input.cursorOffset);
  const match = /(^|\s)@([^\s@{}()[\]]*)$/.exec(prefixText);
  if (match === null) {
    return null;
  }

  const matchedText = match[0];
  const query = match[2] ?? "";
  const atOffset = input.cursorOffset - matchedText.length + (matchedText.startsWith("@") ? 0 : 1);

  let replaceEnd = input.cursorOffset;
  while (replaceEnd < input.documentText.length) {
    const currentCharacter = input.documentText[replaceEnd] ?? "";
    if (!isResourceReferenceQueryCharacter(currentCharacter)) {
      break;
    }

    replaceEnd += 1;
  }

  return {
    from: atOffset,
    to: replaceEnd,
    query,
  };
}

function compareMatchingTokens(
  left: AgentInstructionsEditorToken,
  right: AgentInstructionsEditorToken,
): number {
  const leftSegmentCount = left.path.split(".").length;
  const rightSegmentCount = right.path.split(".").length;
  if (leftSegmentCount !== rightSegmentCount) {
    return leftSegmentCount - rightSegmentCount;
  }

  const leftPathLength = left.path.length;
  const rightPathLength = right.path.length;
  if (leftPathLength !== rightPathLength) {
    return leftPathLength - rightPathLength;
  }

  return left.path.localeCompare(right.path);
}

export function rankAgentInstructionTokensForMatching(
  tokens: readonly AgentInstructionsEditorToken[],
): readonly AgentInstructionsEditorToken[] {
  return [...tokens].sort(compareMatchingTokens);
}

export function findMatchingAgentInstructionTokens(input: {
  query: string;
  tokens: readonly AgentInstructionsEditorToken[];
}): readonly AgentInstructionsEditorToken[] {
  const normalizedQuery = input.query.toLowerCase();

  return input.tokens.filter((token) =>
    token.replacePath.toLowerCase().startsWith(normalizedQuery),
  );
}

export function findMatchingAgentInstructionResourceReferences(input: {
  query: string;
  resourceReferences: readonly AgentInstructionsResourceReference[];
}): readonly AgentInstructionsResourceReference[] {
  const normalizedQuery = input.query.toLowerCase();

  return input.resourceReferences.filter((resourceReference) =>
    [resourceReference.displayName, resourceReference.handle, resourceReference.externalId].some(
      (searchValue) => searchValue.toLowerCase().includes(normalizedQuery),
    ),
  );
}

function buildAgentInstructionResourceReferenceCompletionResult(input: {
  resolvedContext: ActiveResourceReferenceContext;
  resourceReferences: readonly AgentInstructionsResourceReference[];
}): CompletionResult | null {
  const options = findMatchingAgentInstructionResourceReferences({
    query: input.resolvedContext.query,
    resourceReferences: input.resourceReferences,
  }).map(
    (resourceReference): Completion => ({
      label: resourceReference.displayName,
      detail: `${resourceReference.providerLabel} ${resourceReference.resourceKind} ID: ${resourceReference.externalId}`,
      type: "variable",
      apply: (view, _completion, from, to) => {
        const insertTransaction = insertCompletionText(
          view.state,
          resourceReference.insertText,
          from,
          to,
        );
        view.dispatch(insertTransaction);
      },
    }),
  );

  if (options.length === 0) {
    return null;
  }

  return {
    from: input.resolvedContext.from,
    to: input.resolvedContext.to,
    filter: false,
    options,
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

  const options = findMatchingAgentInstructionTokens({
    query: resolvedContext.query,
    tokens: input.tokens,
  }).map(
    (token): Completion => ({
      label: token.path,
      ...(token.description === undefined
        ? { detail: token.label }
        : { detail: token.description }),
      type: "variable",
      apply: (view, _completion, from, to) => {
        applyAgentInstructionCompletion(view, token.path, from, to);
      },
    }),
  );

  if (options.length === 0) {
    return null;
  }

  return {
    from: resolvedContext.from,
    to: resolvedContext.to,
    options,
    validFor: /^[A-Za-z0-9_.]*$/,
  };
}

export function completeAgentInstructionResourceReference(
  context: CompletionContext,
  input: {
    resourceReferences: readonly AgentInstructionsResourceReference[];
  },
): CompletionResult | null {
  const resolvedContext = resolveResourceReferenceContext({
    documentText: context.state.doc.toString(),
    cursorOffset: context.pos,
  });
  if (resolvedContext === null) {
    return null;
  }

  return buildAgentInstructionResourceReferenceCompletionResult({
    resolvedContext,
    resourceReferences: input.resourceReferences,
  });
}

export async function completeAgentInstructionResourceReferenceFromLoader(
  context: CompletionContext,
  input: {
    loadResourceReferences: AgentInstructionsResourceReferenceLoader;
  },
): Promise<CompletionResult | null> {
  const resolvedContext = resolveResourceReferenceContext({
    documentText: context.state.doc.toString(),
    cursorOffset: context.pos,
  });
  if (resolvedContext === null) {
    return null;
  }

  const abortController = new AbortController();
  context.addEventListener(
    "abort",
    () => {
      abortController.abort();
    },
    { onDocChange: true },
  );
  const resourceReferences = await input.loadResourceReferences({
    query: resolvedContext.query,
    signal: abortController.signal,
  });
  if (context.aborted) {
    return null;
  }

  return buildAgentInstructionResourceReferenceCompletionResult({
    resolvedContext,
    resourceReferences,
  });
}
