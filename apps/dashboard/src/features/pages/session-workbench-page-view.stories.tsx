import type { Meta, StoryObj } from "@storybook/react-vite";

import { noop } from "../chat/components/chat-story-support.js";
import {
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  SessionWorkbenchStoryChrome,
  StorySandboxInstanceId,
} from "./session-story-support.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

const meta = {
  title: "Dashboard/Pages/SessionWorkbenchPageView",
  component: SessionWorkbenchPageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    sandboxInstanceId: StorySandboxInstanceId,
    alerts: [],
    isSecondaryPanelVisible: false,
    mainContent: createStorySessionMainContent(),
    primaryBottomPanel: createStorySessionBottomPanel(),
    secondaryPanel: <div className="h-full w-full border-t bg-white" />,
    secondaryPanelSize: 38,
    onSecondaryPanelResize: noop,
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
