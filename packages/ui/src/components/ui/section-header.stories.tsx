import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button.js";
import { SectionHeader } from "./section-header.js";

const meta = {
  title: "UI/SectionHeader",
  component: SectionHeader,
  args: {
    title: "Section title",
  },
} satisfies Meta<typeof SectionHeader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: {
    action: (
      <Button size="sm" variant="outline">
        Manage
      </Button>
    ),
  },
};
