import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatUserMessage } from "./chat-user-message.js";

const meta = {
  title: "Dashboard/Chat/UserMessage",
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

export const ProviderLabeledJsonInput: Story = {
  args: {
    formatTriggerInput: true,
    text: 'Provider payload.event: {"type":"message.created","id":"evt_storybook_provider","text":"This field stays inside the formatted JSON block.","metadata":{"requestId":"req_storybook_provider","unsafeNumericId":1234567890123456789}}',
  },
};

export const RawJsonObjectInput: Story = {
  args: {
    formatTriggerInput: true,
    text: JSON.stringify({
      event: "session.bootstrap",
      payload: {
        requestId: "req_storybook_raw_json",
        workspaceId: "workspace_storybook",
      },
      metadata: {
        source: "trigger",
        receivedAt: "2026-06-05T10:00:00.000Z",
      },
    }),
  },
};

export const RawJsonObjectWithTextField: Story = {
  args: {
    formatTriggerInput: true,
    text: JSON.stringify({
      text: "Run this raw JSON trigger input.",
      channel: "C123",
      metadata: {
        requestId: "req_storybook_json_text",
      },
    }),
  },
};

export const MixedProseJsonInput: Story = {
  args: {
    formatTriggerInput: true,
    text: `Please investigate this issue here ${JSON.stringify({
      issue: {
        key: "MST-123",
        summary: "Fails to sync after reconnecting the integration",
        priority: "High",
      },
      reporter: {
        name: "Jonathan",
      },
    })} and then fix it`,
  },
};

export const MultipleJsonSpansInput: Story = {
  args: {
    formatTriggerInput: true,
    text: `First ${JSON.stringify({ requestId: "req_storybook_first" })} then ${JSON.stringify({
      requestId: "req_storybook_second",
    })}`,
  },
};

export const MarkdownFencedJsonInput: Story = {
  args: {
    formatTriggerInput: true,
    text: [
      "Please keep this code block as Markdown:",
      "```json",
      JSON.stringify({ text: "This remains inside a fenced code block." }),
      "```",
    ].join("\n"),
  },
};

export const OrdinaryJsonMessage: Story = {
  args: {
    text: `Please inspect JSON: ${JSON.stringify({
      body: "Look into this neutral JSON payload.",
      id: "evt_storybook_json_prefix",
      source: "custom-webhook",
    })}`,
  },
};
