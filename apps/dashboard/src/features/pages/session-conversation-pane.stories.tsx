import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";
import { useRef } from "react";

import type { ChatEntry } from "../chat/chat-types.js";
import {
  CodexFixtureChatThreadEntriesWithFileAttachment,
  CodexFixtureChatThreadEntriesWithMixedAttachments,
  CodexFixtureChatThreadEntriesWithSequentialActionGroups,
  CodexFixtureChatThreadEntriesWithStructuredPlan,
  CodexFixtureChatThreadEntriesWithThinkingGroup,
} from "../session-agents/codex/fixtures/chat-fixtures.js";
import {
  SessionComposerFixturePropsForLoadingModel,
  SessionComposerFixturePropsForNonImageCapableModel,
  SessionComposerFixtureStatusMessageForLoadingModel,
  SessionComposerFixtureStatusMessageForNonImageCapableModel,
  SessionComposerFixturePropsUploadingAttachments,
  SessionComposerFixturePropsWithPendingAttachments,
  CodexFixtureSessionEntriesWithExploringGroup,
} from "../session-agents/codex/fixtures/session-fixtures.js";
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
import { SessionConversationMainContent } from "./session-conversation-pane.js";
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
        label: "Context 40% used",
        title: "400 used of 1,000 window, $1.75 total cost",
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
