// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { DesignerSession } from "../designer/designer-service.js";
import {
  DesignerPageComposerContainerClassName,
  DesignerPageSessionsContainerClassName,
  DesignerPageView,
} from "./designer-page-view.js";

const SampleDesignerSession = {
  id: "dsn_triage",
  organizationId: "org_test",
  sandboxInstanceId: "sbi_designer_triage",
  sandboxProfileId: "designer",
  sandboxProfileVersion: 1,
  title: "Design triage agent",
  status: "running",
  connectable: true,
  failureCode: null,
  failureMessage: null,
  runtimeContext: {
    agentRuntimeId: "codex",
    launchCwd: "/workspace",
    primaryRepositoryRoot: null,
  },
  startupOperation: null,
  initialPrompt: "Build a triage agent.",
  canvasTabs: [],
  createdAt: "2026-04-01T09:00:00.000Z",
  updatedAt: "2026-04-01T09:00:00.000Z",
} satisfies DesignerSession;

function ControlledDesignerPageView(input: {
  initialDraft?: string;
  sessions?: readonly DesignerSession[];
}): React.JSX.Element {
  const [prompt, setPrompt] = useState(input.initialDraft ?? "");

  return (
    <MemoryRouter>
      <DesignerPageView
        createErrorMessage={null}
        isCreating={false}
        onPromptChange={setPrompt}
        onSubmit={() => {}}
        prompt={prompt}
        sessions={input.sessions ?? []}
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

    const heading = screen.getByRole("heading", { name: "Build an agent workflow" });

    expect(heading).toBeDefined();
    expect(heading.parentElement).toHaveProperty(
      "className",
      DesignerPageComposerContainerClassName,
    );
    expect(composer.getAttribute("aria-placeholder")).toBe(
      "Ask Mistle to build an engineering agent that...",
    );
    expect(startButton).toHaveProperty("disabled", true);
    expect(screen.queryByText("What do you want to build?")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Past sessions" })).toBeNull();
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

  it("fills the composer from a starter prompt without starting the session", () => {
    render(<ControlledDesignerPageView />);

    const starterPrompts = screen.getByTestId("designer-starter-prompts");
    const startButton = screen.getByRole("button", { name: "Start Designer session" });
    const composer = screen.getByRole("textbox");

    expect(starterPrompts).toBeDefined();
    expect(starterPrompts.compareDocumentPosition(composer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const visibleStarterPromptButtons = within(starterPrompts).getAllByRole("button");
    expect(visibleStarterPromptButtons).toHaveLength(6);
    const visibleStarterPromptCategories = visibleStarterPromptButtons
      .map((button) => button.getAttribute("aria-label")?.split(":")[0])
      .sort();
    expect(new Set(visibleStarterPromptCategories).size).toBe(
      visibleStarterPromptCategories.length,
    );
    const firstStarterPromptButton = visibleStarterPromptButtons[0];
    if (firstStarterPromptButton === undefined) {
      throw new Error("Expected at least one visible Designer starter prompt.");
    }

    const starterPrompt = firstStarterPromptButton.getAttribute("title");
    if (starterPrompt === null) {
      throw new Error("Expected visible Designer starter prompt to expose full prompt text.");
    }

    expect(startButton).toHaveProperty("disabled", true);

    fireEvent.click(firstStarterPromptButton);

    expect(getDesignerComposerEditorView().state.doc.toString()).toBe(starterPrompt);
    expect(startButton).toHaveProperty("disabled", false);
  });

  it("shows the compact past sessions table without redundant columns or row actions", () => {
    render(<ControlledDesignerPageView sessions={[SampleDesignerSession]} />);

    expect(screen.getByRole("columnheader", { name: "Sessions" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Started by" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Updated" })).toBeDefined();
    expect(screen.getByRole("table").parentElement?.parentElement).toHaveProperty(
      "className",
      DesignerPageSessionsContainerClassName,
    );
    expect(screen.queryByRole("columnheader", { name: "Sandbox profile" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Created" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Past sessions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Designer session actions/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Design triage agent" }).getAttribute("href")).toBe(
      "/dsn_triage",
    );
  });
});
