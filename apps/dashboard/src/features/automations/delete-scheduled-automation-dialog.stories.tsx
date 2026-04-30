import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { DeleteWebhookAutomationDialog } from "./delete-webhook-automation-dialog.js";

const meta = {
  title: "Dashboard/Automations/Schedule/DeleteDialog",
  component: DeleteWebhookAutomationDialog,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    automationName: "Daily repository triage",
    errorMessage: null,
    isOpen: true,
    isPending: false,
    onConfirm: function onConfirm() {},
    onOpenChange: function onOpenChange() {},
  },
} satisfies Meta<typeof DeleteWebhookAutomationDialog>;

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
    errorMessage: "The scheduled automation no longer exists.",
  },
};
