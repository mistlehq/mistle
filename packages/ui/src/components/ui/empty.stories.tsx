import { ChatCircleTextIcon, PlusIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button.js";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty.js";

const meta = {
  title: "UI/Empty",
  component: Empty,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Empty>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    return (
      <Empty className="w-[520px]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChatCircleTextIcon />
          </EmptyMedia>
          <EmptyTitle>No messages yet</EmptyTitle>
          <EmptyDescription>
            Start a new conversation to inspect logs, review diffs, or continue a sandbox session.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button">
            <PlusIcon />
            New conversation
          </Button>
        </EmptyContent>
      </Empty>
    );
  },
};

export const InlineIllustration: Story = {
  render: function Render() {
    return (
      <Empty className="w-[520px]">
        <EmptyHeader>
          <EmptyMedia>
            <div className="bg-muted text-muted-foreground flex h-20 w-32 items-center justify-center rounded-xl border text-xs uppercase tracking-[0.2em]">
              Preview
            </div>
          </EmptyMedia>
          <EmptyTitle>No integrations configured</EmptyTitle>
          <EmptyDescription>
            Add an integration target to let sessions access external systems with explicit
            bindings.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  },
};
