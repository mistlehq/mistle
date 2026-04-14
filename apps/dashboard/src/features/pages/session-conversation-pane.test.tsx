// @vitest-environment jsdom

import type { CodexModelSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent, waitFor } from "@testing-library/react";
import { useMemo, useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionComposerFixtureProps } from "../session-agents/codex/fixtures/session-fixtures.js";
import { useSessionComposerAttachmentControl } from "./session-composer/index.js";
import {
  SessionConversationBottomPanel,
  SessionConversationBottomPanelController,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";

const ComposerModelFixture: CodexModelSummary = {
  id: "model_gpt_54",
  model: "gpt-5.4",
  displayName: "GPT-5.4",
  hidden: false,
  defaultReasoningEffort: "medium",
  inputModalities: ["text", "image"],
  supportsPersonality: true,
  isDefault: true,
};

const UploadedImageFixture = {
  attachmentId: "att_123",
  threadId: "thread_123",
  originalFilename: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 4,
  path: "/tmp/attachments/thread_123/upload.png",
} as const;

function createImageFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "screenshot.png", { type: "image/png" });
}

function RenderedComposerPaneHarness(input: {
  uploadImage: (input: { file: File; threadId: string }) => Promise<typeof UploadedImageFixture>;
}): React.JSX.Element {
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string | null>(null);
  const transport = useMemo(
    () =>
      new SandboxSessionTransport({
        runtime: createBrowserSandboxSessionRuntime(),
      }),
    [],
  );
  const attachmentControl = useSessionComposerAttachmentControl({
    attachmentTarget: {
      sandboxInstanceId: "sbi_123",
      threadId: "thread_123",
    },
    ensureTransportConnected: async () => {
      return {
        sandboxInstanceId: "sbi_123",
        transport,
      };
    },
    dependencies: {
      // Exception approved by user for this task: there is no real dashboard upload harness
      // for the rendered composer pane path yet. Cleanup owner: Codex. Cleanup date: 2026-04-10.
      createUploadStreamClient: () => {
        return {
          uploadImage: input.uploadImage,
        };
      },
    },
  });

  return (
    <SessionConversationBottomPanelController
      chatEntries={[]}
      composerStateInput={{
        bootstrap: {
          phase: { status: "ready" },
          establishedSnapshot: {
            availableModels: [ComposerModelFixture],
            configSnapshot: {
              model: ComposerModelFixture.model,
              modelReasoningEffort: ComposerModelFixture.defaultReasoningEffort,
            },
          },
        },
        clearSessionErrorMessage: () => {
          setSessionErrorMessage(null);
        },
        configControl: {
          selectedModel: ComposerModelFixture.model,
          selectedReasoningEffort: ComposerModelFixture.defaultReasoningEffort,
          modelOptions: [
            {
              value: ComposerModelFixture.model,
              label: ComposerModelFixture.displayName,
            },
          ],
          canChangeModel: true,
          canChangeReasoningEffort: true,
          isUpdating: false,
          setModel: () => {
            return;
          },
          setReasoningEffort: () => {
            return;
          },
        },
        attachmentControl,
        sessionErrorMessage,
        turnControl: {
          activeTurnState: "idle",
          canSteer: false,
          canInterrupt: false,
          isStarting: false,
          isSteering: false,
          isInterrupting: false,
          completedTurnErrorMessage: null,
          startTurn: async () => {
            return;
          },
          steerTurn: async () => {
            return;
          },
          interruptTurn: () => {
            return;
          },
        },
      }}
      isRespondingToServerRequest={false}
      onRespondToServerRequest={function onRespondToServerRequest() {}}
      serverRequestPanelEntries={[]}
    />
  );
}

function ConversationScrollHarness(input: {
  activeTurnId: string | null;
  isTurnInProgress?: boolean;
  pendingTurnId: string | null;
  chatEntries: React.ComponentProps<typeof SessionConversationMainContent>["chatEntries"];
}): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div data-testid="conversation-scroll-container" ref={scrollContainerRef}>
      <SessionConversationMainContent
        activeTurnId={input.activeTurnId}
        chatEntries={input.chatEntries}
        isRespondingToServerRequest={false}
        isTurnInProgress={input.isTurnInProgress ?? input.activeTurnId !== null}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        pendingTurnId={input.pendingTurnId}
        scrollContainerRef={scrollContainerRef}
        serverRequestPanelEntries={[]}
      />
    </div>
  );
}

function defineElementRect(
  element: HTMLElement,
  input: {
    height: number;
    scrollContainerElement?: HTMLDivElement;
    top: number;
  },
): void {
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    get() {
      return input.height;
    },
  });
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        bottom:
          (input.scrollContainerElement === undefined
            ? input.top
            : input.top - input.scrollContainerElement.scrollTop) + input.height,
        height: input.height,
        left: 0,
        right: 0,
        top:
          input.scrollContainerElement === undefined
            ? input.top
            : input.top - input.scrollContainerElement.scrollTop,
        width: 0,
        x: 0,
        y:
          input.scrollContainerElement === undefined
            ? input.top
            : input.top - input.scrollContainerElement.scrollTop,
        toJSON: () => "",
      }) satisfies DOMRect,
  });
}

function defineScrollContainerMetrics(
  scrollContainerElement: HTMLDivElement,
  input: {
    clientHeight: number;
    top: number;
  },
): void {
  Object.defineProperty(scrollContainerElement, "clientHeight", {
    configurable: true,
    get() {
      return input.clientHeight;
    },
  });
  Object.defineProperty(scrollContainerElement, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        bottom: input.top + input.clientHeight,
        height: input.clientHeight,
        left: 0,
        right: 0,
        top: input.top,
        width: 0,
        x: 0,
        y: input.top,
        toJSON: () => "",
      }) satisfies DOMRect,
  });
  Object.defineProperty(scrollContainerElement, "scrollTop", {
    configurable: true,
    value: 0,
    writable: true,
  });
}

describe("SessionConversationBottomPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the session status message above the composer", () => {
    render(
      <SessionConversationBottomPanel
        chatEntries={[]}
        composerViewModel={{
          ...SessionComposerFixtureProps,
        }}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        serverRequestPanelEntries={[]}
        statusMessage={{
          message:
            "Model GPT-5.3 Codex Spark cannot inspect images. Images will only be sent as file path references.",
          variant: "default",
        }}
      />,
    );

    expect(
      screen.getByText(
        "Model GPT-5.3 Codex Spark cannot inspect images. Images will only be sent as file path references.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders a working indicator directly above the composer when a turn is active", () => {
    render(
      <SessionConversationBottomPanel
        chatEntries={[]}
        composerViewModel={{
          ...SessionComposerFixtureProps,
        }}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        serverRequestPanelEntries={[]}
        showWorkingIndicator
        statusMessage={null}
      />,
    );

    expect(screen.getByRole("status", { name: "Working" })).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("shows upload failures in the rendered pane and keeps pending attachments visible", async () => {
    const { container } = render(
      <RenderedComposerPaneHarness
        uploadImage={async () => {
          throw new Error("That image file could not be validated.");
        }}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected composer file input to exist.");
    }

    fireEvent.change(fileInput, {
      target: {
        files: [createImageFile()],
      },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Inspect the image" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("That image file could not be validated.")).toBeTruthy();
    expect(screen.getByText("screenshot.png")).toBeTruthy();
  });

  it("clears the rendered upload error and pending attachment after a successful retry", async () => {
    let uploadAttemptCount = 0;
    const { container } = render(
      <RenderedComposerPaneHarness
        uploadImage={async () => {
          uploadAttemptCount += 1;
          if (uploadAttemptCount === 1) {
            throw new Error("That image file could not be validated.");
          }

          return UploadedImageFixture;
        }}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected composer file input to exist.");
    }

    fireEvent.change(fileInput, {
      target: {
        files: [createImageFile()],
      },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Inspect the image" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("That image file could not be validated.")).toBeTruthy();
    expect(screen.getByText("screenshot.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.queryByText("That image file could not be validated.")).toBeNull();
      expect(screen.queryByText("screenshot.png")).toBeNull();
    });
  });

  it("pins a newly started turn to the top of the conversation scroll container", async () => {
    const initialEntries = [
      {
        id: "user-turn-1",
        turnId: "turn-1",
        kind: "user-message",
        status: "completed",
        text: "Earlier turn",
      },
      {
        id: "assistant-turn-1",
        turnId: "turn-1",
        kind: "assistant-message",
        phase: null,
        status: "completed",
        text: "Earlier response",
      },
    ] as const;
    const nextEntries = [
      ...initialEntries,
      {
        id: "user-turn-2",
        turnId: "turn-2",
        kind: "user-message",
        status: "completed",
        text: "Newest turn",
      },
      {
        id: "assistant-turn-2",
        turnId: "turn-2",
        kind: "assistant-message",
        phase: null,
        status: "streaming",
        text: "Streaming response",
      },
    ] as const;
    const rendered = render(
      <ConversationScrollHarness
        activeTurnId="turn-1"
        chatEntries={initialEntries}
        pendingTurnId={null}
      />,
    );

    const scrollContainerElement = screen.getByTestId("conversation-scroll-container");
    if (!(scrollContainerElement instanceof HTMLDivElement)) {
      throw new Error("Expected a div scroll container.");
    }

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 420,
      top: 100,
    });
    defineElementRect(screen.getByText("Earlier turn").closest("[data-turn-id]") as HTMLElement, {
      height: 140,
      top: 120,
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={nextEntries}
        pendingTurnId="turn-2"
      />,
    );

    const newestTurnElement = screen.getByText("Newest turn").closest("[data-turn-id]");
    if (!(newestTurnElement instanceof HTMLDivElement)) {
      throw new Error("Expected the newest turn wrapper to exist.");
    }

    defineElementRect(newestTurnElement, {
      height: 180,
      scrollContainerElement,
      top: 340,
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={nextEntries}
        pendingTurnId="turn-2"
      />,
    );

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(228);
    });

    const spacerElement = scrollContainerElement.querySelector(
      '[data-slot="conversation-bottom-spacer"]',
    );
    expect(spacerElement?.getAttribute("style")).toBe("height: 240px;");
  });

  it("keeps the lower spacer after the pinned turn completes", async () => {
    const streamingEntries = [
      {
        id: "user-turn-2",
        turnId: "turn-2",
        kind: "user-message",
        status: "completed",
        text: "Newest turn",
      },
      {
        id: "assistant-turn-2",
        turnId: "turn-2",
        kind: "assistant-message",
        phase: null,
        status: "streaming",
        text: "Streaming response",
      },
    ] as const;
    const completedEntries = [
      {
        ...streamingEntries[0],
      },
      {
        ...streamingEntries[1],
        status: "completed",
        text: "Completed response",
      },
    ] as const;
    const rendered = render(
      <ConversationScrollHarness activeTurnId="turn-1" chatEntries={[]} pendingTurnId={null} />,
    );

    const scrollContainerElement = screen.getByTestId("conversation-scroll-container");
    if (!(scrollContainerElement instanceof HTMLDivElement)) {
      throw new Error("Expected a div scroll container.");
    }

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 420,
      top: 100,
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={streamingEntries}
        pendingTurnId="turn-2"
      />,
    );

    const newestTurnElement = screen.getByText("Newest turn").closest("[data-turn-id]");
    if (!(newestTurnElement instanceof HTMLDivElement)) {
      throw new Error("Expected the newest turn wrapper to exist.");
    }

    defineElementRect(newestTurnElement, {
      height: 200,
      scrollContainerElement,
      top: 280,
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={streamingEntries}
        pendingTurnId="turn-2"
      />,
    );

    await waitFor(() => {
      const spacerElement = scrollContainerElement.querySelector(
        '[data-slot="conversation-bottom-spacer"]',
      );
      expect(spacerElement?.getAttribute("style")).toBe("height: 220px;");
    });

    defineElementRect(newestTurnElement, {
      height: 260,
      scrollContainerElement,
      top: 100,
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={completedEntries}
        pendingTurnId={null}
      />,
    );

    await waitFor(() => {
      const spacerElement = scrollContainerElement.querySelector(
        '[data-slot="conversation-bottom-spacer"]',
      );
      expect(spacerElement?.getAttribute("style")).toBe("height: 160px;");
    });
  });

  it("re-aligns after reserving space when the previous thread was shorter than the viewport", async () => {
    const initialEntries = [
      {
        id: "user-turn-1",
        turnId: "turn-1",
        kind: "user-message",
        status: "completed",
        text: "Earlier turn",
      },
      {
        id: "assistant-turn-1",
        turnId: "turn-1",
        kind: "assistant-message",
        phase: null,
        status: "completed",
        text: "Earlier response",
      },
    ] as const;
    const nextEntries = [
      ...initialEntries,
      {
        id: "user-turn-2",
        turnId: "turn-2",
        kind: "user-message",
        status: "completed",
        text: "Newest turn",
      },
      {
        id: "assistant-turn-2",
        turnId: "turn-2",
        kind: "assistant-message",
        phase: null,
        status: "streaming",
        text: "Streaming response",
      },
    ] as const;
    const rendered = render(
      <ConversationScrollHarness
        activeTurnId="turn-1"
        chatEntries={initialEntries}
        pendingTurnId={null}
      />,
    );

    const scrollContainerElement = screen.getByTestId("conversation-scroll-container");
    if (!(scrollContainerElement instanceof HTMLDivElement)) {
      throw new Error("Expected a div scroll container.");
    }

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 640,
      top: 100,
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={nextEntries}
        pendingTurnId="turn-2"
      />,
    );

    const newestTurnElement = screen.getByText("Newest turn").closest("[data-turn-id]");
    if (!(newestTurnElement instanceof HTMLDivElement)) {
      throw new Error("Expected the newest turn wrapper to exist.");
    }

    defineElementRect(newestTurnElement, {
      height: 180,
      scrollContainerElement,
      top: 460,
    });

    let maxScrollTop = 0;
    Object.defineProperty(scrollContainerElement, "scrollTop", {
      configurable: true,
      get() {
        return maxScrollTop;
      },
      set(nextValue: number) {
        maxScrollTop = Math.min(nextValue, 0);
      },
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={nextEntries}
        pendingTurnId="turn-2"
      />,
    );

    Object.defineProperty(scrollContainerElement, "scrollTop", {
      configurable: true,
      get() {
        return maxScrollTop;
      },
      set(nextValue: number) {
        maxScrollTop = Math.min(nextValue, 280);
      },
    });

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(280);
    });

    const spacerElement = scrollContainerElement.querySelector(
      '[data-slot="conversation-bottom-spacer"]',
    );
    expect(spacerElement?.getAttribute("style")).toBe("height: 460px;");
  });

  it("does not snap to top again when streamed chunks update the pinned turn", async () => {
    const initialEntries = [
      {
        id: "user-turn-1",
        turnId: "turn-1",
        kind: "user-message",
        status: "completed",
        text: "Earlier turn",
      },
      {
        id: "assistant-turn-1",
        turnId: "turn-1",
        kind: "assistant-message",
        phase: null,
        status: "completed",
        text: "Earlier response",
      },
    ] as const;
    const startedEntries = [
      ...initialEntries,
      {
        id: "user-turn-2",
        turnId: "turn-2",
        kind: "user-message",
        status: "completed",
        text: "Newest turn",
      },
      {
        id: "assistant-turn-2",
        turnId: "turn-2",
        kind: "assistant-message",
        phase: null,
        status: "streaming",
        text: "First chunk",
      },
    ] as const;
    const streamedEntries = [
      ...initialEntries,
      {
        id: "user-turn-2",
        turnId: "turn-2",
        kind: "user-message",
        status: "completed",
        text: "Newest turn",
      },
      {
        id: "assistant-turn-2",
        turnId: "turn-2",
        kind: "assistant-message",
        phase: null,
        status: "streaming",
        text: "First chunk Second chunk",
      },
    ] as const;
    const rendered = render(
      <ConversationScrollHarness
        activeTurnId="turn-1"
        chatEntries={initialEntries}
        pendingTurnId={null}
      />,
    );

    const scrollContainerElement = screen.getByTestId("conversation-scroll-container");
    if (!(scrollContainerElement instanceof HTMLDivElement)) {
      throw new Error("Expected a div scroll container.");
    }

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 420,
      top: 100,
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={startedEntries}
        pendingTurnId="turn-2"
      />,
    );

    const newestTurnElement = screen.getByText("Newest turn").closest("[data-turn-id]");
    if (!(newestTurnElement instanceof HTMLDivElement)) {
      throw new Error("Expected the newest turn wrapper to exist.");
    }

    defineElementRect(newestTurnElement, {
      height: 180,
      scrollContainerElement,
      top: 340,
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={startedEntries}
        pendingTurnId="turn-2"
      />,
    );

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(228);
    });

    defineElementRect(newestTurnElement, {
      height: 260,
      scrollContainerElement,
      top: 180,
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-2"
        chatEntries={streamedEntries}
        pendingTurnId={null}
      />,
    );

    await waitFor(() => {
      const spacerElement = scrollContainerElement.querySelector(
        '[data-slot="conversation-bottom-spacer"]',
      );
      expect(spacerElement?.getAttribute("style")).toBe("height: 160px;");
    });

    expect(scrollContainerElement.scrollTop).toBe(228);
  });
});
