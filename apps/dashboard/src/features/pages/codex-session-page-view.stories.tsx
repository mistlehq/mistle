import { Badge } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexStorySessionComposerProps,
  CodexStorySessionEntries,
  CodexStorySessionEntriesWithExploringGroup,
  CodexStoryChatThreadEntriesWithStructuredPlan,
  CodexStoryChatThreadEntriesWithThinkingGroup,
  CodexStorySessionServerRequests,
} from "../codex-client/codex-story-fixtures.js";
import { CodexSessionPageView } from "./codex-session-page-view.js";

const meta = {
  title: "Dashboard/Pages/CodexSessionPageView",
  component: CodexSessionPageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    sandboxInstanceId: "sbi_storybook",
    hasTopAlert: false,
    sandboxStatusErrorMessage: null,
    startErrorMessage: null,
    sandboxFailureMessage: null,
    chatEntries: CodexStorySessionEntries,
    serverRequestPanelEntries: CodexStorySessionServerRequests,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    composerProps: CodexStorySessionComposerProps,
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
} satisfies Meta<typeof CodexSessionPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAlerts: Story = {
  args: {
    hasTopAlert: true,
    sandboxStatusErrorMessage: "Could not load sandbox status.",
    startErrorMessage: "The session failed to connect to the agent.",
    sandboxFailureMessage: "The sandbox exited before the transport was ready.",
  },
};

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
