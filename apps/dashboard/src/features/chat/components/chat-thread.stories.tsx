import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexFixtureChatThreadEntries,
  CodexFixtureChatThreadEntriesWithExploringGroup,
  CodexFixtureChatThreadEntriesWithGenericItem,
  CodexFixtureChatThreadEntriesWithStructuredPlan,
  CodexFixtureChatThreadEntriesWithThinkingGroup,
} from "../../session-agents/codex/fixtures/chat-fixtures.js";
import { noopRespondToServerRequest } from "./chat-story-support.js";
import { ChatThread } from "./chat-thread.js";

const BaseArgs = {
  isRespondingToServerRequest: false,
  onRespondToServerRequest: noopRespondToServerRequest,
  pendingServerRequests: [],
} satisfies Omit<React.ComponentProps<typeof ChatThread>, "entries">;

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
    ...BaseArgs,
  },
};

export const WithExploringGroup: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithExploringGroup,
    ...BaseArgs,
  },
};

export const WithThinkingGroup: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithThinkingGroup,
    ...BaseArgs,
  },
};

export const WithStructuredPlan: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithStructuredPlan,
    ...BaseArgs,
  },
};

export const WithGenericItem: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithGenericItem,
    ...BaseArgs,
  },
};
