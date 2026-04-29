import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";

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
  renderConversationPaneLayoutPlayground,
} from "./session-conversation-pane-playground.js";
import { SessionConversationMainContent } from "./session-conversation-pane.js";
import {
  createStorySessionBottomPanel,
  renderSessionWorkbenchContentStory,
} from "./session-story-support.js";

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
      return renderSessionWorkbenchContentStory({
        mainContent: <Story />,
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
  render: renderConversationPaneLayoutPlayground,
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
