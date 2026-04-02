import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  completeAgentInstructionToken,
  resolveAgentInstructionTemplateQuery,
} from "./agent-instructions-completion.js";
import { buildAgentInstructionTokenCatalog } from "./agent-instructions-token-catalog.js";
import { createGithubIssueCommentCreatedEventOption } from "./webhook-automation-test-fixtures.js";

function createCompletionContext(input: { documentText: string; cursorOffset: number }) {
  const state = EditorState.create({
    doc: input.documentText,
  });

  return new CompletionContext(state, input.cursorOffset, true);
}

describe("resolveAgentInstructionTemplateQuery", () => {
  it("finds the active template token query", () => {
    expect(
      resolveAgentInstructionTemplateQuery({
        documentText: "Review {{payload.comm",
        cursorOffset: "Review {{payload.comm".length,
      }),
    ).toEqual({
      from: 7,
      to: 21,
      query: "payload.comm",
    });
  });

  it("returns null outside liquid token context", () => {
    expect(
      resolveAgentInstructionTemplateQuery({
        documentText: "Review payload",
        cursorOffset: "Review payload".length,
      }),
    ).toBeNull();
  });
});

describe("completeAgentInstructionToken", () => {
  const tokens = buildAgentInstructionTokenCatalog({
    selectedEventOptions: [createGithubIssueCommentCreatedEventOption()],
  });

  it("returns matching payload suggestions inside a token", () => {
    const completionResult = completeAgentInstructionToken(
      createCompletionContext({
        documentText: "Review {{payload.comm",
        cursorOffset: "Review {{payload.comm".length,
      }),
      { tokens },
    );

    expect(
      completionResult?.options.some((option) => option.label === "payload.comment.body"),
    ).toBe(true);
  });

  it("returns null outside token context even on explicit invoke", () => {
    const completionResult = completeAgentInstructionToken(
      createCompletionContext({
        documentText: "Review payload",
        cursorOffset: "Review payload".length,
      }),
      { tokens },
    );

    expect(completionResult).toBeNull();
  });

  it("replaces a full existing token span when already inside one", () => {
    const completionResult = completeAgentInstructionToken(
      createCompletionContext({
        documentText: "Review {{payload.comment.body}} now",
        cursorOffset: "Review {{payload.com".length,
      }),
      { tokens },
    );

    expect(completionResult?.from).toBe(7);
    expect(completionResult?.to).toBe(31);
  });
});
