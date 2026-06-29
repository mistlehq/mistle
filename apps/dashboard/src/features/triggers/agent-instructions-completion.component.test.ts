// @vitest-environment jsdom

import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { render, screen, waitFor } from "@testing-library/react";
import { createElement, useState, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  applyAgentInstructionCompletion,
  completeAgentInstructionResourceReference,
  completeAgentInstructionToken,
  findMatchingAgentInstructionResourceReferences,
  findMatchingAgentInstructionTokens,
  resolveResourceReferenceContext,
  resolveTemplateTokenContext,
} from "./agent-instructions-completion.js";
import { AgentInstructionsEditor } from "./agent-instructions-editor.js";
import {
  buildAgentInstructionsResourceReferences,
  buildAgentInstructionTokenCatalog,
} from "./agent-instructions-token-catalog.js";
import { TriggerFormShell } from "./trigger-form-shell.js";
import { createGithubIssueCommentCreatedEventOption } from "./webhook-trigger-test-fixtures.js";

function createCompletionContext(input: { documentText: string; cursorOffset: number }) {
  const state = EditorState.create({
    doc: input.documentText,
  });

  return new CompletionContext(state, input.cursorOffset, true);
}

function RenderedAgentInstructionsEditor(input: {
  resourceReferences: ReturnType<typeof buildAgentInstructionsResourceReferences>;
}): ReactElement {
  const [value, setValue] = useState("");

  return createElement(AgentInstructionsEditor, {
    ariaLabelledBy: "agent-instructions-label",
    disabled: false,
    invalid: false,
    onChange: setValue,
    resourceReferences: input.resourceReferences,
    tokens: [],
    value,
  });
}

function getRenderedEditorView(): EditorView {
  const textbox = screen.getByRole("textbox");
  const editorView = EditorView.findFromDOM(textbox);
  if (editorView === null) {
    throw new Error("Expected rendered agent instructions editor view.");
  }

  return editorView;
}

function getRenderedEditorViewByName(name: string): EditorView {
  const textbox = screen.getByRole("textbox", { name });
  const editorView = EditorView.findFromDOM(textbox);
  if (editorView === null) {
    throw new Error(`Expected rendered '${name}' CodeMirror editor view.`);
  }

  return editorView;
}

function RenderedTriggerFormShell(input: {
  resourceReferences: ReturnType<typeof buildAgentInstructionsResourceReferences>;
}): ReactElement {
  const [inputTemplate, setInputTemplate] = useState("");

  return createElement(TriggerFormShell, {
    enabled: true,
    fieldErrors: {},
    formError: null,
    formErrorTitle: "Trigger could not be saved",
    inputIdPrefix: "trigger",
    inputTemplate,
    inputTemplateDescription: "Sent to the agent each time this trigger runs.",
    inputTemplateLabelId: "trigger-input-template-label",
    inputTemplateResourceReferenceLoader: async () => input.resourceReferences,
    inputTemplateTokens: [],
    isDeleting: false,
    isDuplicating: false,
    isSaving: false,
    mode: "create",
    name: "Trigger",
    onDelete: null,
    onDuplicate: null,
    onSubmit: () => {},
    onValueChange: (key, value) => {
      if (key === "inputTemplate" && typeof value === "string") {
        setInputTemplate(value);
      }
    },
    onViewActivity: null,
    primaryRepositoryId: "",
    sandboxProfileId: "sbp_test",
    sandboxProfileOptions: [
      {
        value: "sbp_test",
        label: "Test profile",
      },
    ],
    selectedPrimaryRepositoryPath: null,
    selectedWorkspaceRoot: false,
    shouldShowCreateNameField: false,
    shouldShowPrimaryRepositoryField: false,
    shouldShowTriggerEnabledField: false,
    submitLabel: "Create",
    typeSpecificSection: null,
    validationSummaryError: null,
  });
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

describe("resolveResourceReferenceContext", () => {
  it("finds the active resource reference query", () => {
    expect(
      resolveResourceReferenceContext({
        documentText: "Ask @Jon",
        cursorOffset: "Ask @Jon".length,
      }),
    ).toEqual({
      from: 4,
      to: 8,
      query: "Jon",
    });
  });

  it("returns null when the cursor is not after an at sign", () => {
    expect(
      resolveResourceReferenceContext({
        documentText: "Ask Jonathan",
        cursorOffset: "Ask Jonathan".length,
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

describe("completeAgentInstructionResourceReference", () => {
  const resourceReferences = buildAgentInstructionsResourceReferences({
    providerLabel: "Slack",
    resources: [
      {
        id: "rsc_slack_user",
        displayName: "Jonathan",
        handle: "jonathan",
        externalId: "U12039",
        kind: "user",
      },
      {
        id: "rsc_slack_channel",
        displayName: "Engineering",
        handle: "engineering",
        externalId: "C12039",
        kind: "channel",
      },
    ],
  });

  it("returns matching resource suggestions after an at sign", () => {
    const completionResult = completeAgentInstructionResourceReference(
      createCompletionContext({
        documentText: "Ask @Jon",
        cursorOffset: "Ask @Jon".length,
      }),
      { resourceReferences },
    );

    expect(completionResult?.options.map((option) => option.label)).toEqual(["Jonathan"]);
  });

  it("lets CodeMirror recompute resource completions as the query changes", () => {
    const completionResult = completeAgentInstructionResourceReference(
      createCompletionContext({
        documentText: "Ask @Jon",
        cursorOffset: "Ask @Jon".length,
      }),
      { resourceReferences },
    );

    expect(completionResult?.filter).toBe(false);
    expect(completionResult?.validFor).toBeUndefined();
  });

  it("matches resource references by handle and external id", () => {
    expect(
      findMatchingAgentInstructionResourceReferences({
        query: "engineering",
        resourceReferences,
      }).map((resourceReference) => resourceReference.displayName),
    ).toEqual(["Engineering"]);

    expect(
      findMatchingAgentInstructionResourceReferences({
        query: "U12039",
        resourceReferences,
      }).map((resourceReference) => resourceReference.displayName),
    ).toEqual(["Jonathan"]);
  });

  it("inserts ordinary plain text for the selected resource", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "Ask @Jon",
        selection: {
          anchor: "Ask @Jon".length,
        },
      }),
    });
    const completionResult = completeAgentInstructionResourceReference(
      createCompletionContext({
        documentText: "Ask @Jon",
        cursorOffset: "Ask @Jon".length,
      }),
      { resourceReferences },
    );
    const completion = completionResult?.options[0];

    try {
      if (completion === undefined || typeof completion.apply !== "function") {
        throw new Error("Expected resource completion to provide an apply function.");
      }

      completion.apply(view, completion, 4, 8);

      expect(view.state.doc.toString()).toBe("Ask @Jonathan (Slack user ID: U12039)");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("opens resource reference completions from the rendered editor", async () => {
    render(createElement(RenderedAgentInstructionsEditor, { resourceReferences }));

    const editorView = getRenderedEditorView();
    editorView.focus();
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: "Ask @Jon",
      },
      selection: {
        anchor: "Ask @Jon".length,
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Jonathan")).toBeTruthy();
    });
  });

  it("opens resource reference completions in the trigger user message editor", async () => {
    render(createElement(RenderedTriggerFormShell, { resourceReferences }));

    const editorView = getRenderedEditorViewByName("User message");
    editorView.focus();
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: "Ask @Jon",
      },
      selection: {
        anchor: "Ask @Jon".length,
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Jonathan")).toBeTruthy();
    });
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
