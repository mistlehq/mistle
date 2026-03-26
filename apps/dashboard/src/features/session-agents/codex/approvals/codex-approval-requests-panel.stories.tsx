import type { Meta, StoryObj } from "@storybook/react-vite";

import { noopRespondToServerRequest } from "../../../chat/components/chat-story-support.js";
import {
  createCodexFixturePanelEntriesWithResponseErrors,
  CodexFixturePanelEntries,
} from "../fixtures/approval-fixtures.js";
import { CodexApprovalRequestsPanel } from "./codex-approval-requests-panel.js";

const meta = {
  title: "Dashboard/Codex/CodexApprovalRequestsPanel",
  component: CodexApprovalRequestsPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    entries: CodexFixturePanelEntries,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: noopRespondToServerRequest,
  },
} satisfies Meta<typeof CodexApprovalRequestsPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedRequests: Story = {};

export const ResponseErrors: Story = {
  args: {
    entries: createCodexFixturePanelEntriesWithResponseErrors(),
  },
};

export const Responding: Story = {
  args: {
    isRespondingToServerRequest: true,
  },
};
