import type { Meta, StoryObj } from "@storybook/react-vite";

import { IntegrationTile } from "./integration-tile.js";

const meta = {
  title: "Dashboard/Integrations/IntegrationTile",
  component: IntegrationTile,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof IntegrationTile>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Connected: Story = {
  args: {
    actionLabel: "View",
    actionVariant: "outline",
    description: "Connected to the organization and ready for sandbox bindings.",
    displayName: "GitHub",
    logoKey: "github",
    onAction: function onAction() {},
    statusBadge: "Connected",
  },
};

export const InvalidConfig: Story = {
  args: {
    actionDisabled: false,
    actionLabel: "Add",
    description: "The target exists, but required credentials or scopes are missing.",
    displayName: "OpenAI",
    logoKey: "openai",
    onAction: function onAction() {},
    statusBadge: "Invalid config",
  },
};
