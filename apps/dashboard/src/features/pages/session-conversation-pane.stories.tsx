import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import {
  CodexFixtureChatThreadEntriesWithStructuredPlan,
  CodexFixtureChatThreadEntriesWithThinkingGroup,
} from "../session-agents/codex/fixtures/chat-fixtures.js";
import {
  SessionComposerFixturePropsForLoadingModel,
  SessionComposerFixturePropsForNonImageCapableModel,
  SessionComposerFixtureStatusMessageForLoadingModel,
  SessionComposerFixtureStatusMessageForNonImageCapableModel,
  SessionComposerFixturePropsUploadingImageAttachments,
  SessionComposerFixturePropsWithPendingImageAttachments,
  SessionComposerFixtureProps,
  CodexFixtureSessionEntries,
  CodexFixtureSessionEntriesWithExploringGroup,
  CodexFixtureSessionServerRequests,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import { SessionConversationMainContent } from "./session-conversation-pane.js";
import {
  createStorySessionBottomPanel,
  renderSessionWorkbenchContentStory,
  StorySessionConversationPaneArgs,
  type SessionConversationStoryArgs,
} from "./session-story-support.js";

const baseArgs = {
  ...StorySessionConversationPaneArgs,
  chatEntries: CodexFixtureSessionEntries,
  composerViewModel: SessionComposerFixtureProps,
  serverRequestPanelEntries: CodexFixtureSessionServerRequests,
};

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/ConversationPane",
  component: SessionConversationMainContent,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: baseArgs,
  decorators: [
    withDashboardWorkspaceStory,
    function StoryDecorator(Story, context): React.JSX.Element {
      return renderSessionWorkbenchContentStory({
        mainContent: <Story />,
        primaryBottomPanel: createStorySessionBottomPanel(context.args),
      });
    },
  ],
} satisfies Meta<SessionConversationStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithExploringGroup: Story = {
  args: {
    chatEntries: CodexFixtureSessionEntriesWithExploringGroup,
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

export const WithPendingImageAttachments: Story = {
  args: {
    composerViewModel: SessionComposerFixturePropsWithPendingImageAttachments,
  },
};

export const UploadingImageAttachments: Story = {
  args: {
    composerViewModel: SessionComposerFixturePropsUploadingImageAttachments,
  },
};

export const NonImageCapableModelWithAttachments: Story = {
  args: {
    composerViewModel: {
      ...SessionComposerFixturePropsForNonImageCapableModel,
      statusMessage: SessionComposerFixtureStatusMessageForNonImageCapableModel,
    },
  },
};

export const LoadingSelectedModelWithAttachments: Story = {
  args: {
    composerViewModel: {
      ...SessionComposerFixturePropsForLoadingModel,
      statusMessage: SessionComposerFixtureStatusMessageForLoadingModel,
    },
  },
};
