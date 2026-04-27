import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  AddFlowStorySpecs,
  IntegrationSettingsAddFlowStory,
} from "./organization-integrations-settings-page-story-support.js";

function OrganizationIntegrationsAddFlowStory(): React.JSX.Element {
  return <IntegrationSettingsAddFlowStory {...AddFlowStorySpecs.Jira} />;
}

const meta = {
  title: "Dashboard/Integrations/AddFlows",
  component: OrganizationIntegrationsAddFlowStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof OrganizationIntegrationsAddFlowStory>;

export default meta;

type Story = StoryObj<typeof meta>;

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
