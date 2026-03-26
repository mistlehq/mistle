import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexFixtureChatThreadEntriesWithStructuredPlan,
  CodexFixtureChatThreadEntriesWithThinkingGroup,
} from "../session-agents/codex/fixtures/chat-fixtures.js";
import {
  CodexFixtureSessionComposerPropsForNonImageCapableModel,
  CodexFixtureSessionComposerPropsUploadingImageAttachments,
  CodexFixtureSessionComposerPropsWithPendingImageAttachments,
  CodexFixtureSessionComposerProps,
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
  composerProps: CodexFixtureSessionComposerProps,
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
    composerProps: CodexFixtureSessionComposerPropsWithPendingImageAttachments,
  },
};

export const UploadingImageAttachments: Story = {
  args: {
    composerProps: CodexFixtureSessionComposerPropsUploadingImageAttachments,
  },
};

export const NonImageCapableModelWithAttachments: Story = {
  args: {
    composerProps: CodexFixtureSessionComposerPropsForNonImageCapableModel,
  },
};
