import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";

import { IntegrationTile } from "./integration-tile.js";

const meta = {
  title: "Dashboard/Integrations/Primitives/Tile",
  component: IntegrationTile,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/integrations"]}>
        <Story />
      </MemoryRouter>
    ),
  ],
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
    actionHref: "/integrations/github-cloud",
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
    actionHref: "/integrations/openai-default/add",
    statusBadge: "Invalid config",
  },
};

export const WasenderAPI: Story = {
  name: "WasenderAPI",
  args: {
    actionLabel: "Add",
    description: "Connect WasenderAPI for hosted MCP tools and signed WhatsApp message webhooks.",
    displayName: "WasenderAPI",
    logoKey: "wasenderapi",
    actionHref: "/integrations/wasenderapi-mcp/add",
  },
};

export const Whapi: Story = {
  args: {
    actionLabel: "Add",
    description: "Connect Whapi for local MCP tools and WhatsApp channel webhooks.",
    displayName: "Whapi",
    logoKey: "whapi",
    actionHref: "/integrations/whapi-mcp/add",
  },
};
