import type { Meta, StoryObj } from "@storybook/react-vite";

import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";
import {
  renderSessionWorkbenchStory,
  SessionWorkbenchStoryChrome,
} from "./session-story-support.js";

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
