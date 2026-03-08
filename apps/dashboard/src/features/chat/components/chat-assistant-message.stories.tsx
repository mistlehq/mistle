import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatAssistantMessage } from "./chat-assistant-message.js";

const meta = {
  title: "Dashboard/Chat/ChatAssistantMessage",
  component: ChatAssistantMessage,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatAssistantMessage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    isStreaming: false,
    text: "The session is healthy and the latest plan completed successfully.",
  },
};

export const Markdown: Story = {
  args: {
    isStreaming: false,
    text: [
      "## Review summary",
      "",
      "- 3 files changed",
      "- 1 migration generated",
      "- No policy warnings remain",
      "",
      "Run `pnpm lint && pnpm typecheck` before opening the PR.",
    ].join("\n"),
  },
};

export const Streaming: Story = {
  args: {
    isStreaming: true,
    text: "Thinking through the remaining config drift and preparing the next patch...",
  },
};
