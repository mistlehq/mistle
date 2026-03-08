import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatMarkdownMessage } from "./chat-markdown-message.js";

const meta = {
  title: "Dashboard/Chat/ChatMarkdownMessage",
  component: ChatMarkdownMessage,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatMarkdownMessage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ReviewSummary: Story = {
  args: {
    isStreaming: false,
    text: [
      "## Storybook rollout review",
      "",
      "The current setup is functional and a few cleanup items remain:",
      "",
      "- move shared font ownership out of `apps/dashboard`",
      "- keep adding stories only for prop-driven feature views",
      "- avoid Storybook-only runtime aliases for dashboard containers",
      "",
      "```bash",
      "pnpm storybook",
      "```",
    ].join("\n"),
  },
};

export const MermaidDiagram: Story = {
  args: {
    isStreaming: false,
    text: [
      "```mermaid",
      "flowchart LR",
      "  UI[packages/ui stories] --> SB[packages/storybook]",
      "  Dashboard[dashboard view stories] --> SB",
      "  SB --> Review[component review]",
      "```",
    ].join("\n"),
  },
};

export const Streaming: Story = {
  args: {
    isStreaming: true,
    text: "Drafting the next refactor so dashboard container logic stays out of Storybook...",
  },
};
