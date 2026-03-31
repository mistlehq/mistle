import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChatMarkdownMessage } from "./chat-markdown-message.js";

const ReviewSummaryText = [
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
].join("\n");

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
    text: ReviewSummaryText,
  },
};

export const FormatGallery: Story = {
  args: {
    isStreaming: false,
    text: [
      "# Heading 1",
      "",
      "## Heading 2",
      "",
      "### Heading 3",
      "",
      "Paragraph text can include **bold**, *italic*, ~~strikethrough~~, and `inline code`.",
      "",
      "Links also render inline, for example [OpenAI](https://openai.com/).",
      "",
      "> This is a blockquote used for callouts, quoted output, or emphasized guidance.",
      "",
      "- Unordered item",
      "- Another item",
      "  - Nested item",
      "",
      "1. Ordered item",
      "2. Second ordered item",
      "",
      "- [x] Completed task",
      "- [ ] Remaining task",
      "",
      "---",
      "",
      "| Column | Value |",
      "| --- | --- |",
      "| Status | Ready |",
      "| Owner | Dashboard |",
      "",
      "```ts",
      "export function greet(name: string): string {",
      "  return `Hello, ${name}`;",
      "}",
      "```",
      "",
      "```bash",
      "pnpm lint && pnpm typecheck",
      "```",
      "",
      "```mermaid",
      "flowchart LR",
      "  Prompt[Prompt] --> Renderer[ChatMarkdownMessage]",
      "  Renderer --> Output[Rendered markdown]",
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
