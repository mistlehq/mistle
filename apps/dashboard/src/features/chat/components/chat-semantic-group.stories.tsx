import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  CodexFixtureExploringGroupEntry,
  CodexFixtureMakingEditsGroupEntry,
  CodexFixtureRunningCommandsLongOutputGroupEntry,
  CodexFixtureSearchingWebGroupEntry,
  CodexFixtureThinkingGroupEntry,
  CodexFixtureToolCallGroupEntry,
} from "../../session-agents/codex/fixtures/chat-fixtures.js";
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
