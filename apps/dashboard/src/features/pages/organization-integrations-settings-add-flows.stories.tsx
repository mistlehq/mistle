import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  AddFlowStorySpecs,
  createAvailableCardsOverview,
  IntegrationSettingsAddFlowStory,
} from "./organization-integrations-settings-page-story-support.js";
import { OrganizationIntegrationsSettingsPageView } from "./organization-integrations-settings-page-view.js";

const meta = {
  title: "Dashboard/Integrations/AddFlows",
  component: OrganizationIntegrationsSettingsPageView,
  decorators: [withDashboardPageStory],
  args: {
    availableCards: [],
    connectedCards: [],
    isLoading: false,
    loadErrorMessage: null,
  },
} satisfies Meta<typeof OrganizationIntegrationsSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  render: function RenderStory() {
    return (
      <OrganizationIntegrationsSettingsPageView
        availableCards={createAvailableCardsOverview()}
        connectedCards={[]}
        isLoading={false}
        loadErrorMessage={null}
      />
    );
  },
};

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
