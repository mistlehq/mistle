import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatUserMessage } from "./chat-user-message.js";

const meta = {
  title: "Dashboard/Chat/ChatUserMessage",
  component: ChatUserMessage,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatUserMessage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    text: "Can you review the Storybook setup and tell me what still needs refactoring?",
  },
};

export const LongMessage: Story = {
  args: {
    text: [
      "Please check the dashboard chat rendering states.",
      "",
      "I want to verify:",
      "1. long paragraphs",
      "2. lists",
      "3. inline code like `pnpm storybook`",
      "4. wrapping behavior on narrower layouts",
    ].join("\n"),
  },
};
