import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexFixtureChatThreadEntries,
  CodexFixtureChatThreadEntriesWithExploringGroup,
  CodexFixtureChatThreadEntriesWithGenericItem,
  CodexFixtureChatThreadEntriesWithStructuredPlan,
  CodexFixtureChatThreadEntriesWithThinkingGroup,
} from "../../session-agents/codex/fixtures/chat-fixtures.js";
import { ChatThread } from "./chat-thread.js";

const meta = {
  title: "Dashboard/Chat/ChatThread",
  component: ChatThread,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatThread>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    entries: CodexFixtureChatThreadEntries,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};

export const WithExploringGroup: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithExploringGroup,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};

export const WithThinkingGroup: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithThinkingGroup,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};

export const WithStructuredPlan: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithStructuredPlan,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};

export const WithGenericItem: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithGenericItem,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};
