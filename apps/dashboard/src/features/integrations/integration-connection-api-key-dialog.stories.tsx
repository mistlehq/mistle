import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { IntegrationConnectionApiKeyDialog } from "./integration-connection-api-key-dialog.js";

const meta = {
  title: "Dashboard/Integrations/Connection/ApiKeyDialog",
  component: IntegrationConnectionApiKeyDialog,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    connectionDisplayName: "GitHub Production",
    isOpen: true,
    isPending: false,
    onClose: () => {},
    onSubmit: () => {},
    onValueChange: () => {},
    value: "ghp_example_api_key_value",
  },
} satisfies Meta<typeof IntegrationConnectionApiKeyDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ErrorState: Story = {
  args: {
    errorMessage: "The API key could not be updated. Please try again later.",
  },
};

export const Pending: Story = {
  args: {
    isPending: true,
  },
};
