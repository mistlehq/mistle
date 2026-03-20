import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexStoryChatThreadEntries,
  CodexStoryChatThreadEntriesWithExploringGroup,
  CodexStoryChatThreadEntriesWithGenericItem,
  CodexStoryChatThreadEntriesWithStructuredPlan,
  CodexStoryChatThreadEntriesWithThinkingGroup,
} from "../../session-agents/codex/fixtures/chat-story-fixtures.js";
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
    entries: CodexStoryChatThreadEntries,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};

export const WithExploringGroup: Story = {
  args: {
    entries: CodexStoryChatThreadEntriesWithExploringGroup,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};

export const WithThinkingGroup: Story = {
  args: {
    entries: CodexStoryChatThreadEntriesWithThinkingGroup,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};

export const WithStructuredPlan: Story = {
  args: {
    entries: CodexStoryChatThreadEntriesWithStructuredPlan,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};

export const WithGenericItem: Story = {
  args: {
    entries: CodexStoryChatThreadEntriesWithGenericItem,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    pendingServerRequests: [],
  },
};
