// @vitest-environment jsdom

import type { CodexModelSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import {
  SandboxSessionTransport,
  type UploadedSandboxFile,
  type UploadFileInput,
} from "@mistle/sandbox-session-client";
import { createBrowserSandboxSessionRuntime } from "@mistle/sandbox-session-client/browser";
import { render, screen } from "@testing-library/react";
import { fireEvent, waitFor } from "@testing-library/react";
import { useMemo, useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import type { ChatEntry } from "../chat/chat-types.js";
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

const UploadedImageFixture: UploadedSandboxFile = {
  attachmentId: "att_123",
  kind: "image",
  threadId: "thread_123",
  originalFilename: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 4,
  path: "/root/.local/attachments/thread_123/upload.png",
};

function createImageFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "screenshot.png", { type: "image/png" });
}

function createCompletedConversationEntries(
  turns: ReadonlyArray<{
    assistantText: string;
    turnId: string;
    userText: string;
  }>,
): readonly ChatEntry[] {
  return turns.flatMap((turn) => [
    {
      id: `${turn.turnId}:user`,
      turnId: turn.turnId,
      kind: "user-message",
      status: "completed",
      text: turn.userText,
    },
    {
      id: `${turn.turnId}:assistant`,
      turnId: turn.turnId,
      kind: "assistant-message",
      phase: null,
      status: "completed",
      text: turn.assistantText,
    },
  ]);
}

function RenderedComposerPaneHarness(input: {
  uploadFile: (input: UploadFileInput) => Promise<UploadedSandboxFile>;
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
          uploadFile: input.uploadFile,
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
          composerCapabilities: [],
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
          hasExplicitModelSelection: true,
          modelOptions: [
            {
              value: ComposerModelFixture.model,
              label: ComposerModelFixture.displayName,
            },
          ],
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
        repositoryStatus: {
          branchLabel: null,
          pullRequest: null,
        },
        contextUsage: null,
        modelSelection: {
          required: true,
          showControls: true,
        },
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
      draftState={{
        composerText: "",
        pendingDiffComments: [],
        clearPendingDiffComments: () => {
          return;
        },
        setComposerText: () => {
          return;
        },
      }}
      isRespondingToServerRequest={false}
      onRespondToServerRequest={function onRespondToServerRequest() {}}
      serverRequestPanelEntries={[]}
    />
  );
}

function QueuedPromptComposerHarness(): React.JSX.Element {
  const [activeTurnState, setActiveTurnState] = useState<"idle" | "running">("running");
  const [composerText, setComposerText] = useState("");
  const [startedPrompts, setStartedPrompts] = useState<readonly string[]>([]);

  return (
    <div>
      <button
        onClick={() => {
          setActiveTurnState("idle");
        }}
        type="button"
      >
        Complete turn
      </button>
      <div data-testid="started-prompts">{startedPrompts.join(" | ")}</div>
      <SessionConversationBottomPanelController
        chatEntries={[]}
        composerStateInput={{
          bootstrap: {
            phase: { status: "ready" },
            composerCapabilities: [],
            establishedSnapshot: {
              availableModels: [ComposerModelFixture],
              configSnapshot: {
                model: ComposerModelFixture.model,
                modelReasoningEffort: ComposerModelFixture.defaultReasoningEffort,
              },
            },
          },
          clearSessionErrorMessage: () => {
            return;
          },
          configControl: {
            selectedModel: ComposerModelFixture.model,
            selectedReasoningEffort: ComposerModelFixture.defaultReasoningEffort,
            hasExplicitModelSelection: true,
            modelOptions: [
              {
                value: ComposerModelFixture.model,
                label: ComposerModelFixture.displayName,
              },
            ],
            canChangeReasoningEffort: true,
            isUpdating: false,
            setModel: () => {
              return;
            },
            setReasoningEffort: () => {
              return;
            },
          },
          attachmentControl: {
            canUploadAttachments: true,
            isUploadingAttachments: false,
            prepareAttachments: async ({ prompt }) => ({
              displayAttachments: [],
              prompt,
              submittedAttachments: [],
              uploadedAttachments: [],
            }),
          },
          repositoryStatus: {
            branchLabel: null,
            pullRequest: null,
          },
          contextUsage: null,
          modelSelection: {
            required: true,
            showControls: true,
          },
          sessionErrorMessage: null,
          turnControl: {
            activeTurnState,
            canSteer: activeTurnState === "running",
            canInterrupt: activeTurnState === "running",
            isStarting: false,
            isSteering: false,
            isInterrupting: false,
            completedTurnErrorMessage: null,
            startTurn: async ({ transcriptPrompt }) => {
              setStartedPrompts((currentStartedPrompts) => [
                ...currentStartedPrompts,
                transcriptPrompt ?? "",
              ]);
              setActiveTurnState("running");
            },
            steerTurn: async () => {
              return;
            },
            interruptTurn: () => {
              return;
            },
          },
        }}
        draftState={{
          composerText,
          pendingDiffComments: [],
          clearPendingDiffComments: () => {
            return;
          },
          setComposerText,
        }}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        serverRequestPanelEntries={[]}
      />
    </div>
  );
}

function ConversationScrollHarness(input: {
  activeTurnId: string | null;
  autoScrollToBottomOnInitialLoad?: boolean;
  initialBottomScrollResetKey?: string | null;
  isTurnInProgress?: boolean;
  pendingTurnId: string | null;
  scrollBehavior?: React.ComponentProps<typeof SessionConversationMainContent>["scrollBehavior"];
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
        {...(input.autoScrollToBottomOnInitialLoad === undefined
          ? {}
          : { autoScrollToBottomOnInitialLoad: input.autoScrollToBottomOnInitialLoad })}
        {...(input.initialBottomScrollResetKey === undefined
          ? {}
          : { initialBottomScrollResetKey: input.initialBottomScrollResetKey })}
        {...(input.scrollBehavior === undefined ? {} : { scrollBehavior: input.scrollBehavior })}
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
    scrollHeight?: number;
    scrollTop?: number;
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
    value: input.scrollTop ?? 0,
    writable: true,
  });
  Object.defineProperty(scrollContainerElement, "scrollHeight", {
    configurable: true,
    get() {
      return input.scrollHeight ?? input.clientHeight;
    },
  });
}

function defineScrollContainerScrollHeight(
  scrollContainerElement: HTMLDivElement,
  input: {
    scrollHeight: () => number;
  },
): void {
  Object.defineProperty(scrollContainerElement, "scrollHeight", {
    configurable: true,
    get: input.scrollHeight,
  });
}

function renderConversationScrollScenario(
  input: React.ComponentProps<typeof ConversationScrollHarness>,
): {
  rerenderConversation: (nextInput: React.ComponentProps<typeof ConversationScrollHarness>) => void;
  scrollContainerElement: HTMLDivElement;
} {
  const rendered = render(<ConversationScrollHarness {...input} />);
  const scrollContainerElement = screen.getByTestId("conversation-scroll-container");
  if (!(scrollContainerElement instanceof HTMLDivElement)) {
    throw new Error("Expected a div scroll container.");
  }

  return {
    rerenderConversation(nextInput) {
      rendered.rerender(<ConversationScrollHarness {...nextInput} />);
    },
    scrollContainerElement,
  };
}

async function waitForNestedAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

describe("SessionConversationBottomPanel", () => {
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
        uploadFile={async () => {
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
        uploadFile={async () => {
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

  it("queues the next prompt and starts it automatically after the active turn completes", async () => {
    render(<QueuedPromptComposerHarness />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Queue this follow-up prompt." },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), {
      ctrlKey: true,
      key: "Enter",
    });

    expect(screen.getByText("Queue this follow-up prompt.")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Complete turn" }));

    await waitFor(() => {
      expect(screen.getByTestId("started-prompts").textContent).toContain(
        "Queue this follow-up prompt.",
      );
      expect(screen.queryByRole("button", { name: "Remove queued message" })).toBeNull();
    });
  });

  it("allows removing a queued prompt before the next turn auto-starts", async () => {
    render(<QueuedPromptComposerHarness />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Remove this queued prompt." },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), {
      ctrlKey: true,
      key: "Enter",
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete turn" }));

    await waitFor(() => {
      expect(screen.getByTestId("started-prompts").textContent).toBe("");
    });
  });

  it("scrolls an initially loaded long conversation to the bottom once", async () => {
    const initialEntries = createCompletedConversationEntries([
      { turnId: "turn-1", userText: "Earlier turn", assistantText: "Earlier response" },
      { turnId: "turn-2", userText: "Newest turn", assistantText: "Newest response" },
    ]);
    const { rerenderConversation, scrollContainerElement } = renderConversationScrollScenario({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: true,
      chatEntries: initialEntries,
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 0,
      top: 100,
    });

    rerenderConversation({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: true,
      chatEntries: [...initialEntries],
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(800);
    });
  });

  it("does not scroll again after the initial loaded conversation scroll has applied", async () => {
    const initialEntries = createCompletedConversationEntries([
      { turnId: "turn-1", userText: "Earlier turn", assistantText: "Earlier response" },
    ]);
    const nextEntries = [
      ...initialEntries,
      ...createCompletedConversationEntries([
        { turnId: "turn-2", userText: "Follow-up turn", assistantText: "Follow-up response" },
      ]),
    ];
    const { rerenderConversation, scrollContainerElement } = renderConversationScrollScenario({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: true,
      chatEntries: initialEntries,
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    let scrollHeight = 1000;
    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 400,
      scrollHeight,
      scrollTop: 0,
      top: 100,
    });

    rerenderConversation({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: true,
      chatEntries: [...initialEntries],
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(600);
    });

    scrollContainerElement.scrollTop = 120;
    scrollHeight = 1400;
    defineScrollContainerScrollHeight(scrollContainerElement, {
      scrollHeight: () => scrollHeight,
    });

    rerenderConversation({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: true,
      chatEntries: nextEntries,
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    await waitForNestedAnimationFrame();
    expect(scrollContainerElement.scrollTop).toBe(120);
  });

  it("scrolls a new initially loaded conversation after the reset key changes", async () => {
    const initialEntries = createCompletedConversationEntries([
      { turnId: "thread-1-turn", userText: "Thread one", assistantText: "Thread one response" },
    ]);
    const nextEntries = createCompletedConversationEntries([
      { turnId: "thread-2-turn", userText: "Thread two", assistantText: "Thread two response" },
    ]);
    const { rerenderConversation, scrollContainerElement } = renderConversationScrollScenario({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: true,
      chatEntries: initialEntries,
      initialBottomScrollResetKey: "thread-1",
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    let scrollHeight = 1000;
    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 400,
      scrollHeight,
      scrollTop: 0,
      top: 100,
    });

    rerenderConversation({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: true,
      chatEntries: [...initialEntries],
      initialBottomScrollResetKey: "thread-1",
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(600);
    });

    scrollContainerElement.scrollTop = 0;
    scrollHeight = 1400;
    defineScrollContainerScrollHeight(scrollContainerElement, {
      scrollHeight: () => scrollHeight,
    });

    rerenderConversation({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: true,
      chatEntries: nextEntries,
      initialBottomScrollResetKey: "thread-2",
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(1000);
    });
  });

  it("leaves the initial scroll position alone when initial bottom scrolling is disabled", async () => {
    const initialEntries = createCompletedConversationEntries([
      { turnId: "turn-1", userText: "Earlier turn", assistantText: "Earlier response" },
    ]);
    const { rerenderConversation, scrollContainerElement } = renderConversationScrollScenario({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: false,
      chatEntries: initialEntries,
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 400,
      scrollHeight: 1200,
      scrollTop: 0,
      top: 100,
    });

    rerenderConversation({
      activeTurnId: null,
      autoScrollToBottomOnInitialLoad: false,
      chatEntries: [...initialEntries],
      pendingTurnId: null,
      scrollBehavior: "none",
    });

    await waitForNestedAnimationFrame();
    expect(scrollContainerElement.scrollTop).toBe(0);
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
    const { rerenderConversation, scrollContainerElement } = renderConversationScrollScenario({
      activeTurnId: "turn-1",
      chatEntries: initialEntries,
      pendingTurnId: null,
      scrollBehavior: "pin-active-turn-to-top",
    });

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 420,
      top: 100,
    });
    defineElementRect(screen.getByText("Earlier turn").closest("[data-turn-id]") as HTMLElement, {
      height: 140,
      top: 120,
    });

    rerenderConversation({
      activeTurnId: "turn-2",
      chatEntries: nextEntries,
      pendingTurnId: "turn-2",
      scrollBehavior: "pin-active-turn-to-top",
    });

    const newestTurnElement = screen.getByText("Newest turn").closest("[data-turn-id]");
    if (!(newestTurnElement instanceof HTMLDivElement)) {
      throw new Error("Expected the newest turn wrapper to exist.");
    }

    defineElementRect(newestTurnElement, {
      height: 180,
      scrollContainerElement,
      top: 340,
    });

    rerenderConversation({
      activeTurnId: "turn-2",
      chatEntries: nextEntries,
      pendingTurnId: "turn-2",
      scrollBehavior: "pin-active-turn-to-top",
    });

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
    const { rerenderConversation, scrollContainerElement } = renderConversationScrollScenario({
      activeTurnId: "turn-1",
      chatEntries: [],
      pendingTurnId: null,
      scrollBehavior: "pin-active-turn-to-top",
    });

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 420,
      top: 100,
    });

    rerenderConversation({
      activeTurnId: "turn-2",
      chatEntries: streamingEntries,
      pendingTurnId: "turn-2",
      scrollBehavior: "pin-active-turn-to-top",
    });

    const newestTurnElement = screen.getByText("Newest turn").closest("[data-turn-id]");
    if (!(newestTurnElement instanceof HTMLDivElement)) {
      throw new Error("Expected the newest turn wrapper to exist.");
    }

    defineElementRect(newestTurnElement, {
      height: 200,
      scrollContainerElement,
      top: 280,
    });

    rerenderConversation({
      activeTurnId: "turn-2",
      chatEntries: streamingEntries,
      pendingTurnId: "turn-2",
      scrollBehavior: "pin-active-turn-to-top",
    });

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

    rerenderConversation({
      activeTurnId: "turn-2",
      chatEntries: completedEntries,
      pendingTurnId: null,
      scrollBehavior: "pin-active-turn-to-top",
    });

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
    const { rerenderConversation, scrollContainerElement } = renderConversationScrollScenario({
      activeTurnId: "turn-1",
      chatEntries: initialEntries,
      pendingTurnId: null,
      scrollBehavior: "pin-active-turn-to-top",
    });

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 640,
      top: 100,
    });

    rerenderConversation({
      activeTurnId: "turn-2",
      chatEntries: nextEntries,
      pendingTurnId: "turn-2",
      scrollBehavior: "pin-active-turn-to-top",
    });

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

    rerenderConversation({
      activeTurnId: "turn-2",
      chatEntries: nextEntries,
      pendingTurnId: "turn-2",
      scrollBehavior: "pin-active-turn-to-top",
    });

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
        scrollBehavior="pin-active-turn-to-top"
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
        scrollBehavior="pin-active-turn-to-top"
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
        scrollBehavior="pin-active-turn-to-top"
      />,
    );

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(228);
    });
    await waitFor(() => {
      const spacerElement = scrollContainerElement.querySelector(
        '[data-slot="conversation-bottom-spacer"]',
      );
      expect(spacerElement?.getAttribute("style")).toBe("height: 240px;");
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
        scrollBehavior="pin-active-turn-to-top"
      />,
    );

    await waitFor(() => {
      const spacerElement = scrollContainerElement.querySelector(
        '[data-slot="conversation-bottom-spacer"]',
      );
      expect(spacerElement?.getAttribute("style")).toBe("height: 160px;");
      expect(scrollContainerElement.scrollTop).toBe(228);
    });
  });

  it("does not pin a new turn to the top when top pinning is disabled", async () => {
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
    const { rerenderConversation, scrollContainerElement } = renderConversationScrollScenario({
      activeTurnId: "turn-1",
      chatEntries: initialEntries,
      pendingTurnId: null,
      scrollBehavior: "follow-streaming-at-bottom",
    });

    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 420,
      scrollHeight: 620,
      scrollTop: 0,
      top: 100,
    });
    fireEvent.scroll(scrollContainerElement);

    rerenderConversation({
      activeTurnId: "turn-2",
      chatEntries: nextEntries,
      pendingTurnId: "turn-2",
      scrollBehavior: "follow-streaming-at-bottom",
    });

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(0);
      expect(
        scrollContainerElement.querySelector('[data-slot="conversation-bottom-spacer"]'),
      ).toBeNull();
    });
  });

  it("follows streaming content when the viewer is already at the bottom", async () => {
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
        status: "streaming",
        text: "First chunk",
      },
    ] as const;
    const streamedEntries = [
      {
        ...initialEntries[0],
      },
      {
        ...initialEntries[1],
        text: "First chunk\nSecond chunk",
      },
    ] as const;
    const { rerenderConversation, scrollContainerElement } = renderConversationScrollScenario({
      activeTurnId: "turn-1",
      chatEntries: initialEntries,
      pendingTurnId: null,
      scrollBehavior: "follow-streaming-at-bottom",
    });

    let scrollHeight = 1000;
    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 400,
      scrollHeight,
      scrollTop: 600,
      top: 100,
    });

    fireEvent.scroll(scrollContainerElement);

    scrollHeight = 1160;
    Object.defineProperty(scrollContainerElement, "scrollHeight", {
      configurable: true,
      get() {
        return scrollHeight;
      },
    });

    rerenderConversation({
      activeTurnId: "turn-1",
      chatEntries: streamedEntries,
      pendingTurnId: null,
      scrollBehavior: "follow-streaming-at-bottom",
    });

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(760);
    });
  });

  it("follows a sudden large assistant block when the thread previously fit without scrolling", async () => {
    const initialEntries = [
      {
        id: "user-turn-1",
        turnId: "turn-1",
        kind: "user-message",
        status: "completed",
        text: "Start a new response",
      },
      {
        id: "assistant-turn-1",
        turnId: "turn-1",
        kind: "assistant-message",
        phase: null,
        status: "streaming",
        text: "Short opening chunk",
      },
    ] as const;
    const largeBlockEntries = [
      {
        ...initialEntries[0],
      },
      {
        ...initialEntries[1],
        text: [
          "Short opening chunk",
          "Second large paragraph that appears all at once and makes the conversation overflow.",
          "Third large paragraph that keeps extending the assistant output in one render pass.",
          "Fourth large paragraph so the thread clearly grows beyond the viewport height.",
        ].join("\n\n"),
      },
    ] as const;
    const rendered = render(
      <ConversationScrollHarness
        activeTurnId="turn-1"
        chatEntries={initialEntries}
        pendingTurnId={null}
        scrollBehavior="follow-streaming-at-bottom"
      />,
    );

    const scrollContainerElement = screen.getByTestId("conversation-scroll-container");
    if (!(scrollContainerElement instanceof HTMLDivElement)) {
      throw new Error("Expected a div scroll container.");
    }

    let scrollHeight = 320;
    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 400,
      scrollHeight,
      scrollTop: 0,
      top: 100,
    });
    fireEvent.scroll(scrollContainerElement);

    scrollHeight = 980;
    Object.defineProperty(scrollContainerElement, "scrollHeight", {
      configurable: true,
      get() {
        return scrollHeight;
      },
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-1"
        chatEntries={largeBlockEntries}
        pendingTurnId={null}
        scrollBehavior="follow-streaming-at-bottom"
      />,
    );

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(580);
    });
  });

  it("follows a sudden large assistant block when the viewer was already at the bottom of an existing scroll container", async () => {
    const initialEntries = [
      {
        id: "user-turn-1",
        turnId: "turn-1",
        kind: "user-message",
        status: "completed",
        text: "Start a new response",
      },
      {
        id: "assistant-turn-1",
        turnId: "turn-1",
        kind: "assistant-message",
        phase: null,
        status: "streaming",
        text: "First paragraph\n\nSecond paragraph\n\nThird paragraph",
      },
    ] as const;
    const largeBlockEntries = [
      {
        ...initialEntries[0],
      },
      {
        ...initialEntries[1],
        text: [
          initialEntries[1].text,
          "Fourth paragraph arrives in the same render and grows the thread substantially.",
          "Fifth paragraph keeps extending the content so the container needs to move farther.",
          "Sixth paragraph ensures the resulting scroll delta is large enough to catch regressions.",
          "Seventh paragraph finishes the sudden block append.",
        ].join("\n\n"),
      },
    ] as const;
    const rendered = render(
      <ConversationScrollHarness
        activeTurnId="turn-1"
        chatEntries={initialEntries}
        pendingTurnId={null}
        scrollBehavior="follow-streaming-at-bottom"
      />,
    );

    const scrollContainerElement = screen.getByTestId("conversation-scroll-container");
    if (!(scrollContainerElement instanceof HTMLDivElement)) {
      throw new Error("Expected a div scroll container.");
    }

    let scrollHeight = 1000;
    defineScrollContainerMetrics(scrollContainerElement, {
      clientHeight: 400,
      scrollHeight,
      scrollTop: 600,
      top: 100,
    });
    fireEvent.scroll(scrollContainerElement);

    scrollHeight = 1480;
    Object.defineProperty(scrollContainerElement, "scrollHeight", {
      configurable: true,
      get() {
        return scrollHeight;
      },
    });

    rendered.rerender(
      <ConversationScrollHarness
        activeTurnId="turn-1"
        chatEntries={largeBlockEntries}
        pendingTurnId={null}
        scrollBehavior="follow-streaming-at-bottom"
      />,
    );

    await waitFor(() => {
      expect(scrollContainerElement.scrollTop).toBe(1080);
    });
  });
});
