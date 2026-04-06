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
