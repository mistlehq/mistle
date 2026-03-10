import type { Meta, StoryObj } from "@storybook/react-vite";

import { DropdownMenuItem } from "./dropdown-menu.js";
import { MoreActionsMenu } from "./more-actions-menu.js";

const meta = {
  title: "UI/MoreActionsMenu",
  component: MoreActionsMenu,
  args: {
    triggerLabel: "Open more actions",
    children: (
      <>
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </>
    ),
  },
} satisfies Meta<typeof MoreActionsMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
