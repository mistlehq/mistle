import type { Meta, StoryObj } from "@storybook/react-vite";

import { CodexServerRequestsPanel } from "./codex-server-requests-panel.js";
import type { CodexServerRequestEntry } from "./codex-server-requests-state.js";

const MixedEntries: readonly CodexServerRequestEntry[] = [
  {
    requestId: "command-request-1",
    method: "item/commandExecution/requestApproval",
    kind: "command-approval",
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    reason: "Install the Storybook accessibility addon and verify the build.",
    command: "pnpm add -D @storybook/addon-a11y",
    cwd: "/workspace/mistle",
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
    grantRoot: "/workspace/mistle",
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
        id: "model_selection",
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
        id: "additional_notes",
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
    requestId: "generic-request-1",
    method: "tool/reportStatus",
    kind: "generic",
    paramsJson: JSON.stringify(
      {
        area: "storybook",
        status: "phase-1",
        storiesAdded: 28,
      },
      null,
      2,
    ),
    status: "pending",
    responseErrorMessage: null,
  },
];

const meta = {
  title: "Dashboard/Codex/CodexServerRequestsPanel",
  component: CodexServerRequestsPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    entries: MixedEntries,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
  },
} satisfies Meta<typeof CodexServerRequestsPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedRequests: Story = {};

export const ResponseErrors: Story = {
  args: {
    entries: MixedEntries.map((entry) => {
      if (entry.kind === "generic") {
        return {
          ...entry,
          responseErrorMessage: "The JSON payload was rejected by the server.",
        };
      }

      return {
        ...entry,
        responseErrorMessage: "The request response was not accepted. Try again.",
      };
    }),
  },
};

export const Responding: Story = {
  args: {
    isRespondingToServerRequest: true,
  },
};
