import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexStoryFileChangeApprovalRequest,
  CodexStoryFileChangeBlock,
} from "../../session-agents/codex/fixtures/approval-story-fixtures.js";
import { ChatFileChangeBlock } from "./chat-file-change-block.js";

const meta = {
  title: "Dashboard/Chat/ChatFileChangeBlock",
  component: ChatFileChangeBlock,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    approvalRequest: null,
    block: CodexStoryFileChangeBlock,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
  },
} satisfies Meta<typeof ChatFileChangeBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Completed: Story = {};

export const Streaming: Story = {
  args: {
    block: {
      ...CodexStoryFileChangeBlock,
      output: "Applying the next patch to the dashboard chat view stories...",
      status: "streaming",
    },
  },
};

export const AwaitingApproval: Story = {
  args: {
    approvalRequest: CodexStoryFileChangeApprovalRequest,
    block: {
      ...CodexStoryFileChangeBlock,
      output: null,
      status: "streaming",
    },
  },
};

export const ApprovalError: Story = {
  args: {
    approvalRequest: {
      ...CodexStoryFileChangeApprovalRequest,
      responseErrorMessage: "The file change approval was declined for this session.",
    },
  },
};
