import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  AddFlowStorySpecs,
  IntegrationSettingsAddFlowStory,
  ProposedGitHubCloudExistingAppSetupStory,
  ProposedGitHubCloudManifestSetupStory,
  ProposedGitHubCloudAddFlowStory,
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

export const GitHubCloudProposedFlow: Story = {
  name: "GitHub Cloud Proposed Flow",
  render: function RenderStory() {
    return <ProposedGitHubCloudAddFlowStory />;
  },
};

export const GitHubCloudExistingAppSetup: Story = {
  name: "GitHub Cloud Existing App Setup",
  render: function RenderStory() {
    return <ProposedGitHubCloudExistingAppSetupStory />;
  },
};

export const GitHubCloudManifestSetup: Story = {
  name: "GitHub Cloud Manifest Setup",
  render: function RenderStory() {
    return <ProposedGitHubCloudManifestSetupStory />;
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
