import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { SessionMoreActionsView } from "./session-more-actions-view.js";

const meta = {
  title: "Dashboard/Sessions/SessionMoreActionsView",
  component: SessionMoreActionsView,
  tags: ["autodocs"],
  decorators: [withDashboardPageWidth],
  parameters: {
    layout: "padded",
  },
  args: {
    sandboxInstanceId: "sbi_storybook",
    agentConnectionState: "ready",
    connectedSession: {
      sandboxInstanceId: "sbi_storybook",
      connectedAtIso: "2026-03-08T08:00:00.000Z",
      expiresAtIso: "2026-03-08T10:00:00.000Z",
      threadId: "thread_storybook",
    },
    configJson: JSON.stringify({ model: "gpt-5" }, null, 2),
    configRequirementsJson: JSON.stringify({ sandbox: true }, null, 2),
    isReadingConfig: false,
    isReadingConfigRequirements: false,
    isConfigDialogOpen: false,
    onOpenChange: function onOpenChange() {},
    onOpenConfigSetup: function onOpenConfigSetup() {},
  },
} satisfies Meta<typeof SessionMoreActionsView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Connected: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Session actions" }));
    await expect(await canvas.findByRole("menuitem", { name: "View config setup" })).toBeVisible();
  },
};

export const Disabled: Story = {
  args: {
    agentConnectionState: "idle",
    connectedSession: null,
  },
};

export const DialogOpen: Story = {
  args: {
    isConfigDialogOpen: true,
  },
};

export const Loading: Story = {
  args: {
    isConfigDialogOpen: true,
    configJson: null,
    configRequirementsJson: null,
    isReadingConfig: true,
    isReadingConfigRequirements: true,
  },
};
