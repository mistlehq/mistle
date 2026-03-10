import type { Meta, StoryObj } from "@storybook/react-vite";

import { CodexStoryChatThreadEntries } from "../../codex-client/codex-story-fixtures.js";
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
