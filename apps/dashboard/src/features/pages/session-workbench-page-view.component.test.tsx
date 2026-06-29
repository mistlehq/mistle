// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo, useRef, useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import type { ChatEntry } from "../chat/chat-types.js";
import { createReadySessionComposerStateInput } from "../session-agents/codex/fixtures/session-fixtures.js";
import {
  SessionConversationBottomPanelDraftController,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

function getComposerEditor(): HTMLElement {
  const textbox = screen.getByRole("textbox");
  if (!(textbox instanceof HTMLElement)) {
    throw new Error("Expected composer textbox to be an element.");
  }

  return textbox;
}

function getComposerEditorView(): EditorView {
  const editorView = EditorView.findFromDOM(getComposerEditor());
  if (editorView === null) {
    throw new Error("Expected composer CodeMirror editor view.");
  }

  return editorView;
}

function readComposerText(): string {
  return getComposerEditorView().state.doc.toString();
}

function replaceComposerText(nextText: string): void {
  const editorView = getComposerEditorView();
  act(() => {
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: nextText,
      },
      selection: {
        anchor: nextText.length,
      },
    });
  });
}

function createLongTranscriptEntries(): readonly ChatEntry[] {
  return Array.from({ length: 80 }, (_, index): ChatEntry[] => {
    const turnNumber = String(index + 1).padStart(3, "0");
    const turnId = `workbench-long-turn-${turnNumber}`;

    return [
      {
        id: `${turnId}:user`,
        turnId,
        kind: "user-message",
        status: "completed",
        text: `Long workbench prompt ${turnNumber}`,
      },
      {
        id: `${turnId}:assistant`,
        turnId,
        kind: "assistant-message",
        phase: null,
        status: "completed",
        text: [
          `Long workbench assistant response ${turnNumber}.`,
          "This stable response text keeps the transcript large enough to protect composer typing at the workbench boundary.",
        ].join(" "),
      },
    ];
  }).flat();
}

function RenderCountedLongTranscript(input: {
  chatEntries: readonly ChatEntry[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  return (
    <>
      <div data-testid="long-transcript-render-count">{renderCountRef.current}</div>
      <SessionConversationMainContent
        activeTurnId={null}
        chatEntries={input.chatEntries}
        isRespondingToServerRequest={false}
        isTurnInProgress={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        pendingTurnId={null}
        scrollBehavior="none"
        scrollContainerRef={input.scrollContainerRef}
        serverRequestPanelEntries={[]}
      />
    </>
  );
}

function WorkbenchLongTranscriptTypingHarness(): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const chatEntries = useMemo(() => createLongTranscriptEntries(), []);

  return (
    <SessionWorkbenchPageView
      alert={null}
      bottomPanel={<div>Terminal workspace</div>}
      isBottomPanelVisible={false}
      isSecondaryPanelVisible={false}
      mainContent={
        <RenderCountedLongTranscript
          chatEntries={chatEntries}
          scrollContainerRef={scrollContainerRef}
        />
      }
      mainContentScrollContainerRef={scrollContainerRef}
      primaryBottomPanel={
        <SessionConversationBottomPanelDraftController
          clearPendingBlueprintComments={function clearPendingBlueprintComments() {}}
          clearPendingDiffComments={function clearPendingDiffComments() {}}
          composerStateInput={createReadySessionComposerStateInput()}
          draftResetKey="workbench-long-transcript"
          isRespondingToServerRequest={false}
          onRespondToServerRequest={function onRespondToServerRequest() {}}
          pendingBlueprintComments={[]}
          pendingDiffComments={[]}
          serverRequestPanelEntries={[]}
        />
      }
      sandboxInstanceId="sbi_test"
      secondaryPanel={<div>Secondary</div>}
    />
  );
}

describe("SessionWorkbenchPageView", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect(): void {}
        observe(): void {}
        unobserve(): void {}
      },
      writable: true,
    });
  });

  it("retains scrollbar gutter and keeps chat-width side padding on mobile", () => {
    const { container } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
      />,
    );

    expect(screen.getByRole("region", { name: "Conversation chat" }).getAttribute("style")).toBe(
      "scrollbar-gutter: stable both-edges;",
    );
    const chatWidthContainers = container.querySelectorAll(".max-w-3xl");

    expect(chatWidthContainers[0]?.className).toContain("px-4 pb-4");
    expect(chatWidthContainers[1]?.className).toContain("px-4");
  });

  it("does not reserve scrollbar gutter for full-width layouts", () => {
    const { container } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        mainContentLayout={{ scroll: "contained", width: "full" }}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
      />,
    );

    expect(
      within(container).getByRole("region", { name: "Conversation chat" }).className,
    ).not.toContain("scrollbar-gutter");
  });

  it("keeps the bottom panel mounted while hidden", () => {
    render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
      />,
    );

    expect(screen.getByText("Terminal workspace")).toBeDefined();
  });

  it("keeps the primary bottom panel mounted while hidden", () => {
    let nextMountId = 1;

    function PrimaryBottomPanelContent(): React.JSX.Element {
      const [mountId] = useState(() => nextMountId++);

      return <div>Composer mount {mountId}</div>;
    }

    const { rerender } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isPrimaryBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<PrimaryBottomPanelContent />}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
      />,
    );

    const hiddenComposer = screen.getByText("Composer mount 1");
    expect(hiddenComposer).toBeTruthy();
    expect(hiddenComposer.closest(".hidden")).toBeTruthy();

    rerender(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isPrimaryBottomPanelVisible
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<PrimaryBottomPanelContent />}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
      />,
    );

    const visibleComposer = screen.getByText("Composer mount 1");
    expect(visibleComposer).toBeTruthy();
    expect(visibleComposer.closest(".hidden")).toBeNull();
  });

  it("keeps long transcript main content stable while typing in the primary bottom composer", () => {
    render(<WorkbenchLongTranscriptTypingHarness />);

    expect(screen.getByText("Long workbench prompt 001")).toBeTruthy();
    expect(
      screen.getByText(
        "Long workbench assistant response 080. This stable response text keeps the transcript large enough to protect composer typing at the workbench boundary.",
      ),
    ).toBeTruthy();
    const initialRenderCount = screen.getByTestId("long-transcript-render-count").textContent;

    replaceComposerText("Typing in the dock should not re-render the long transcript.");

    expect(readComposerText()).toBe("Typing in the dock should not re-render the long transcript.");
    expect(screen.getByTestId("long-transcript-render-count").textContent).toBe(initialRenderCount);
  });

  it("opens the terminal panel with a pixel-based default height", () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(): number {
        return 400;
      },
    });

    try {
      render(
        <SessionWorkbenchPageView
          alert={null}
          bottomPanel={<div>Terminal workspace</div>}
          isBottomPanelVisible
          isSecondaryPanelVisible={false}
          mainContent={<div>Conversation body</div>}
          primaryBottomPanel={<div>Composer</div>}
          sandboxInstanceId="sbi_test"
          secondaryPanel={<div>Secondary</div>}
        />,
      );

      expect(screen.getByTestId("session-workbench-bottom-panel").getAttribute("style")).toContain(
        "flex: 40 1 0px;",
      );
    } finally {
      if (originalOffsetHeight === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      } else {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
    }
  });

  it("renders neutral reconnect alerts as polite status updates", () => {
    render(
      <SessionWorkbenchPageView
        alert={{
          title: "Reconnecting session",
          description: "Waiting for the sandbox to become ready again.",
          variant: "default",
        }}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(within(status).getByText("Reconnecting session")).toBeTruthy();
  });

  it("keeps the outer horizontal group mounted when the secondary panel is hidden", () => {
    const { container } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary panel</div>}
      />,
    );

    expect(within(container).queryAllByTestId("session-workbench-main-group")).toHaveLength(1);
    expect(within(container).queryByTestId("session-workbench-secondary-panel")).toBeNull();
  });

  it("keeps persistent secondary panels mounted while collapsed", () => {
    render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Designer canvas</div>}
        secondaryPanelMountMode="persistent-collapsible"
      />,
    );

    expect(screen.getByTestId("session-workbench-secondary-panel")).toBeTruthy();
    expect(screen.getByTestId("session-workbench-main-group").className).not.toContain(
      "session-workbench-main-group-animated",
    );
    const mountedCanvas = screen.getByText("Designer canvas");
    const collapsedContent = mountedCanvas.closest("[aria-hidden]");
    expect(collapsedContent?.getAttribute("aria-hidden")).toBe("true");
    expect(collapsedContent?.hasAttribute("inert")).toBe(true);
  });

  it("uses explicit default sizes for the primary and secondary panels", () => {
    render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        primaryPanelDefaultSize={40}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Designer canvas</div>}
        secondaryPanelDefaultSize={60}
        secondaryPanelLayoutKey="explicit-size"
        secondaryPanelMountMode="persistent-collapsible"
      />,
    );

    expect(screen.getByTestId("session-workbench-primary-panel").getAttribute("style")).toContain(
      "flex: 40 1 0px;",
    );
    expect(screen.getByTestId("session-workbench-secondary-panel").getAttribute("style")).toContain(
      "flex: 60 1 0px;",
    );
  });

  it("opens a collapsed persistent secondary panel to its explicit default size", async () => {
    const { rerender } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        primaryPanelDefaultSize={40}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Designer canvas</div>}
        secondaryPanelDefaultSize={60}
        secondaryPanelLayoutKey="explicit-size-transition"
        secondaryPanelMountMode="persistent-collapsible"
      />,
    );

    rerender(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        primaryPanelDefaultSize={40}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Designer canvas</div>}
        secondaryPanelDefaultSize={60}
        secondaryPanelLayoutKey="explicit-size-transition"
        secondaryPanelMountMode="persistent-collapsible"
      />,
    );

    expect(screen.getByTestId("session-workbench-main-group").className).toContain(
      "session-workbench-main-group-animated",
    );

    await waitFor(() => {
      expect(screen.getByTestId("session-workbench-primary-panel").getAttribute("style")).toContain(
        "flex: 40 1 0px;",
      );
      expect(
        screen.getByTestId("session-workbench-secondary-panel").getAttribute("style"),
      ).toContain("flex: 60 1 0px;");
    });
  });

  it("uses the slow transition class only for the configured first persistent secondary panel open", () => {
    const { rerender } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        primaryPanelDefaultSize={40}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Designer canvas</div>}
        secondaryPanelDefaultSize={60}
        secondaryPanelFirstOpenTransitionMode="slow"
        secondaryPanelLayoutKey="slow-first-open"
        secondaryPanelMountMode="persistent-collapsible"
      />,
    );

    rerender(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        primaryPanelDefaultSize={40}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Designer canvas</div>}
        secondaryPanelDefaultSize={60}
        secondaryPanelFirstOpenTransitionMode="slow"
        secondaryPanelLayoutKey="slow-first-open"
        secondaryPanelMountMode="persistent-collapsible"
      />,
    );

    const mainGroup = screen.getByTestId("session-workbench-main-group");
    expect(mainGroup.classList.contains("session-workbench-main-group-animated-slow")).toBe(true);
    expect(mainGroup.classList.contains("session-workbench-main-group-animated")).toBe(false);
    fireEvent.transitionEnd(screen.getByTestId("session-workbench-primary-panel"), {
      propertyName: "flex-grow",
    });

    rerender(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        primaryPanelDefaultSize={40}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Designer canvas</div>}
        secondaryPanelDefaultSize={60}
        secondaryPanelFirstOpenTransitionMode="slow"
        secondaryPanelLayoutKey="slow-first-open"
        secondaryPanelMountMode="persistent-collapsible"
      />,
    );

    expect(mainGroup.classList.contains("session-workbench-main-group-animated")).toBe(true);
    expect(mainGroup.classList.contains("session-workbench-main-group-animated-slow")).toBe(false);
  });

  it("resizes a persistent secondary panel with stored layout when the resize key changes", async () => {
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    const originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
    const storageValues = new Map<string, string>();
    const localStorage = {
      getItem(key: string): string | null {
        return storageValues.get(key) ?? null;
      },
      removeItem(key: string): void {
        storageValues.delete(key);
      },
      setItem(key: string, value: string): void {
        storageValues.set(key, value);
      },
    };
    const storageKey =
      "react-resizable-panels:dashboard:session-workbench:main:sbi_test:designer-canvas-resize-intent:session-workbench-primary-panel:session-workbench-secondary-panel";
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorage,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(): number {
        return 1000;
      },
    });
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        "session-workbench-primary-panel": 70,
        "session-workbench-secondary-panel": 30,
      }),
    );

    try {
      const { rerender } = render(
        <SessionWorkbenchPageView
          alert={null}
          bottomPanel={<div>Terminal workspace</div>}
          isBottomPanelVisible={false}
          isSecondaryPanelVisible
          mainContent={<div>Conversation body</div>}
          primaryBottomPanel={<div>Composer</div>}
          primaryPanelDefaultSize={40}
          sandboxInstanceId="sbi_test"
          secondaryPanel={<div>Conversation navigator</div>}
          secondaryPanelDefaultSize={60}
          secondaryPanelLayoutKey="designer-canvas-resize-intent"
          secondaryPanelMountMode="persistent-collapsible"
          secondaryPanelResizeKey="conversation-navigator"
        />,
      );

      expect(
        screen.getByTestId("session-workbench-secondary-panel").getAttribute("style"),
      ).toContain("flex: 30 1 0px;");

      rerender(
        <SessionWorkbenchPageView
          alert={null}
          bottomPanel={<div>Terminal workspace</div>}
          isBottomPanelVisible={false}
          isSecondaryPanelVisible
          mainContent={<div>Conversation body</div>}
          primaryBottomPanel={<div>Composer</div>}
          primaryPanelDefaultSize={40}
          sandboxInstanceId="sbi_test"
          secondaryPanel={<div>Designer canvas</div>}
          secondaryPanelDefaultSize={60}
          secondaryPanelLayoutKey="designer-canvas-resize-intent"
          secondaryPanelMountMode="persistent-collapsible"
          secondaryPanelResizeKey="designer-canvas-open"
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("session-workbench-secondary-panel").getAttribute("style"),
        ).toContain("flex: 60 1 0px;");
      });
    } finally {
      if (originalLocalStorage === undefined) {
        Reflect.deleteProperty(window, "localStorage");
      } else {
        Object.defineProperty(window, "localStorage", originalLocalStorage);
      }
      if (originalOffsetWidth === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
      } else {
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
      }
    }
  });

  it("keeps the terminal panel collapsed when the secondary panel layout key changes", async () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(): number {
        return 400;
      },
    });

    try {
      const { rerender } = render(
        <SessionWorkbenchPageView
          alert={null}
          bottomPanel={<div>Terminal workspace</div>}
          isBottomPanelVisible={false}
          isSecondaryPanelVisible
          mainContent={<div>Conversation body</div>}
          primaryBottomPanel={<div>Composer</div>}
          sandboxInstanceId="sbi_test"
          secondaryPanel={<div>Designer canvas</div>}
          secondaryPanelDefaultSize={60}
          secondaryPanelLayoutKey="designer-canvas-60"
          secondaryPanelMountMode="persistent-collapsible"
        />,
      );

      rerender(
        <SessionWorkbenchPageView
          alert={null}
          bottomPanel={<div>Terminal workspace</div>}
          isBottomPanelVisible={false}
          isSecondaryPanelVisible
          mainContent={<div>Conversation body</div>}
          primaryBottomPanel={<div>Composer</div>}
          sandboxInstanceId="sbi_test"
          secondaryPanel={<div>Conversations</div>}
          secondaryPanelDefaultSize={20}
          secondaryPanelLayoutKey="right-panel"
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("session-workbench-bottom-panel").getAttribute("style"),
        ).toContain("flex: 0 1 0px;");
      });
    } finally {
      if (originalOffsetHeight === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      } else {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
    }
  });

  it("does not remount the bottom panel when the shared right panel opens", () => {
    let nextMountId = 1;

    function BottomPanelContent(): React.JSX.Element {
      const [mountId] = useState(() => nextMountId++);

      return <div>Terminal mount {mountId}</div>;
    }

    const { rerender } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<BottomPanelContent />}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Threads panel</div>}
        secondaryPanelLayoutKey="right-panel"
      />,
    );

    expect(screen.getByText("Terminal mount 1")).toBeTruthy();

    rerender(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<BottomPanelContent />}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Threads panel</div>}
        secondaryPanelDefaultSize={20}
        secondaryPanelLayoutKey="right-panel"
        secondaryPanelMinSize="16rem"
      />,
    );

    expect(screen.getByText("Terminal mount 1")).toBeTruthy();
    expect(screen.getByText("Threads panel")).toBeTruthy();
  });
});
