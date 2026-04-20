import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { ChatMarkdownMessage } from "./chat-markdown-message.js";

const meta = {
  title: "Dashboard/Chat/MarkdownMessage",
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
      "Links also render inline, for example [Mistle Docs](https://docs.mistle.dev/).",
      "",
      "> This is a blockquote used for callouts, quoted output, or emphasized guidance.",
      "",
      "- Unordered item",
      "- Another item",
      "  - Nested item",
      "  1. Nested ordered item",
      "",
      "1. Ordered item",
      "2. Second ordered item",
      "   - Nested unordered item",
      "",
      "3. Continued ordered item",
      "4. Another continued item",
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

export const ExternalLinkSafety: Story = {
  args: {
    isStreaming: false,
    text: [
      "Open this external link from a normal chat markdown message:",
      "",
      "[mistlehq/e2e-test-repo pull request #125](https://github.com/mistlehq/e2e-test-repo/pull/125)",
    ].join("\n"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Focused Streamdown link-safety surface. This uses the real chat markdown link flow with the custom portaled external-link dialog, not a mocked replacement.",
      },
    },
  },
};

export const ExternalLinkSafetyOpen: Story = {
  args: {
    isStreaming: false,
    text: [
      "Open this external link from a normal chat markdown message:",
      "",
      "[mistlehq/e2e-test-repo pull request #125](https://github.com/mistlehq/e2e-test-repo/pull/125)",
    ].join("\n"),
  },
  parameters: {
    docs: {
      description: {
        story:
          "Same as ExternalLinkSafety, but the story clicks the markdown link in `play` so the external-link dialog is already visible for inspection.",
      },
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "mistlehq/e2e-test-repo pull request #125",
      }),
    );
    await expect(canvas.getByText("Open external link?")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Open link" })).toBeInTheDocument();
  },
};
