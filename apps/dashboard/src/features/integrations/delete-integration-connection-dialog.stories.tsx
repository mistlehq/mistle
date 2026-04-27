import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { DeleteIntegrationConnectionDialog } from "./delete-integration-connection-dialog.js";

const meta = {
  title: "Dashboard/Integrations/Dialogs",
  component: DeleteIntegrationConnectionDialog,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    connectionName: "GitHub Production",
    errorMessage: null,
    isOpen: true,
    isPending: false,
    onConfirm: () => {},
    onOpenChange: () => {},
  },
} satisfies Meta<typeof DeleteIntegrationConnectionDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DeleteConnection: Story = {};

export const DeleteConnectionError: Story = {
  args: {
    errorMessage: "This integration connection cannot be deleted while it is still used.",
  },
};

export const DeleteConnectionPending: Story = {
  args: {
    isPending: true,
  },
};
