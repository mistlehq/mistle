import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button.js";
import { SectionBlock } from "./section-block.js";

const meta = {
  title: "UI/SectionBlock",
  component: SectionBlock,
  tags: ["autodocs"],
  args: {
    title: "Section title",
  },
  parameters: {
    layout: "padded",
  },
  render: function Render(args): React.JSX.Element {
    return (
      <div className="w-full max-w-3xl">
        <SectionBlock {...args} />
      </div>
    );
  },
} satisfies Meta<typeof SectionBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
        Section content goes here.
      </div>
    ),
  },
};

export const WithDescriptionAndAction: Story = {
  args: {
    action: (
      <Button size="sm" variant="outline">
        Manage
      </Button>
    ),
    description: "Use this section to review status, configuration, and next steps.",
    children: (
      <div className="rounded-md border border-dashed p-4 text-muted-foreground text-sm">
        Section content goes here.
      </div>
    ),
  },
};

export const WithEmptyState: Story = {
  args: {
    emptyState: "Assign the agent harness for this sandbox profile.",
  },
};
