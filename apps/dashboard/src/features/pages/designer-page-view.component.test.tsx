// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { DesignerPageView } from "./designer-page-view.js";

function ControlledDesignerPageView(input: { initialPrompt?: string }): React.JSX.Element {
  const [prompt, setPrompt] = useState(input.initialPrompt ?? "");

  return (
    <MemoryRouter>
      <DesignerPageView
        createErrorMessage={null}
        isCreating={false}
        onPromptChange={setPrompt}
        onSubmit={() => {}}
        prompt={prompt}
        sessions={[]}
        sessionsErrorMessage={null}
      />
    </MemoryRouter>
  );
}

function getDesignerComposerEditorView(): EditorView {
  const textbox = screen.getByRole("textbox");
  const editorView = EditorView.findFromDOM(textbox);
  if (editorView === null) {
    throw new Error("Expected Designer composer CodeMirror editor view.");
  }

  return editorView;
}

function replaceDesignerPrompt(nextPrompt: string): void {
  const editorView = getDesignerComposerEditorView();
  act(() => {
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: nextPrompt,
      },
      selection: {
        anchor: nextPrompt.length,
      },
    });
  });
}

describe("DesignerPageView", () => {
  it("keys the start prompt through the shared composer without model or usage controls", () => {
    render(<ControlledDesignerPageView />);

    const composer = screen.getByRole("textbox");
    const startButton = screen.getByRole("button", { name: "Start Designer session" });

    expect(composer.getAttribute("aria-placeholder")).toBe(
      "Build a triaging agent for incoming GitHub issues and Linear bugs.",
    );
    expect(startButton).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Add files" })).toBeNull();
    expect(screen.queryByLabelText("Model switcher")).toBeNull();
    expect(screen.queryByLabelText("Reasoning switcher")).toBeNull();
    expect(screen.queryByText(/context/i)).toBeNull();

    replaceDesignerPrompt("Build a triaging agent for Linear bugs.");

    expect(screen.getByRole("button", { name: "Start Designer session" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
