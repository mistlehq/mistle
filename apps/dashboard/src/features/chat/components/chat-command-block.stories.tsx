import type { Meta, StoryObj } from "@storybook/react-vite";

import type { CodexCommandApprovalRequestEntry } from "../../codex-client/codex-server-requests-state.js";
import type { ChatCommandEntry } from "../chat-types.js";
import { ChatCommandBlock } from "./chat-command-block.js";

const DemoBlock: ChatCommandEntry = {
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
  cwd: "/workspace/mistle",
  exitCode: 0,
  commandStatus: "completed",
  reason: "Validate the shared Storybook package after adding dashboard stories.",
  status: "completed",
};

const DemoApprovalRequest: CodexCommandApprovalRequestEntry = {
  requestId: "request-command-1",
  method: "item/commandExecution/requestApproval",
  kind: "command-approval",
  threadId: "thread-1",
  turnId: "turn-2",
  itemId: "command-approval-1",
  reason: "This command needs network access to install and verify dependencies.",
  command: "pnpm add -D @storybook/addon-a11y",
  cwd: "/workspace/mistle",
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  networkHost: "registry.npmjs.org",
  networkProtocol: "https",
  networkPort: "443",
  status: "pending",
  responseErrorMessage: null,
};

const meta = {
  title: "Dashboard/Chat/ChatCommandBlock",
  component: ChatCommandBlock,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    approvalRequest: null,
    block: DemoBlock,
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
      ...DemoBlock,
      command: ["pnpm install", "pnpm storybook"].join("\n"),
      output: "Resolving workspace packages and preparing the dev server...",
      status: "streaming",
    },
  },
};

export const AwaitingApproval: Story = {
  args: {
    approvalRequest: DemoApprovalRequest,
    block: {
      ...DemoBlock,
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
      ...DemoApprovalRequest,
      responseErrorMessage: "The approval window expired. Submit the request again.",
    },
  },
};
