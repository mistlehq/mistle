import type { Meta, StoryObj } from "@storybook/react-vite";

import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";
import {
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  renderSessionWorkbenchStory,
  SessionWorkbenchStoryChrome,
} from "./session-story-support.js";

function noop(): void {}

const meta = {
  title: "Dashboard/Pages/SessionPrimaryPanelFailureStates",
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

export const CliEntryFailed: Story = {
  render: () =>
    renderSessionWorkbenchStory({
      mainContent: (
        <SessionPrimaryPanelStatusCard
          action={{
            label: "Return to chat",
            onClick: noop,
          }}
          description="codex executable missing from the sandbox image"
          title="Could not start Codex CLI"
          tone="destructive"
        />
      ),
      primaryBottomPanel: null,
    }),
};

export const RestoreFailed: Story = {
  render: () =>
    renderSessionWorkbenchStory({
      mainContent: (
        <SessionPrimaryPanelStatusCard
          description="Minting sandbox connection token failed: Could not mint connection token."
          title="Could not restore chat"
          tone="destructive"
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
