import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardWorkspaceStory } from "../../../storybook/decorators.js";
import { noopRespondToServerRequest } from "../../chat/components/chat-story-support.js";
import type { ServerRequestEntry } from "./server-request-entries.js";
import { ServerRequestsPanel } from "./server-requests-panel.js";

const MixedServerRequestEntries: readonly ServerRequestEntry[] = [
  {
    requestId: "command-request-1",
    method: "item/commandExecution/requestApproval",
    kind: "command-approval",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    reason: "Install the Storybook accessibility addon and verify the build.",
    command: "pnpm add -D @storybook/addon-a11y",
    cwd: "/root/mistle",
    availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    networkHost: "registry.npmjs.org",
    networkProtocol: "https",
    networkPort: "443",
    status: "pending",
    responseErrorMessage: null,
  },
  {
    requestId: "file-change-request-1",
    method: "item/fileChange/requestApproval",
    kind: "file-change-approval",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-2",
    reason: "Apply Storybook config and dashboard chat story updates.",
    grantRoot: "/root/mistle",
    availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    status: "pending",
    responseErrorMessage: null,
  },
  {
    requestId: "user-input-request-1",
    method: "tool/requestUserInput",
    kind: "tool-user-input",
    questions: [
      {
        header: "Model",
        id: "model-selection",
        options: [
          {
            label: "GPT-5",
            description: "Higher quality output for review-heavy work.",
            isOther: false,
          },
          {
            label: "GPT-5 Mini",
            description: "Lower latency for incremental iteration.",
            isOther: false,
          },
        ],
        question: "Which default model should Storybook examples mention?",
      },
      {
        header: "Notes",
        id: "additional-notes",
        options: [
          {
            label: "Add a note",
            description: "Provide any dashboard-specific caveats.",
            isOther: true,
          },
        ],
        question: "Add any review notes for the Storybook rollout.",
      },
    ],
    status: "pending",
    responseErrorMessage: null,
  },
  {
    requestId: "opencode-permission-request-1",
    method: "opencode/permission/requestApproval",
    kind: "opencode-permission",
    sessionId: "opencode-session-1",
    permission: "bash",
    patterns: ["pnpm test"],
    availableDecisions: ["once", "always", "reject"],
    status: "pending",
    responseErrorMessage: null,
  },
];

function createMixedServerRequestEntriesWithResponseErrors(): readonly ServerRequestEntry[] {
  return MixedServerRequestEntries.map((entry) => {
    return {
      ...entry,
      responseErrorMessage: "The request response was not accepted. Try again.",
    };
  });
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/ServerRequestsPanel",
  component: ServerRequestsPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
  args: {
    entries: MixedServerRequestEntries,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: noopRespondToServerRequest,
  },
} satisfies Meta<typeof ServerRequestsPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedRequests: Story = {};

export const ResponseErrors: Story = {
  args: {
    entries: createMixedServerRequestEntriesWithResponseErrors(),
  },
};

export const Responding: Story = {
  args: {
    isRespondingToServerRequest: true,
  },
};
