import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  ConversationWorkspaceFrame,
  ConversationWorkspaceHeader,
} from "./conversation-workspace-frame.js";

const meta = {
  title: "Dashboard/Shared/ConversationWorkspaceFrame",
  component: ConversationWorkspaceFrame,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    title: (
      <span className="block truncate text-sm font-medium text-foreground">
        Storybook workspace
      </span>
    ),
    actions: (
      <>
        <span
          aria-label="Connected"
          className="inline-block size-2.5 rounded-full border border-emerald-700 bg-emerald-600"
          role="status"
          title="Connected"
        />
        <Button size="sm" type="button" variant="ghost">
          TUI
        </Button>
      </>
    ),
    children: (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="rounded-lg border bg-card px-6 py-5 text-sm shadow-xs">
          Workspace content
        </div>
      </div>
    ),
  },
} satisfies Meta<typeof ConversationWorkspaceFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HeaderOnly: Story = {
  render: (args) => (
    <ConversationWorkspaceHeader
      {...(args.actions === undefined ? {} : { actions: args.actions })}
      title={args.title ?? "Storybook workspace"}
      className="from-background to-muted/20 bg-linear-to-b"
    />
  ),
};
