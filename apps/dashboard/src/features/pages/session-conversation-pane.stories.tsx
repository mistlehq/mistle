import type { Meta, StoryObj } from "@storybook/react-vite";

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
  renderSessionWorkbenchStory,
  StorySessionConversationPaneArgs,
} from "./session-story-support.js";

const baseArgs = {
  ...StorySessionConversationPaneArgs,
  chatEntries: CodexFixtureSessionEntries,
  composerProps: SessionComposerFixtureProps,
  serverRequestPanelEntries: CodexFixtureSessionServerRequests,
};

const meta = {
  title: "Dashboard/Pages/SessionConversationPane",
  component: SessionConversationMainContent,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: baseArgs,
  decorators: [
    function StoryDecorator(Story, context): React.JSX.Element {
      return renderSessionWorkbenchStory({
        mainContent: <Story />,
        primaryBottomPanel: createStorySessionBottomPanel(context.args),
      });
    },
  ],
} satisfies Meta<typeof SessionConversationMainContent>;

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
    composerProps: SessionComposerFixturePropsWithPendingImageAttachments,
  },
};

export const UploadingImageAttachments: Story = {
  args: {
    composerProps: SessionComposerFixturePropsUploadingImageAttachments,
  },
};

export const NonImageCapableModelWithAttachments: Story = {
  args: {
    composerProps: SessionComposerFixturePropsForNonImageCapableModel,
    sessionStatusMessage: SessionComposerFixtureStatusMessageForNonImageCapableModel,
  },
};

export const LoadingSelectedModelWithAttachments: Story = {
  args: {
    composerProps: SessionComposerFixturePropsForLoadingModel,
    sessionStatusMessage: SessionComposerFixtureStatusMessageForLoadingModel,
  },
};
