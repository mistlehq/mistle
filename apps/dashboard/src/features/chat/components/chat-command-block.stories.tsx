import type { Meta, StoryObj } from "@storybook/react-vite";

import type { CommandApprovalRequestEntry } from "../../session-agents/server-requests/index.js";
import type { ChatCommandEntry } from "../chat-types.js";
import { ChatCommandBlock } from "./chat-command-block.js";
import { noopRespondToServerRequest } from "./chat-story-support.js";

const StoryCommandBlock: ChatCommandEntry = {
  id: "command-1",
  turnId: "turn-1",
  kind: "command-execution",
  command: "pnpm --filter @mistle/storybook build-storybook",
  output: [
    "storybook v10.2.16",
    "info => Cleaning outputDir: storybook-static",
    "info => Building preview",
    "info => Copying static files: apps/dashboard/public",
  ].join("\n"),
  cwd: "/root/mistle",
  exitCode: 0,
  commandStatus: "completed",
  reason: "Validate the shared Storybook package after adding dashboard stories.",
  status: "completed",
};

const StoryCommandApprovalRequest: CommandApprovalRequestEntry = {
  requestId: "request-command-1",
  method: "item/commandExecution/requestApproval",
  kind: "command-approval",
  threadId: "thread-1",
  turnId: "turn-2",
  itemId: "command-approval-1",
  reason: "This command needs network access to install and verify dependencies.",
  command: "pnpm add -D @storybook/addon-a11y",
  cwd: "/root/mistle",
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  networkHost: "registry.npmjs.org",
  networkProtocol: "https",
  networkPort: "443",
  status: "pending",
  responseErrorMessage: null,
};

const meta = {
  title: "Dashboard/Chat/CommandBlock",
  component: ChatCommandBlock,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    approvalRequest: null,
    block: StoryCommandBlock,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: noopRespondToServerRequest,
  },
} satisfies Meta<typeof ChatCommandBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Completed: Story = {};

export const Streaming: Story = {
  args: {
    block: {
      ...StoryCommandBlock,
      command: ["pnpm install", "pnpm storybook"].join("\n"),
      output: "Resolving workspace packages and preparing the dev server...",
      status: "streaming",
    },
  },
};

export const AwaitingApproval: Story = {
  args: {
    approvalRequest: StoryCommandApprovalRequest,
    block: {
      ...StoryCommandBlock,
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
      ...StoryCommandApprovalRequest,
      responseErrorMessage: "The approval window expired. Submit the request again.",
    },
  },
};
