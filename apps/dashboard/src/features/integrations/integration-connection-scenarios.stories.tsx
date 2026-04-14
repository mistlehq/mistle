import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";
import {
  createAwsDetailViewStoryProps,
  createDatadogDetailViewStoryProps,
  createGitHubEnterpriseServerDetailViewStoryProps,
  createGitHubAppDetailViewStoryProps,
  createIntegrationGalleryStoryProps,
  createJiraDetailViewStoryProps,
  createLinearDetailViewStoryProps,
  createOpenAiDetailViewStoryProps,
  createPlanetScaleDetailViewStoryProps,
  createSigNozDetailViewStoryProps,
  createSlackDetailViewStoryProps,
} from "./integration-story-harness.js";

function withoutStoryHandlers(
  input: React.ComponentProps<typeof IntegrationConnectionDetailView>,
): Omit<
  React.ComponentProps<typeof IntegrationConnectionDetailView>,
  | "onCreateWebhookSource"
  | "onDeleteWebhookSource"
  | "onEditApiKey"
  | "onRefreshResource"
  | "onStartGitHubAppInstallation"
> {
  const {
    onCreateWebhookSource: _onCreateWebhookSource,
    onDeleteWebhookSource: _onDeleteWebhookSource,
    onEditApiKey: _onEditApiKey,
    onRefreshResource: _onRefreshResource,
    onStartGitHubAppInstallation: _onStartGitHubAppInstallation,
    ...rest
  } = input;

  return rest;
}

const meta = {
  title: "Dashboard/Integrations/Connection/Scenarios",
  component: IntegrationConnectionDetailView,
  decorators: [withDashboardCenteredStory],
  args: {
    onCreateWebhookSource: (_input: { connectionId: string }) => {},
    onDeleteWebhookSource: (_input: { connectionId: string; webhookSourceId: string }) => {},
    onEditApiKey: (_connectionId: string) => {},
    onRefreshResource: (_input: { connectionId: string; kind: string }) => {},
    onStartGitHubAppInstallation: async (_connectionId: string) => {},
  },
} satisfies Meta<typeof IntegrationConnectionDetailView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const GitHubApp: Story = {
  name: "GitHub App",
  args: {
    ...withoutStoryHandlers(createGitHubAppDetailViewStoryProps()),
  },
};

export const GitHubEnterpriseServer: Story = {
  name: "GitHub Enterprise Server",
  args: {
    ...withoutStoryHandlers(createGitHubEnterpriseServerDetailViewStoryProps()),
  },
};

export const Jira: Story = {
  args: {
    ...withoutStoryHandlers(createJiraDetailViewStoryProps()),
  },
};

export const Linear: Story = {
  args: {
    ...withoutStoryHandlers(createLinearDetailViewStoryProps()),
  },
};

export const Slack: Story = {
  args: {
    ...withoutStoryHandlers(createSlackDetailViewStoryProps()),
  },
};

export const OpenAi: Story = {
  name: "OpenAI",
  args: {
    ...withoutStoryHandlers(createOpenAiDetailViewStoryProps()),
  },
};

export const Aws: Story = {
  name: "AWS",
  args: {
    ...withoutStoryHandlers(createAwsDetailViewStoryProps()),
  },
};

export const Datadog: Story = {
  args: {
    ...withoutStoryHandlers(createDatadogDetailViewStoryProps()),
  },
};

export const PlanetScale: Story = {
  name: "PlanetScale",
  args: {
    ...withoutStoryHandlers(createPlanetScaleDetailViewStoryProps()),
  },
};

export const SigNoz: Story = {
  name: "SigNoz",
  args: {
    ...withoutStoryHandlers(createSigNozDetailViewStoryProps()),
  },
};

export const Gallery: Story = {
  args: {
    ...withoutStoryHandlers(createIntegrationGalleryStoryProps()),
  },
};
