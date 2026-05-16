import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { DeleteTriggerDialog } from "./delete-trigger-dialog.js";

const meta = {
  title: "Dashboard/Triggers/Schedule/DeleteDialog",
  component: DeleteTriggerDialog,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    triggerName: "Daily repository triage",
    errorMessage: null,
    isOpen: true,
    isPending: false,
    onConfirm: function onConfirm() {},
    onOpenChange: function onOpenChange() {},
  },
} satisfies Meta<typeof DeleteTriggerDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Pending: Story = {
  args: {
    isPending: true,
  },
};

export const ErrorState: Story = {
  args: {
    errorMessage: "The scheduled trigger no longer exists.",
  },
};
