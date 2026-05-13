import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardWorkspaceStory } from "../../../storybook/decorators.js";
import { noopRespondToServerRequest } from "../../chat/components/chat-story-support.js";
import {
  createCodexFixturePanelEntriesWithResponseErrors,
  CodexFixturePanelEntries,
} from "../codex/fixtures/approval-fixtures.js";
import type { ServerRequestEntry } from "./server-request-entries.js";
import { ServerRequestsPanel } from "./server-requests-panel.js";

const MixedServerRequestEntries: readonly ServerRequestEntry[] = [
  ...CodexFixturePanelEntries,
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
    entries: createCodexFixturePanelEntriesWithResponseErrors(),
  },
};

export const Responding: Story = {
  args: {
    isRespondingToServerRequest: true,
  },
};
