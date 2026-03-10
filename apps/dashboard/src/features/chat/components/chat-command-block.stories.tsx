import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexStoryCommandApprovalRequest,
  CodexStoryCommandBlock,
} from "../../codex-client/codex-story-fixtures.js";
import { ChatCommandBlock } from "./chat-command-block.js";

const meta = {
  title: "Dashboard/Chat/ChatCommandBlock",
  component: ChatCommandBlock,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    approvalRequest: null,
    block: CodexStoryCommandBlock,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
  },
} satisfies Meta<typeof ChatCommandBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Completed: Story = {};

export const Streaming: Story = {
  args: {
    block: {
      ...CodexStoryCommandBlock,
      command: ["pnpm install", "pnpm storybook"].join("\n"),
      output: "Resolving workspace packages and preparing the dev server...",
      status: "streaming",
    },
  },
};

export const AwaitingApproval: Story = {
  args: {
    approvalRequest: CodexStoryCommandApprovalRequest,
    block: {
      ...CodexStoryCommandBlock,
      command: "pnpm add -D @storybook/addon-a11y",
      output: null,
      reason: "Install the accessibility addon before enabling a11y checks in Storybook.",
      status: "streaming",
    },
  },
};

export const ApprovalError: Story = {
  args: {
    approvalRequest: {
      ...CodexStoryCommandApprovalRequest,
      responseErrorMessage: "The approval window expired. Submit the request again.",
    },
  },
};
