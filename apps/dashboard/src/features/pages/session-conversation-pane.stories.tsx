import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatEntry } from "../chat/chat-types.js";
import {
  CodexFixtureChatThreadEntriesWithFileAttachment,
  CodexFixtureChatThreadEntriesWithMixedAttachments,
  CodexFixtureChatThreadEntriesWithSequentialActionGroups,
  CodexFixtureChatThreadEntriesWithStructuredPlan,
  CodexFixtureChatThreadEntriesWithThinkingGroup,
} from "../session-agents/codex/fixtures/chat-fixtures.js";
import {
  createReadySessionComposerStateInput,
  SessionComposerFixturePropsForLoadingModel,
  SessionComposerFixturePropsForNonImageCapableModel,
  SessionComposerFixtureStatusMessageForLoadingModel,
  SessionComposerFixtureStatusMessageForNonImageCapableModel,
  SessionComposerFixturePropsUploadingAttachments,
  SessionComposerFixturePropsWithPendingAttachments,
  CodexFixtureSessionEntriesWithExploringGroup,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import type { ServerRequestEntry } from "../session-agents/server-requests/index.js";
import type { SessionComposerDraftState } from "./session-composer/index.js";
import { createComposerDraft } from "./session-composer/session-composer-draft.js";
import {
  SessionConversationPanePlaygroundBaseArgs,
  type SessionConversationPaneStoryArgs,
} from "./session-conversation-pane-playground-fixtures.js";
import {
  SessionConversationPanePlaygroundArgTypes,
  SessionConversationPanePlaygroundControlInclude,
  SessionConversationPanePlaygroundDocs,
  SessionConversationPaneLayoutPlayground,
} from "./session-conversation-pane-playground.js";
import {
  SessionConversationBottomPanelController,
  SessionConversationBottomPanelDraftController,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import {
  createStorySessionBottomPanel,
  renderSessionWorkbenchContentStory,
} from "./session-story-support.js";

const InitialLoadAutoScrollEntries = Array.from({ length: 18 }, (_, index): ChatEntry[] => {
  const turnNumber = index + 1;
  const paddedTurnNumber = String(turnNumber).padStart(2, "0");

  return [
    {
      id: `initial-load-user-${paddedTurnNumber}`,
      turnId: `initial-load-turn-${paddedTurnNumber}`,
      kind: "user-message",
      status: "completed",
      text: `Turn ${paddedTurnNumber}: continue the implementation review and keep the context from the previous turn.`,
    },
    {
      id: `initial-load-assistant-${paddedTurnNumber}`,
      turnId: `initial-load-turn-${paddedTurnNumber}`,
      kind: "assistant-message",
      phase: null,
      status: "completed",
      text: [
        `Turn ${paddedTurnNumber} response.`,
        "I checked the relevant files, carried forward the open questions, and kept the next steps scoped to the current session.",
        "The remaining work is to keep the next patch narrow, verify the dashboard path directly, and call out any test gap before handing it back.",
      ].join("\n\n"),
    },
  ];
}).flat();

const LongTranscriptServerRequestPanelEntries: React.ComponentProps<
  typeof SessionConversationMainContent
>["serverRequestPanelEntries"] = [];

const LongTranscriptPendingDiffComments: React.ComponentProps<
  typeof SessionConversationBottomPanelDraftController
>["pendingDiffComments"] = [];

const LongTranscriptComposerStateInput: React.ComponentProps<
  typeof SessionConversationBottomPanelDraftController
>["composerStateInput"] = createReadySessionComposerStateInput({
  repositoryStatus: {
    branchLabel: "main",
    pullRequest: null,
  },
});

const UserInputCustomResponseRequestEntries: readonly ServerRequestEntry[] = [
  {
    requestId: "designer-user-input-custom-response-1",
    method: "tool/requestUserInput",
    kind: "tool-user-input",
    questions: [
      {
        header: "Provider",
        id: "provider-selection",
        options: [
          {
            label: "Use Gmail for the first workflow",
            isOther: false,
          },
          {
            label: "Use Outlook for the first workflow",
            isOther: false,
          },
        ],
        question: "Which email provider should Designer configure first?",
      },
    ],
    status: "pending",
    responseErrorMessage: null,
  },
];

const UserInputCustomResponseBaseComposerStateInput = createReadySessionComposerStateInput({
  repositoryStatus: {
    branchLabel: "designer/custom-response-story",
    pullRequest: null,
  },
});

const UserInputCustomResponseComposerStateInput: React.ComponentProps<
  typeof SessionConversationBottomPanelController
>["composerStateInput"] = {
  ...UserInputCustomResponseBaseComposerStateInput,
  turnControl: {
    ...UserInputCustomResponseBaseComposerStateInput.turnControl,
    activeTurnState: "running",
    canInterrupt: true,
    canSteer: true,
  },
};

const LongTranscriptStreamingTurnId = "long-transcript-streaming-turn";
const LongTranscriptStreamingMaxChunks = 160;

function createLongTranscriptAssistantText(input: {
  paragraphCount: number;
  turnNumber: number;
}): string {
  return Array.from({ length: input.paragraphCount }, (_, paragraphIndex) => {
    const paragraphNumber = paragraphIndex + 1;
    return [
      `Turn ${String(input.turnNumber)} response paragraph ${String(paragraphNumber)}.`,
      "This deterministic transcript block exists so the browser has to keep a large completed conversation mounted while the composer remains editable.",
      "It repeats a realistic amount of prose without storing a huge static fixture in the story file.",
    ].join(" ");
  }).join("\n\n");
}

function createLongTranscriptEntries(input: {
  assistantParagraphsPerTurn: number;
  turnCount: number;
}): readonly ChatEntry[] {
  return Array.from({ length: input.turnCount }, (_, index): ChatEntry[] => {
    const turnNumber = index + 1;
    const paddedTurnNumber = String(turnNumber).padStart(4, "0");
    const turnId = `long-transcript-turn-${paddedTurnNumber}`;

    return [
      {
        id: `${turnId}:user`,
        turnId,
        kind: "user-message",
        status: "completed",
        text: `Turn ${paddedTurnNumber}: continue the implementation review and preserve the previous context.`,
      },
      {
        id: `${turnId}:assistant`,
        turnId,
        kind: "assistant-message",
        phase: null,
        status: "completed",
        text: createLongTranscriptAssistantText({
          paragraphCount: input.assistantParagraphsPerTurn,
          turnNumber,
        }),
      },
    ];
  }).flat();
}

function createStreamingChunkText(chunkNumber: number): string {
  const paddedChunkNumber = String(chunkNumber).padStart(3, "0");
  if (chunkNumber % 12 === 0) {
    return [
      `Streaming chunk ${paddedChunkNumber}: captured a longer markdown/code update.`,
      "",
      "```ts",
      `const streamedChunk${String(chunkNumber)} = "profile the active streaming turn";`,
      "```",
    ].join("\n");
  }

  if (chunkNumber % 5 === 0) {
    return [
      `Streaming chunk ${paddedChunkNumber}:`,
      "- preserve the old completed transcript",
      "- update only the active response",
      "- keep scroll-follow work visible to the profiler",
    ].join("\n");
  }

  return [
    `Streaming chunk ${paddedChunkNumber}.`,
    "The assistant is appending content to the active turn while a large completed transcript remains mounted above it.",
  ].join(" ");
}

function createStreamingAssistantText(chunkCount: number): string {
  if (chunkCount === 0) {
    return "Preparing the next streamed response.";
  }

  return Array.from({ length: chunkCount }, (_, index) => createStreamingChunkText(index + 1)).join(
    "\n\n",
  );
}

function createLongTranscriptStreamingEntries(input: {
  completedEntries: readonly ChatEntry[];
  streamingChunkCount: number;
}): readonly ChatEntry[] {
  return [
    ...input.completedEntries,
    {
      id: `${LongTranscriptStreamingTurnId}:user`,
      turnId: LongTranscriptStreamingTurnId,
      kind: "user-message",
      status: "completed",
      text: "Stream a detailed implementation update while keeping the older transcript mounted.",
    },
    {
      id: `${LongTranscriptStreamingTurnId}:assistant`,
      turnId: LongTranscriptStreamingTurnId,
      kind: "assistant-message",
      phase: null,
      status: "streaming",
      text: createStreamingAssistantText(input.streamingChunkCount),
    },
  ];
}

function RenderCounter(input: { label: string }): React.JSX.Element {
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  return (
    <div
      className="rounded border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground"
      data-testid={`render-counter-${input.label}`}
    >
      {input.label}: {renderCountRef.current}
    </div>
  );
}

function UserInputCustomResponseHarness(): React.JSX.Element {
  const [composerDraft, setComposerDraft] = useState(() =>
    createComposerDraft("Actually use Postmark for this setup."),
  );
  const [lastResponseText, setLastResponseText] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const handleComposerDraftChange = useCallback(
    (nextComposerDraft: React.SetStateAction<typeof composerDraft>): void => {
      setComposerDraft(nextComposerDraft);
    },
    [],
  );
  const draftState = useMemo(
    (): SessionComposerDraftState => ({
      composerDraft,
      pendingBlueprintComments: [],
      pendingDiffComments: [],
      clearPendingBlueprintComments: function clearPendingBlueprintComments() {},
      clearPendingDiffComments: function clearPendingDiffComments() {},
      setComposerDraft: handleComposerDraftChange,
    }),
    [composerDraft, handleComposerDraftChange],
  );
  const chatEntries = useMemo(
    (): readonly ChatEntry[] => [
      {
        id: "user-input-custom-response-user-1",
        turnId: "user-input-custom-response-turn",
        kind: "user-message",
        status: "completed",
        text: "Set up the first outbound email workflow.",
      },
      {
        id: "user-input-custom-response-assistant-1",
        turnId: "user-input-custom-response-turn",
        kind: "assistant-message",
        phase: null,
        status: "completed",
        text: "I need one provider decision before I can continue configuring the workflow.",
      },
    ],
    [],
  );
  const handleRespondToServerRequest = useCallback(
    (requestId: string | number, result: unknown) => {
      setLastResponseText(JSON.stringify({ requestId, result }, null, 2));
    },
    [],
  );

  return renderSessionWorkbenchContentStory({
    mainContent: (
      <SessionConversationMainContent
        activeTurnId="user-input-custom-response-turn"
        chatEntries={chatEntries}
        isRespondingToServerRequest={false}
        isTurnInProgress
        onRespondToServerRequest={handleRespondToServerRequest}
        pendingTurnId={null}
        scrollContainerRef={scrollContainerRef}
        serverRequestPanelEntries={UserInputCustomResponseRequestEntries}
      />
    ),
    mainContentScrollContainerRef: scrollContainerRef,
    primaryBottomPanel: (
      <div className="space-y-3">
        <SessionConversationBottomPanelController
          chatEntries={chatEntries}
          composerStateInput={UserInputCustomResponseComposerStateInput}
          draftState={draftState}
          isRespondingToServerRequest={false}
          onRespondToServerRequest={handleRespondToServerRequest}
          serverRequestPanelEntries={UserInputCustomResponseRequestEntries}
          supportsUserInputRequestCustomResponse
        />
        {lastResponseText === null ? null : (
          <pre className="max-h-32 overflow-auto rounded border bg-muted/40 p-3 text-xs text-muted-foreground">
            {lastResponseText}
          </pre>
        )}
      </div>
    ),
  });
}

function LongTranscriptTypingHarness(): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const entries = useMemo(
    () =>
      createLongTranscriptEntries({
        assistantParagraphsPerTurn: 2,
        turnCount: 1000,
      }),
    [],
  );

  return renderSessionWorkbenchContentStory({
    mainContent: (
      <>
        <div className="px-4 pb-2">
          <RenderCounter label="isolated-main-content" />
        </div>
        <SessionConversationMainContent
          activeTurnId={null}
          autoScrollToBottomOnInitialLoad
          chatEntries={entries}
          initialBottomScrollResetKey="long-transcript-typing"
          isRespondingToServerRequest={false}
          isTurnInProgress={false}
          onRespondToServerRequest={
            SessionConversationPanePlaygroundBaseArgs.onRespondToServerRequest
          }
          pendingTurnId={null}
          scrollBehavior="follow-streaming-at-bottom"
          scrollContainerRef={scrollContainerRef}
          serverRequestPanelEntries={LongTranscriptServerRequestPanelEntries}
        />
      </>
    ),
    mainContentScrollContainerRef: scrollContainerRef,
    primaryBottomPanel: (
      <>
        <div className="pb-2">
          <RenderCounter label="isolated-composer-owner" />
        </div>
        <SessionConversationBottomPanelDraftController
          chatEntries={entries}
          clearPendingBlueprintComments={function clearPendingBlueprintComments() {}}
          clearPendingDiffComments={function clearPendingDiffComments() {}}
          composerStateInput={LongTranscriptComposerStateInput}
          draftResetKey="long-transcript-typing"
          isRespondingToServerRequest={false}
          onRespondToServerRequest={
            SessionConversationPanePlaygroundBaseArgs.onRespondToServerRequest
          }
          pendingBlueprintComments={[]}
          pendingDiffComments={LongTranscriptPendingDiffComments}
          serverRequestPanelEntries={LongTranscriptServerRequestPanelEntries}
        />
      </>
    ),
  });
}

function LongTranscriptStreamingHarness(): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const completedEntries = useMemo(
    () =>
      createLongTranscriptEntries({
        assistantParagraphsPerTurn: 2,
        turnCount: 1000,
      }),
    [],
  );
  const [streamingChunkCount, setStreamingChunkCount] = useState(1);
  const [isStreaming, setStreaming] = useState(false);
  const entries = useMemo(
    () =>
      createLongTranscriptStreamingEntries({
        completedEntries,
        streamingChunkCount,
      }),
    [completedEntries, streamingChunkCount],
  );
  const appendStreamingChunk = useCallback((): void => {
    setStreamingChunkCount((currentChunkCount) =>
      Math.min(currentChunkCount + 1, LongTranscriptStreamingMaxChunks),
    );
  }, []);
  const resetStreamingChunks = useCallback((): void => {
    setStreaming(false);
    setStreamingChunkCount(1);
  }, []);
  const toggleStreaming = useCallback((): void => {
    setStreaming((currentIsStreaming) => !currentIsStreaming);
  }, []);

  useEffect(() => {
    if (!isStreaming) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setStreamingChunkCount((currentChunkCount) => {
        const nextChunkCount = Math.min(currentChunkCount + 1, LongTranscriptStreamingMaxChunks);
        if (nextChunkCount >= LongTranscriptStreamingMaxChunks) {
          setStreaming(false);
        }

        return nextChunkCount;
      });
    }, 80);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isStreaming]);

  return renderSessionWorkbenchContentStory({
    mainContent: (
      <>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
          <RenderCounter label="streaming-main-content" />
          <div
            className="rounded border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground"
            data-testid="streaming-chunk-count"
          >
            chunks: {streamingChunkCount}
          </div>
          <button
            className="rounded border bg-background px-2 py-1 text-xs text-foreground shadow-sm hover:bg-muted"
            onClick={appendStreamingChunk}
            type="button"
          >
            Append chunk
          </button>
          <button
            className="rounded border bg-background px-2 py-1 text-xs text-foreground shadow-sm hover:bg-muted"
            onClick={toggleStreaming}
            type="button"
          >
            {isStreaming ? "Pause" : "Stream"}
          </button>
          <button
            className="rounded border bg-background px-2 py-1 text-xs text-foreground shadow-sm hover:bg-muted"
            onClick={resetStreamingChunks}
            type="button"
          >
            Reset
          </button>
        </div>
        <SessionConversationMainContent
          activeTurnId={LongTranscriptStreamingTurnId}
          autoScrollToBottomOnInitialLoad
          chatEntries={entries}
          initialBottomScrollResetKey="long-transcript-streaming"
          isRespondingToServerRequest={false}
          isTurnInProgress
          onRespondToServerRequest={
            SessionConversationPanePlaygroundBaseArgs.onRespondToServerRequest
          }
          pendingTurnId={null}
          scrollBehavior="follow-streaming-at-bottom"
          scrollContainerRef={scrollContainerRef}
          serverRequestPanelEntries={LongTranscriptServerRequestPanelEntries}
        />
      </>
    ),
    mainContentScrollContainerRef: scrollContainerRef,
    primaryBottomPanel: (
      <>
        <div className="pb-2">
          <RenderCounter label="streaming-composer-owner" />
        </div>
        <SessionConversationBottomPanelDraftController
          chatEntries={entries}
          clearPendingBlueprintComments={function clearPendingBlueprintComments() {}}
          clearPendingDiffComments={function clearPendingDiffComments() {}}
          composerStateInput={LongTranscriptComposerStateInput}
          draftResetKey="long-transcript-streaming"
          isRespondingToServerRequest={false}
          onRespondToServerRequest={
            SessionConversationPanePlaygroundBaseArgs.onRespondToServerRequest
          }
          pendingBlueprintComments={[]}
          pendingDiffComments={LongTranscriptPendingDiffComments}
          serverRequestPanelEntries={LongTranscriptServerRequestPanelEntries}
          showWorkingIndicator
        />
      </>
    ),
  });
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/ConversationPane",
  component: SessionConversationMainContent,
  tags: ["!autodocs"],
  parameters: {
    docs: {
      description: {
        component: SessionConversationPanePlaygroundDocs,
      },
      disable: true,
    },
    layout: "fullscreen",
  },
  argTypes: SessionConversationPanePlaygroundArgTypes,
  args: SessionConversationPanePlaygroundBaseArgs,
  decorators: [
    function StoryDecorator(Story, context): React.JSX.Element {
      const scrollContainerRef = useRef<HTMLDivElement | null>(null);

      if (context.parameters["customWorkbenchStory"] === true) {
        return <Story />;
      }

      const shouldRenderConversationWithScrollRef = context.args.autoScrollToBottomOnInitialLoad;

      return renderSessionWorkbenchContentStory({
        mainContent: shouldRenderConversationWithScrollRef ? (
          <SessionConversationMainContent
            activeTurnId={context.args.activeTurnId}
            autoScrollToBottomOnInitialLoad={context.args.autoScrollToBottomOnInitialLoad}
            chatEntries={context.args.chatEntries}
            initialBottomScrollResetKey={context.args.initialBottomScrollResetKey}
            isRespondingToServerRequest={context.args.isRespondingToServerRequest}
            isTurnInProgress={context.args.isTurnInProgress}
            onRespondToServerRequest={context.args.onRespondToServerRequest}
            pendingTurnId={context.args.pendingTurnId}
            scrollContainerRef={scrollContainerRef}
            serverRequestPanelEntries={context.args.serverRequestPanelEntries}
            {...(context.args.scrollBehavior === undefined
              ? {}
              : { scrollBehavior: context.args.scrollBehavior })}
          />
        ) : (
          <Story />
        ),
        ...(shouldRenderConversationWithScrollRef
          ? { mainContentScrollContainerRef: scrollContainerRef }
          : {}),
        primaryBottomPanel: createStorySessionBottomPanel(context.args),
      });
    },
  ],
} satisfies Meta<SessionConversationPaneStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LayoutPlayground: Story = {
  args: {
    semanticGroupItemGapPx: "gap-0",
  },
  parameters: {
    controls: {
      include: SessionConversationPanePlaygroundControlInclude,
    },
  },
  render: SessionConversationPaneLayoutPlayground,
};

export const Default: Story = {};

export const WithExploringGroup: Story = {
  args: {
    chatEntries: CodexFixtureSessionEntriesWithExploringGroup,
  },
};

export const WithSequentialActionGroups: Story = {
  args: {
    chatEntries: CodexFixtureChatThreadEntriesWithSequentialActionGroups,
  },
};

export const WithThinkingGroup: Story = {
  args: {
    chatEntries: CodexFixtureChatThreadEntriesWithThinkingGroup,
  },
};

export const WithStructuredPlan: Story = {
  args: {
    chatEntries: CodexFixtureChatThreadEntriesWithStructuredPlan,
  },
};

export const WithFileAttachment: Story = {
  args: {
    chatEntries: CodexFixtureChatThreadEntriesWithFileAttachment,
  },
};

export const WithMixedAttachments: Story = {
  args: {
    chatEntries: CodexFixtureChatThreadEntriesWithMixedAttachments,
  },
};

export const WithPendingAttachments: Story = {
  args: {
    composerViewModel: SessionComposerFixturePropsWithPendingAttachments,
  },
};

export const OpenCodeContextUsage: Story = {
  args: {
    composerViewModel: {
      ...SessionConversationPanePlaygroundBaseArgs.composerViewModel,
      contextUsage: {
        label: "60% context left",
        title: "400 tokens used of 1,000 token context window.",
      },
      modelOptions: [
        {
          value: "openai/gpt-5.3-codex",
          label: "OpenAI / GPT-5.3 Codex (default)",
        },
        {
          value: "anthropic/claude-sonnet-4-5",
          label: "Anthropic / Claude Sonnet 4.5",
        },
      ],
      selectedModel: "openai/gpt-5.3-codex",
      selectedReasoningEffort: null,
      showReasoningControl: false,
    },
  },
};

export const UploadingAttachments: Story = {
  args: {
    composerViewModel: SessionComposerFixturePropsUploadingAttachments,
    statusMessage: {
      message: "Uploading attachments...",
      variant: "default",
      presentation: "loading",
    },
  },
};

export const WithWorkingFooter: Story = {
  args: {
    activeTurnId: "turn-2",
    isTurnInProgress: true,
    showWorkingIndicator: true,
  },
};

export const InitialLoadAutoScroll: Story = {
  args: {
    autoScrollToBottomOnInitialLoad: true,
    chatEntries: InitialLoadAutoScrollEntries,
    initialBottomScrollResetKey: "storybook-initial-load",
    serverRequestPanelEntries: [],
  },
};

export const LongTranscriptTyping: Story = {
  parameters: {
    customWorkbenchStory: true,
  },
  render: LongTranscriptTypingHarness,
};

export const LongTranscriptStreaming: Story = {
  parameters: {
    customWorkbenchStory: true,
  },
  render: LongTranscriptStreamingHarness,
};

export const PendingUserInputCustomResponse: Story = {
  parameters: {
    customWorkbenchStory: true,
  },
  render: UserInputCustomResponseHarness,
};

export const PendingStartWithoutWorkingFooter: Story = {
  args: {
    composerViewModel: {
      ...SessionConversationPanePlaygroundBaseArgs.composerViewModel,
      isSubmitPending: true,
      submitDisabled: true,
      submitLabel: "Sending...",
    },
    showWorkingIndicator: false,
  },
};

export const DisconnectedWithError: Story = {
  args: {
    composerViewModel: {
      ...SessionConversationPanePlaygroundBaseArgs.composerViewModel,
      submitDisabled: true,
    },
    statusMessage: {
      message: "The session disconnected before the turn could be submitted.",
      variant: "alert",
      presentation: "notice",
    },
  },
};

export const NonImageCapableModelWithAttachments: Story = {
  args: {
    composerViewModel: {
      ...SessionComposerFixturePropsForNonImageCapableModel,
    },
    statusMessage: SessionComposerFixtureStatusMessageForNonImageCapableModel,
  },
};

export const LoadingSelectedModelWithAttachments: Story = {
  args: {
    composerViewModel: {
      ...SessionComposerFixturePropsForLoadingModel,
    },
    statusMessage: SessionComposerFixtureStatusMessageForLoadingModel,
  },
};
