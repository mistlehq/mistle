import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexFixtureFileChangeApprovalRequest,
  CodexFixtureFileChangeBlock,
} from "../../session-agents/codex/fixtures/approval-fixtures.js";
import { ChatFileChangeBlock } from "./chat-file-change-block.js";
import { noopRespondToServerRequest } from "./chat-story-support.js";

const meta = {
  title: "Dashboard/Chat/ChatFileChangeBlock",
  component: ChatFileChangeBlock,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    approvalRequest: null,
    block: CodexFixtureFileChangeBlock,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: noopRespondToServerRequest,
  },
} satisfies Meta<typeof ChatFileChangeBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Completed: Story = {};

export const Streaming: Story = {
  args: {
    block: {
      ...CodexFixtureFileChangeBlock,
      output: "Applying the next patch to the dashboard chat view stories...",
      status: "streaming",
    },
  },
};

export const AwaitingApproval: Story = {
  args: {
    approvalRequest: CodexFixtureFileChangeApprovalRequest,
    block: {
      ...CodexFixtureFileChangeBlock,
      output: null,
      status: "streaming",
    },
  },
};

export const ApprovalError: Story = {
  args: {
    approvalRequest: {
      ...CodexFixtureFileChangeApprovalRequest,
      responseErrorMessage: "The file change approval was declined for this session.",
    },
  },
};
