import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatGenericItem } from "./chat-generic-item.js";

const meta = {
  title: "Dashboard/Chat/GenericItem",
  component: ChatGenericItem,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatGenericItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CollapsedWithDetails: Story = {
  args: {
    block: {
      id: "generic_context_compaction",
      turnId: "turn_generic",
      kind: "generic-item",
      itemType: "contextCompaction",
      title: "Context compaction",
      body: "Compacted the current session context before continuing.",
      detailsJson: JSON.stringify(
        {
          strategy: "drop-superseded-read-output",
          retainedMessages: 12,
        },
        null,
        2,
      ),
      status: "completed",
    },
  },
};

export const OpenCodeError: Story = {
  args: {
    block: {
      id: "opencode_error",
      turnId: "turn_opencode",
      kind: "generic-item",
      itemType: "opencode-error",
      title: "OpenCode error",
      body: 'Bad Request: {"detail":"The \'gpt-5.5-pro\' model is not supported when using Codex with a ChatGPT account."}',
      detailsJson: JSON.stringify(
        {
          name: "APIError",
          data: {
            message:
              'Bad Request: {"detail":"The \'gpt-5.5-pro\' model is not supported when using Codex with a ChatGPT account."}',
            statusCode: 400,
            isRetryable: false,
          },
          metadata: {
            url: "https://api.openai.com/v1/responses",
          },
        },
        null,
        2,
      ),
      status: "completed",
    },
  },
};

export const Streaming: Story = {
  args: {
    block: {
      id: "generic_streaming",
      turnId: "turn_generic",
      kind: "generic-item",
      itemType: "opencode-tool",
      title: "provider_tool",
      body: "running",
      detailsJson: JSON.stringify(
        {
          status: "running",
          input: {
            query: "current repository state",
          },
        },
        null,
        2,
      ),
      status: "streaming",
    },
  },
};

export const WithoutDetails: Story = {
  args: {
    block: {
      id: "generic_without_details",
      turnId: "turn_generic",
      kind: "generic-item",
      itemType: "enteredReviewMode",
      title: "Entered review mode",
      body: null,
      detailsJson: null,
      status: "completed",
    },
  },
};
