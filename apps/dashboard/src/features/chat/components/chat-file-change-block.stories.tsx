import type { Meta, StoryObj } from "@storybook/react-vite";

import type { FileChangeApprovalRequestEntry } from "../../session-agents/server-requests/index.js";
import type { ChatFileChangeEntry } from "../chat-types.js";
import { ChatFileChangeBlock } from "./chat-file-change-block.js";
import { noopRespondToServerRequest } from "./chat-story-support.js";

const StoryFileChangeBlock: ChatFileChangeEntry = {
  id: "file-change-1",
  turnId: "turn-3",
  kind: "file-change",
  changes: [
    {
      path: "packages/storybook/.storybook/preview.ts",
      kind: "modified",
      diff: [
        "@@ -1,2 +1,3 @@",
        ' import "../../../apps/dashboard/src/index.css";',
        ' import "@mistle/ui/styles.css";',
        '+import "./preview-overrides.css";',
      ].join("\n"),
    },
    {
      path: "apps/dashboard/src/features/chat/components/chat-thread.stories.tsx",
      kind: "added",
      diff: [
        "@@ -0,0 +1,5 @@",
        "+export const Default = {",
        "+  args: {",
        "+    entries: DemoEntries,",
        "+  },",
        "+};",
      ].join("\n"),
    },
  ],
  output: "Updated Storybook preview imports and added the initial chat thread story.",
  fileChangeStatus: "completed",
  status: "completed",
};

const StoryFileChangeApprovalRequest: FileChangeApprovalRequestEntry = {
  requestId: "request-file-change-1",
  method: "item/fileChange/requestApproval",
  kind: "file-change-approval",
  threadId: "thread-1",
  turnId: "turn-4",
  itemId: "file-change-approval-1",
  reason: "The assistant wants to update shared Storybook config and dashboard chat stories.",
  grantRoot: "/root/mistle",
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  status: "pending",
  responseErrorMessage: null,
};

const meta = {
  title: "Dashboard/Chat/FileChangeBlock",
  component: ChatFileChangeBlock,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    approvalRequest: null,
    block: StoryFileChangeBlock,
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
      ...StoryFileChangeBlock,
      output: "Applying the next patch to the dashboard chat view stories...",
      status: "streaming",
    },
  },
};

export const AwaitingApproval: Story = {
  args: {
    approvalRequest: StoryFileChangeApprovalRequest,
    block: {
      ...StoryFileChangeBlock,
      output: null,
      status: "streaming",
    },
  },
};

export const ApprovalError: Story = {
  args: {
    approvalRequest: {
      ...StoryFileChangeApprovalRequest,
      responseErrorMessage: "The file change approval was declined for this session.",
    },
  },
};
