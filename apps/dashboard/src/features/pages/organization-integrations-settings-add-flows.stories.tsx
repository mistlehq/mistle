import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  AddFlowStorySpecs,
  IntegrationSettingsAddFlowStory,
} from "./organization-integrations-settings-page-story-support.js";

function OrganizationIntegrationsAddFlowStory(): React.JSX.Element {
  return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.GitHubCloud} />;
}

const meta = {
  title: "Dashboard/Integrations/AddFlows",
  component: OrganizationIntegrationsAddFlowStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof OrganizationIntegrationsAddFlowStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const GitHubCloud: Story = {
  name: "GitHub Cloud",
  render: function RenderStory() {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.GitHubCloud} />;
  },
};

export const GitHubEnterpriseServer: Story = {
  name: "GitHub Enterprise Server",
  render: function RenderStory() {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.GitHubEnterpriseServer} />;
  },
};

export const Jira: Story = {
  render: function RenderStory() {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.Jira} />;
  },
};

export const Linear: Story = {
  render: function RenderStory() {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.Linear} />;
  },
};

export const OpenAI: Story = {
  name: "OpenAI",
  render: function RenderStory() {
    return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.OpenAI} />;
  },
};
