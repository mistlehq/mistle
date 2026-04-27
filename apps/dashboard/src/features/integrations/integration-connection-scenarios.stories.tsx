import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";
import {
  createAwsDetailViewStoryProps,
  createDatadogDetailViewStoryProps,
  createGitHubEnterpriseServerDetailViewStoryProps,
  createJiraDetailViewStoryProps,
  createJiraWebhookNotConfiguredDetailViewStoryProps,
  createLinearDetailViewStoryProps,
  createOpenAiDetailViewStoryProps,
  createPlanetScaleDetailViewStoryProps,
  createSigNozDetailViewStoryProps,
  createSlackDetailViewStoryProps,
} from "./integration-story-harness.js";

function mergeDetailViewStoryProps(
  ...inputs: readonly React.ComponentProps<typeof IntegrationConnectionDetailView>[]
): React.ComponentProps<typeof IntegrationConnectionDetailView> {
  const resourceItemsEntries = inputs.flatMap((input) =>
    input.resourceItemsByKey === undefined ? [] : [...input.resourceItemsByKey.entries()],
  );
  const webhookSourceEntries = inputs.flatMap((input) =>
    input.webhookSourceStateByConnectionId === undefined
      ? []
      : [...input.webhookSourceStateByConnectionId.entries()],
  );

  return {
    connections: inputs.flatMap((input) => input.connections),
    ...(resourceItemsEntries.length === 0
      ? {}
      : { resourceItemsByKey: new Map(resourceItemsEntries) }),
    ...(webhookSourceEntries.length === 0
      ? {}
      : { webhookSourceStateByConnectionId: new Map(webhookSourceEntries) }),
    ...(inputs.some((input) => input.webhookPolicy !== undefined)
      ? { webhookPolicy: inputs.find((input) => input.webhookPolicy !== undefined)?.webhookPolicy }
      : {}),
  };
}

function withoutStoryHandlers(
  input: React.ComponentProps<typeof IntegrationConnectionDetailView>,
): Omit<
  React.ComponentProps<typeof IntegrationConnectionDetailView>,
  | "onCreateWebhookSource"
  | "onDeleteWebhookSource"
  | "onEditAuthentication"
  | "onRefreshResource"
  | "onStartGitHubAppInstallation"
> {
  const {
    onCreateWebhookSource: _onCreateWebhookSource,
    onDeleteWebhookSource: _onDeleteWebhookSource,
    onEditAuthentication: _onEditAuthentication,
    onRefreshResource: _onRefreshResource,
    onStartGitHubAppInstallation: _onStartGitHubAppInstallation,
    ...rest
  } = input;

  return rest;
}

const meta = {
  title: "Dashboard/Integrations/Connection Detail",
  component: IntegrationConnectionDetailView,
  decorators: [withDashboardCenteredStory],
  args: {
    onCreateWebhookSource: (_input: { connectionId: string }) => {},
    onDeleteWebhookSource: (_input: { connectionId: string; webhookSourceId: string }) => {},
    onEditAuthentication: (_connectionId: string) => {},
    onRefreshResource: (_input: { connectionId: string; kind: string }) => {},
    onStartGitHubAppInstallation: async (_connectionId: string) => {},
    titleEditor: {
      disabled: false,
      errorMessageByConnectionId: {},
      onStartEditing: (_connectionId: string) => {},
      onSave: async (_connectionId: string, _draftValue: string) => {},
    },
  },
} satisfies Meta<typeof IntegrationConnectionDetailView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const GitHubEnterpriseServer: Story = {
  name: "GitHub Enterprise Server",
  args: {
    ...withoutStoryHandlers(createGitHubEnterpriseServerDetailViewStoryProps()),
  },
};

export const Jira: Story = {
  name: "Jira",
  args: {
    ...withoutStoryHandlers(
      mergeDetailViewStoryProps(
        createJiraDetailViewStoryProps(),
        createJiraWebhookNotConfiguredDetailViewStoryProps(),
      ),
    ),
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
