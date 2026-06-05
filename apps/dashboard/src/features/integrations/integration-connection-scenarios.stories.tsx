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
  createOpenAiChatGptDetailViewStoryProps,
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
  | "onStartProviderAppSetup"
> {
  const {
    onCreateWebhookSource: _onCreateWebhookSource,
    onDeleteWebhookSource: _onDeleteWebhookSource,
    onEditAuthentication: _onEditAuthentication,
    onRefreshResource: _onRefreshResource,
    onStartProviderAppSetup: _onStartProviderAppSetup,
    ...rest
  } = input;

  return rest;
}

function buildIdentityLinkedSlackDetailViewStoryProps(): React.ComponentProps<
  typeof IntegrationConnectionDetailView
> {
  const props = createSlackDetailViewStoryProps();
  const connection = props.connections[0];
  if (connection === undefined) {
    throw new Error("Slack identity-linked story requires a connection.");
  }

  return {
    ...props,
    connections: [
      {
        ...connection,
        bindingCount: 0,
        canDelete: false,
        isIdentityLinked: true,
      },
    ],
  };
}

function buildPlanetScaleReauthorizationStateStoryProps(input: {
  errorMessage?: string;
  isPending?: boolean;
  status?: "active" | "error" | "revoked";
}): React.ComponentProps<typeof IntegrationConnectionDetailView> {
  const props = createPlanetScaleDetailViewStoryProps();

  return {
    ...props,
    connections: props.connections.map((connection) => ({
      ...connection,
      reauthorization:
        connection.reauthorization === undefined
          ? undefined
          : {
              ...connection.reauthorization,
              ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
              isPending: input.isPending ?? connection.reauthorization.isPending,
            },
      status: input.status ?? connection.status,
    })),
  };
}

function buildOpenAiChatGptReauthorizationStateStoryProps(input: {
  errorMessage?: string;
  isPending?: boolean;
  status?: "active" | "error" | "revoked";
}): React.ComponentProps<typeof IntegrationConnectionDetailView> {
  const props = createOpenAiChatGptDetailViewStoryProps();

  return {
    ...props,
    connections: props.connections.map((connection) => ({
      ...connection,
      reauthorization:
        connection.reauthorization === undefined
          ? undefined
          : {
              ...connection.reauthorization,
              ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
              isPending: input.isPending ?? connection.reauthorization.isPending,
            },
      status: input.status ?? connection.status,
    })),
  };
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
    onStartProviderAppSetup: async (_connectionId: string) => {},
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

export const SlackIdentityLinked: Story = {
  name: "Slack identity linked",
  args: {
    ...withoutStoryHandlers(buildIdentityLinkedSlackDetailViewStoryProps()),
  },
};

export const OpenAi: Story = {
  name: "OpenAI",
  args: {
    ...withoutStoryHandlers(createOpenAiDetailViewStoryProps()),
  },
};

export const OpenAiChatGptSubscription: Story = {
  name: "OpenAI ChatGPT subscription",
  args: {
    ...withoutStoryHandlers(createOpenAiChatGptDetailViewStoryProps()),
  },
};

export const OpenAiChatGptReauthorizationRequired: Story = {
  name: "OpenAI ChatGPT reauthorization required",
  args: {
    ...withoutStoryHandlers(
      buildOpenAiChatGptReauthorizationStateStoryProps({
        errorMessage: "This connection needs to be re-authorized.",
        status: "error",
      }),
    ),
  },
};

export const OpenAiChatGptReauthorizeStarting: Story = {
  name: "OpenAI ChatGPT reauthorize - starting",
  args: {
    ...withoutStoryHandlers(buildOpenAiChatGptReauthorizationStateStoryProps({ isPending: true })),
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

export const PlanetScaleReauthorizeStarting: Story = {
  name: "PlanetScale reauthorize - starting",
  args: {
    ...withoutStoryHandlers(buildPlanetScaleReauthorizationStateStoryProps({ isPending: true })),
  },
};

export const PlanetScaleReauthorizationRequired: Story = {
  name: "PlanetScale reauthorization required",
  args: {
    ...withoutStoryHandlers(
      buildPlanetScaleReauthorizationStateStoryProps({
        errorMessage: "This connection needs to be re-authorized.",
        status: "error",
      }),
    ),
  },
};

export const PlanetScaleReauthorizeError: Story = {
  name: "PlanetScale reauthorize - error",
  args: {
    ...withoutStoryHandlers(
      buildPlanetScaleReauthorizationStateStoryProps({
        errorMessage: "Could not start connection reauthorization.",
      }),
    ),
  },
};

export const SigNoz: Story = {
  name: "SigNoz",
  args: {
    ...withoutStoryHandlers(createSigNozDetailViewStoryProps()),
  },
};
