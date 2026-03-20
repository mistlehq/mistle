import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexStoryExploringGroupEntry,
  CodexStoryMakingEditsGroupEntry,
  CodexStoryRunningCommandsLongOutputGroupEntry,
  CodexStorySearchingWebGroupEntry,
  CodexStoryThinkingGroupEntry,
  CodexStoryToolCallGroupEntry,
} from "../../session-agents/codex/fixtures/chat-story-fixtures.js";
import { ChatSemanticGroup } from "./chat-semantic-group.js";

const meta = {
  title: "Dashboard/Chat/ChatSemanticGroup",
  component: ChatSemanticGroup,
  tags: ["autodocs"],
  args: {
    isRespondingToServerRequest: false,
    onRespondToServerRequest: () => {},
    pendingServerRequests: [],
  },
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatSemanticGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Exploring: Story = {
  args: {
    block: CodexStoryExploringGroupEntry,
  },
};

export const Thinking: Story = {
  args: {
    block: CodexStoryThinkingGroupEntry,
  },
};

export const MakingEdits: Story = {
  args: {
    block: CodexStoryMakingEditsGroupEntry,
  },
};

export const SearchingWeb: Story = {
  args: {
    block: CodexStorySearchingWebGroupEntry,
  },
};

export const ToolCall: Story = {
  args: {
    block: CodexStoryToolCallGroupEntry,
  },
};

export const RunningCommands: Story = {
  args: {
    block: CodexStoryRunningCommandsLongOutputGroupEntry,
  },
};
