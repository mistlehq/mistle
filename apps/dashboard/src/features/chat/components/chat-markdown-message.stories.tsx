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

/**
 * FormatGallery is the visual reference surface for chat markdown formatting.
 *
 * Use this story to review renderer changes across the common content blocks we
 * expect in chat output: headings, emphasis, lists, tasks, tables, fenced code
 * blocks, and mermaid diagrams.
 *
 * Update Streamdown presentation through the ChatMarkdownMessage styling
 * surface, not by rewriting this example payload:
 * - keep `ChatMarkdownMessage` responsible for the Streamdown wrapper and class
 *   hooks
 * - change Streamdown overrides in `apps/dashboard/src/index.css`, primarily
 *   under `.chat-markdown-content`
 * - keep this sample markdown stable unless the supported markdown surface
 *   itself has intentionally changed
 *
 * Use this story as the reference when changing Streamdown CSS, markdown
 * spacing, list rendering, task list layout, code block presentation, and
 * mermaid output.
 */
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
