import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexFixtureChatThreadEntriesWithStructuredPlan,
  CodexFixtureChatThreadEntriesWithThinkingGroup,
} from "../session-agents/codex/fixtures/chat-fixtures.js";
import {
  CodexFixtureSessionComposerProps,
  CodexFixtureSessionEntries,
  CodexFixtureSessionEntriesWithExploringGroup,
  CodexFixtureSessionServerRequests,
} from "../session-agents/codex/fixtures/session-fixtures.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

const baseArgs = {
  chatEntries: CodexFixtureSessionEntries,
  serverRequestPanelEntries: CodexFixtureSessionServerRequests,
  isRespondingToServerRequest: false,
  onRespondToServerRequest: function onRespondToServerRequest() {},
  composerProps: CodexFixtureSessionComposerProps,
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
      return (
        <SessionWorkbenchPageView
          alerts={[]}
          isSecondaryPanelVisible={false}
          mainContent={<Story />}
          onSecondaryPanelResize={function onSecondaryPanelResize() {}}
          primaryBottomPanel={<SessionConversationBottomPanel {...context.args} />}
          secondaryPanel={<></>}
          secondaryPanelSize={38}
          sandboxInstanceId="sbi_storybook"
        />
      );
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
