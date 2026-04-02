// @vitest-environment jsdom

import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import {
  applyAgentInstructionCompletion,
  completeAgentInstructionToken,
  findMatchingAgentInstructionTokens,
  resolveTemplateTokenContext,
} from "./agent-instructions-completion.js";
import { buildAgentInstructionTokenCatalog } from "./agent-instructions-token-catalog.js";
import { createGithubIssueCommentCreatedEventOption } from "./webhook-automation-test-fixtures.js";

function createCompletionContext(input: { documentText: string; cursorOffset: number }) {
  const state = EditorState.create({
    doc: input.documentText,
  });

  return new CompletionContext(state, input.cursorOffset, true);
}

describe("resolveTemplateTokenContext", () => {
  it("finds the active template token query", () => {
    expect(
      resolveTemplateTokenContext({
        documentText: "Review {{payload.comm",
        cursorOffset: "Review {{payload.comm".length,
      }),
    ).toEqual({
      from: 9,
      to: 21,
      query: "payload.comm",
    });
  });

  it("returns null outside liquid token context", () => {
    expect(
      resolveTemplateTokenContext({
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

  it("finds matching tokens for a partial payload path", () => {
    const matchingTokens = findMatchingAgentInstructionTokens({
      query: "payload.com",
      tokens,
    });

    expect(matchingTokens.map((token) => token.path)).toContain("payload.comment.body");
  });

  it("returns null when the caret is inside an existing token but not at the trailing edge", () => {
    const completionResult = completeAgentInstructionToken(
      createCompletionContext({
        documentText: "Review {{payload.comment.body}} now",
        cursorOffset: "Review {{payload.com".length,
      }),
      { tokens },
    );

    expect(completionResult).toBeNull();
  });

  it("replaces a full existing token span at the trailing edge", () => {
    const completionResult = completeAgentInstructionToken(
      createCompletionContext({
        documentText: "Review {{payload.comment.body}} now",
        cursorOffset: "Review {{payload.comment.body".length,
      }),
      { tokens },
    );

    expect(completionResult?.from).toBe(9);
    expect(completionResult?.to).toBe(29);
  });
});

describe("applyAgentInstructionCompletion", () => {
  it("replaces the active token path and leaves the token open", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "Review {{payload.com",
        selection: {
          anchor: "Review {{payload.com".length,
        },
      }),
    });

    try {
      applyAgentInstructionCompletion(view, "payload.comment.body", 9, 20);

      expect(view.state.doc.toString()).toBe("Review {{payload.comment.body");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("preserves existing closing braces when they are already present", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "Review {{payload.com}}",
        selection: {
          anchor: "Review {{payload.com".length,
        },
      }),
    });

    try {
      applyAgentInstructionCompletion(view, "payload.comment.body", 9, 20);

      expect(view.state.doc.toString()).toBe("Review {{payload.comment.body}}");
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
