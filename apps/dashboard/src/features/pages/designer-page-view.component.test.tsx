// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { DesignerSession } from "../designer/designer-service.js";
import { DesignerPageView } from "./designer-page-view.js";

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
  onOpenSession?: () => void;
  sessions?: readonly DesignerSession[];
}): React.JSX.Element {
  const [prompt, setPrompt] = useState(input.initialDraft ?? "");

  return (
    <MemoryRouter>
      <DesignerPageView
        createErrorMessage={null}
        isCreating={false}
        onOpenSession={input.onOpenSession ?? (() => {})}
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

    expect(composer.getAttribute("aria-placeholder")).toBe(
      "Build a triaging agent for incoming GitHub issues and Linear bugs.",
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

  it("omits the implied sandbox profile column from past sessions", () => {
    render(<ControlledDesignerPageView sessions={[SampleDesignerSession]} />);

    expect(screen.getByRole("columnheader", { name: "Sessions" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "Started by" })).toBeDefined();
    expect(screen.queryByRole("columnheader", { name: "Sandbox profile" })).toBeNull();
    expect(screen.getByRole("link", { name: "Design triage agent" }).getAttribute("href")).toBe(
      "/designer/dsn_triage",
    );
  });

  it("notifies before opening a past Designer session", () => {
    const openSessionCalls: string[] = [];

    function DesignerPageViewOpenSessionHarness(): React.JSX.Element {
      const [navigationState, setNavigationState] = useState("open");

      return (
        <>
          <div>{navigationState}</div>
          <ControlledDesignerPageView
            onOpenSession={() => {
              openSessionCalls.push("open");
              setNavigationState("closing");
            }}
            sessions={[SampleDesignerSession]}
          />
        </>
      );
    }

    render(<DesignerPageViewOpenSessionHarness />);

    fireEvent.click(screen.getByRole("link", { name: "Design triage agent" }));

    expect(screen.getByText("closing")).toBeDefined();
    expect(openSessionCalls).toEqual(["open"]);
  });

  it("notifies before opening a past Designer session from the row actions menu", () => {
    const openSessionCalls: string[] = [];

    render(
      <ControlledDesignerPageView
        onOpenSession={() => {
          openSessionCalls.push("open");
        }}
        sessions={[SampleDesignerSession]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Designer session actions for Design triage agent" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Open session" }));

    expect(openSessionCalls).toEqual(["open"]);
  });
});
