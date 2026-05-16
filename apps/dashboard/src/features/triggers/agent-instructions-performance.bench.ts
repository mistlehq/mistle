import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { bench, describe } from "vitest";

import {
  completeAgentInstructionToken,
  findMatchingAgentInstructionTokens,
  rankAgentInstructionTokensForMatching,
  resolveTemplateTokenContext,
} from "./agent-instructions-completion.js";
import {
  buildAgentInstructionTokenCatalog,
  type AgentInstructionsEditorToken,
} from "./agent-instructions-token-catalog.js";
import type { WebhookTriggerEventOption } from "./webhook-trigger-event-types.js";
import { createGithubIssueCommentCreatedEventOption } from "./webhook-trigger-test-fixtures.js";

const BenchmarkTokenCounts = [100, 1_000, 10_000] as const;
const BenchmarkEventCounts = [10, 100, 1_000] as const;

function createSyntheticToken(index: number): AgentInstructionsEditorToken {
  const path = `payload.synthetic.section_${Math.floor(index / 100)}.field_${index}`;

  return {
    path,
    insertText: `{{${path}}}`,
    label: `Synthetic field ${index}`,
    group: "payload",
    description: `Synthetic payload field ${index}`,
    replacePath: path,
  };
}

function createSyntheticTokens(count: number): readonly AgentInstructionsEditorToken[] {
  return Array.from({ length: count }, (_, index) => createSyntheticToken(index));
}

function createSyntheticEventOption(index: number): WebhookTriggerEventOption {
  const parameterCount = 12;

  return createGithubIssueCommentCreatedEventOption({
    id: `benchmark-event-${index}`,
    eventType: `benchmark.event.${index}`,
    parameters: Array.from({ length: parameterCount }, (_, parameterIndex) => ({
      id: `field-${parameterIndex}`,
      label: `field ${parameterIndex}`,
      kind: "string" as const,
      payloadPath: [`section_${index}`, `field_${parameterIndex}`],
    })),
  });
}

function createSyntheticEventOptions(count: number): readonly WebhookTriggerEventOption[] {
  return Array.from({ length: count }, (_, index) => createSyntheticEventOption(index));
}

function createCompletionContext(input: { documentText: string; cursorOffset: number }) {
  const state = EditorState.create({
    doc: input.documentText,
  });

  return new CompletionContext(state, input.cursorOffset, true);
}

describe("agent instructions token and completion performance", () => {
  for (const eventCount of BenchmarkEventCounts) {
    const selectedEventOptions = createSyntheticEventOptions(eventCount);

    bench(`buildAgentInstructionTokenCatalog (${eventCount} events)`, () => {
      buildAgentInstructionTokenCatalog({
        selectedEventOptions,
      });
    });
  }

  for (const tokenCount of BenchmarkTokenCounts) {
    const tokens = createSyntheticTokens(tokenCount);
    const rankedTokens = rankAgentInstructionTokensForMatching(tokens);
    const completionContext = createCompletionContext({
      documentText: "Review {{payload.synthetic.section_9.f",
      cursorOffset: "Review {{payload.synthetic.section_9.f".length,
    });

    bench(`rankAgentInstructionTokensForMatching (${tokenCount} tokens)`, () => {
      rankAgentInstructionTokensForMatching(tokens);
    });

    bench(`findMatchingAgentInstructionTokens (${tokenCount} tokens)`, () => {
      findMatchingAgentInstructionTokens({
        query: "payload.synthetic.section_9.f",
        tokens: rankedTokens,
      });
    });

    bench(`completeAgentInstructionToken (${tokenCount} tokens)`, () => {
      completeAgentInstructionToken(completionContext, {
        tokens: rankedTokens,
      });
    });
  }

  for (const documentLength of [100, 10_000, 100_000] as const) {
    const prefix = "x".repeat(documentLength);
    const documentText = `${prefix} {{payload.synthetic.section_9.f`;

    bench(`resolveTemplateTokenContext (${documentLength} chars before token)`, () => {
      resolveTemplateTokenContext({
        documentText,
        cursorOffset: documentText.length,
      });
    });
  }
});
