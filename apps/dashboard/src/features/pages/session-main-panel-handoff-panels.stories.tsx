import type { Meta, StoryObj } from "@storybook/react-vite";

import { SessionChatRestoreFailedPanel } from "./session-chat-restore-failed-panel.js";
import { SessionChatRestoringPanel } from "./session-chat-restoring-panel.js";
import { SessionCliConnectingPanel } from "./session-cli-connecting-panel.js";
import { SessionCliEntryFailedPanel } from "./session-cli-entry-failed-panel.js";
import {
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  renderSessionWorkbenchStory,
  SessionWorkbenchStoryChrome,
} from "./session-story-support.js";

function noop(): void {}

const meta = {
  title: "Dashboard/Pages/SessionMainPanelHandoffPanels",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    function StoryDecorator(Story): React.JSX.Element {
      return (
        <SessionWorkbenchStoryChrome>
          <Story />
        </SessionWorkbenchStoryChrome>
      );
    },
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const SwitchingToCli: Story = {
  render: () =>
    renderSessionWorkbenchStory({
      mainContent: <SessionCliConnectingPanel />,
      primaryBottomPanel: null,
    }),
};

export const CliEntryFailed: Story = {
  render: () =>
    renderSessionWorkbenchStory({
      mainContent: (
        <SessionCliEntryFailedPanel
          errorMessage="codex executable missing from the sandbox image"
          onReturnToChat={noop}
        />
      ),
      primaryBottomPanel: null,
    }),
};

export const RestoringChat: Story = {
  render: () =>
    renderSessionWorkbenchStory({
      mainContent: <SessionChatRestoringPanel />,
      primaryBottomPanel: null,
    }),
};

export const RestoreFailed: Story = {
  render: () =>
    renderSessionWorkbenchStory({
      mainContent: (
        <SessionChatRestoreFailedPanel
          errorMessage="Minting sandbox connection token failed: Could not mint connection token."
          onRetry={noop}
        />
      ),
      primaryBottomPanel: null,
    }),
};

export const StableChatReference: Story = {
  render: () =>
    renderSessionWorkbenchStory({
      mainContent: createStorySessionMainContent(),
      primaryBottomPanel: createStorySessionBottomPanel(),
    }),
};
