import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexStoryChatThreadEntriesWithStructuredPlan,
  CodexStoryChatThreadEntriesWithThinkingGroup,
  CodexStorySessionComposerProps,
  CodexStorySessionEntries,
  CodexStorySessionEntriesWithExploringGroup,
  CodexStorySessionServerRequests,
} from "../codex-client/codex-story-fixtures.js";
import { CodexSessionPaneBottomPanel, CodexSessionPaneMainContent } from "./codex-session-pane.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

const baseArgs = {
  chatEntries: CodexStorySessionEntries,
  serverRequestPanelEntries: CodexStorySessionServerRequests,
  isRespondingToServerRequest: false,
  onRespondToServerRequest: function onRespondToServerRequest() {},
  composerProps: CodexStorySessionComposerProps,
};

const meta = {
  title: "Dashboard/Pages/CodexSessionPane",
  component: CodexSessionPaneMainContent,
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
          primaryBottomPanel={<CodexSessionPaneBottomPanel {...context.args} />}
          secondaryPanel={<></>}
          secondaryPanelSize={38}
          sandboxInstanceId="sbi_storybook"
        />
      );
    },
  ],
} satisfies Meta<typeof CodexSessionPaneMainContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithExploringGroup: Story = {
  args: {
    chatEntries: CodexStorySessionEntriesWithExploringGroup,
  },
};

export const WithThinkingGroup: Story = {
  args: {
    chatEntries: CodexStoryChatThreadEntriesWithThinkingGroup,
  },
};

export const WithStructuredPlan: Story = {
  args: {
    chatEntries: CodexStoryChatThreadEntriesWithStructuredPlan,
  },
};
