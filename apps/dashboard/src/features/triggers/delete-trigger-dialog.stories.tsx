import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { DeleteTriggerDialog } from "./delete-trigger-dialog.js";

const meta = {
  title: "Dashboard/Triggers/Event/DeleteDialog",
  component: DeleteTriggerDialog,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    triggerName: "GitHub pushes to repo triage",
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
    errorMessage: "The webhook trigger no longer exists.",
  },
};
