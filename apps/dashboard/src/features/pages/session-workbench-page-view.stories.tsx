import { Badge } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexStorySessionComposerProps,
  CodexStorySessionEntriesWithExploringGroup,
  CodexStorySessionServerRequests,
} from "../session-agents/codex/fixtures/session-story-fixtures.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

const meta = {
  title: "Dashboard/Pages/SessionWorkbenchPageView",
  component: SessionWorkbenchPageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    sandboxInstanceId: "sbi_storybook",
    alerts: [],
    isSecondaryPanelVisible: false,
    mainContent: (
      <SessionConversationMainContent
        chatEntries={CodexStorySessionEntriesWithExploringGroup}
        composerProps={CodexStorySessionComposerProps}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        serverRequestPanelEntries={CodexStorySessionServerRequests}
      />
    ),
    primaryBottomPanel: (
      <SessionConversationBottomPanel
        chatEntries={CodexStorySessionEntriesWithExploringGroup}
        composerProps={CodexStorySessionComposerProps}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        serverRequestPanelEntries={CodexStorySessionServerRequests}
      />
    ),
    secondaryPanel: <div className="h-full w-full border-t bg-white" />,
    secondaryPanelSize: 38,
    onSecondaryPanelResize: function onSecondaryPanelResize() {},
  },
  decorators: [
    function StoryDecorator(Story): React.JSX.Element {
      return (
        <div className="from-background to-muted/20 min-h-screen bg-linear-to-b">
          <div className="bg-background/80 flex h-12 items-center justify-end border-b px-4 backdrop-blur-sm">
            <Badge
              className="bg-emerald-600 text-white hover:bg-emerald-600/90"
              variant="secondary"
            >
              Connected
            </Badge>
          </div>
          <div className="h-[calc(100vh-3rem)]">
            <Story />
          </div>
        </div>
      );
    },
  ],
} satisfies Meta<typeof SessionWorkbenchPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAlerts: Story = {
  args: {
    alerts: [
      {
        title: "Could not load sandbox status",
        description: "The status endpoint returned a temporary network error.",
      },
      {
        title: "Sandbox failed",
        description: "The underlying sandbox exited before the session fully connected.",
      },
    ],
  },
};

export const WithSecondaryPane: Story = {
  args: {
    isSecondaryPanelVisible: true,
  },
};

export const MissingSessionId: Story = {
  args: {
    sandboxInstanceId: null,
  },
};
