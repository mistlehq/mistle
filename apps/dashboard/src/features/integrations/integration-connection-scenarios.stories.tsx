import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";
import {
  createDenseAwsDetailViewStoryProps,
  createDenseDatadogDetailViewStoryProps,
  createDenseGitHubEnterpriseServerDetailViewStoryProps,
  createDenseGitHubAppDetailViewStoryProps,
  createDenseIntegrationGalleryStoryProps,
  createDenseJiraDetailViewStoryProps,
  createDenseLinearDetailViewStoryProps,
  createDenseOpenAiDetailViewStoryProps,
  createDensePlanetScaleDetailViewStoryProps,
  createDenseSigNozDetailViewStoryProps,
  createDenseSlackDetailViewStoryProps,
} from "./integration-story-harness.js";

const meta = {
  title: "Dashboard/Integrations/Connection/Scenarios",
  component: IntegrationConnectionDetailView,
  decorators: [withDashboardCenteredStory],
  args: {
    onCreateWebhookSource: () => {},
    onDeleteWebhookSource: () => {},
    onEditApiKey: () => {},
    onRefreshResource: () => {},
    onStartGitHubAppInstallation: () => {},
  },
} satisfies Meta<typeof IntegrationConnectionDetailView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const GitHubApp: Story = {
  name: "GitHub App",
  args: {
    ...createDenseGitHubAppDetailViewStoryProps(),
  },
};

export const GitHubEnterpriseServer: Story = {
  name: "GitHub Enterprise Server",
  args: {
    ...createDenseGitHubEnterpriseServerDetailViewStoryProps(),
  },
};

export const Jira: Story = {
  args: {
    ...createDenseJiraDetailViewStoryProps(),
  },
};

export const Linear: Story = {
  args: {
    ...createDenseLinearDetailViewStoryProps(),
  },
};

export const Slack: Story = {
  args: {
    ...createDenseSlackDetailViewStoryProps(),
  },
};

export const OpenAi: Story = {
  name: "OpenAI",
  args: {
    ...createDenseOpenAiDetailViewStoryProps(),
  },
};

export const Aws: Story = {
  name: "AWS",
  args: {
    ...createDenseAwsDetailViewStoryProps(),
  },
};

export const Datadog: Story = {
  args: {
    ...createDenseDatadogDetailViewStoryProps(),
  },
};

export const PlanetScale: Story = {
  name: "PlanetScale",
  args: {
    ...createDensePlanetScaleDetailViewStoryProps(),
  },
};

export const SigNoz: Story = {
  name: "SigNoz",
  args: {
    ...createDenseSigNozDetailViewStoryProps(),
  },
};

export const Gallery: Story = {
  args: {
    ...createDenseIntegrationGalleryStoryProps(),
  },
};
