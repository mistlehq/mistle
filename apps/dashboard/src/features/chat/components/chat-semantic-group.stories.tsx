import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import {
  CodexFixtureExploringGroupEntry,
  CodexFixtureMakingEditsGroupEntry,
  CodexFixtureRunningCommandsLongOutputGroupEntry,
  CodexFixtureSearchingWebGroupEntry,
  CodexFixtureThinkingGroupEntry,
  CodexFixtureToolCallGroupEntry,
} from "../../session-agents/codex/fixtures/chat-fixtures.js";
import { ChatSemanticGroup } from "./chat-semantic-group.js";

type ChatSemanticGroupStoryProps = ComponentProps<typeof ChatSemanticGroup> & {
  previewState: "completed" | "active";
};

function applyPreviewState(
  block: ChatSemanticGroupStoryProps["block"],
  previewState: ChatSemanticGroupStoryProps["previewState"],
): ChatSemanticGroupStoryProps["block"] {
  if (previewState === "completed") {
    return block;
  }

  return {
    ...block,
    status: "streaming",
    items: block.items.map((item, index) =>
      index === 0
        ? {
            ...item,
            status: "streaming",
          }
        : item,
    ),
  };
}

const meta = {
  title: "Dashboard/Chat/SemanticGroup",
  component: ChatSemanticGroup,
  tags: ["autodocs"],
  argTypes: {
    previewState: {
      control: "inline-radio",
      options: ["completed", "active"],
    },
  },
  args: {
    isRespondingToServerRequest: false,
    onRespondToServerRequest: () => {},
    pendingServerRequests: [],
    previewState: "completed",
  },
  parameters: {
    layout: "padded",
  },
  render: ({ previewState, ...args }) => (
    <ChatSemanticGroup {...args} block={applyPreviewState(args.block, previewState)} />
  ),
} satisfies Meta<ChatSemanticGroupStoryProps>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Exploring: Story = {
  args: {
    block: CodexFixtureExploringGroupEntry,
  },
};

export const Thinking: Story = {
  args: {
    block: CodexFixtureThinkingGroupEntry,
  },
};

export const MakingEdits: Story = {
  args: {
    block: CodexFixtureMakingEditsGroupEntry,
  },
};

export const SearchingWeb: Story = {
  args: {
    block: CodexFixtureSearchingWebGroupEntry,
  },
};

export const ToolCall: Story = {
  args: {
    block: CodexFixtureToolCallGroupEntry,
  },
};

export const RunningCommands: Story = {
  args: {
    block: CodexFixtureRunningCommandsLongOutputGroupEntry,
  },
};

export const GenericWithDetails: Story = {
  args: {
    block: {
      id: "turn_generic:generic:generic_context_compaction",
      turnId: "turn_generic",
      kind: "semantic-group",
      semanticKind: "generic",
      status: "completed",
      displayKeys: {
        active: "generic.active",
        completed: "generic.done",
      },
      counts: null,
      items: [
        {
          id: "generic_context_compaction",
          sourceKind: "generic-item",
          label: "Context compaction",
          detail: "Compacted the current session context before continuing.",
          detailKind: "plain",
          command: null,
          output: JSON.stringify(
            {
              strategy: "drop-superseded-read-output",
              retainedMessages: 12,
            },
            null,
            2,
          ),
          status: "completed",
        },
      ],
    },
  },
};

export const GenericOpenCodeError: Story = {
  args: {
    block: {
      id: "turn_opencode:generic:opencode_error",
      turnId: "turn_opencode",
      kind: "semantic-group",
      semanticKind: "generic",
      status: "completed",
      displayKeys: {
        active: "generic.active",
        completed: "generic.done",
      },
      counts: null,
      items: [
        {
          id: "opencode_error",
          sourceKind: "generic-item",
          label: "OpenCode error",
          detail:
            'Bad Request: {"detail":"The \'gpt-5.5-pro\' model is not supported when using Codex with a ChatGPT account."}',
          detailKind: "plain",
          command: null,
          output: JSON.stringify(
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
      ],
    },
  },
};

export const GenericBodyOnly: Story = {
  args: {
    block: {
      id: "turn_opencode:generic:opencode_body_only_error",
      turnId: "turn_opencode",
      kind: "semantic-group",
      semanticKind: "generic",
      status: "completed",
      displayKeys: {
        active: "generic.active",
        completed: "generic.done",
      },
      counts: null,
      items: [
        {
          id: "opencode_body_only_error",
          sourceKind: "generic-item",
          label: "OpenCode error",
          detail: "The selected model is not available for this account.",
          detailKind: "plain",
          command: null,
          output: null,
          status: "completed",
        },
      ],
    },
  },
};
