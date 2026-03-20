import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  createCodexStoryPanelEntriesWithResponseErrors,
  CodexStoryPanelEntries,
} from "../fixtures/approval-story-fixtures.js";
import { CodexApprovalRequestsPanel } from "./codex-approval-requests-panel.js";

const meta = {
  title: "Dashboard/Codex/CodexApprovalRequestsPanel",
  component: CodexApprovalRequestsPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    entries: CodexStoryPanelEntries,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
  },
} satisfies Meta<typeof CodexApprovalRequestsPanel>;

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
