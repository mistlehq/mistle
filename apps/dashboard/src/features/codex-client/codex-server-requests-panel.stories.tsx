import type { Meta, StoryObj } from "@storybook/react-vite";

import { CodexServerRequestsPanel } from "./codex-server-requests-panel.js";
import {
  createCodexStoryPanelEntriesWithResponseErrors,
  CodexStoryPanelEntries,
} from "./codex-story-fixtures.js";

const meta = {
  title: "Dashboard/Codex/CodexServerRequestsPanel",
  component: CodexServerRequestsPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    entries: CodexStoryPanelEntries,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
  },
} satisfies Meta<typeof CodexServerRequestsPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedRequests: Story = {};

export const ResponseErrors: Story = {
  args: {
    entries: createCodexStoryPanelEntriesWithResponseErrors(),
  },
};

export const Responding: Story = {
  args: {
    isRespondingToServerRequest: true,
  },
};
