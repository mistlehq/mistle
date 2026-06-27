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
  createWasenderApiDetailViewStoryProps,
  createWhapiDetailViewStoryProps,
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

const ConnectionDetailScenarios: {
  readonly GITHUB_ENTERPRISE_SERVER: "github-enterprise-server";
  readonly JIRA: "jira";
  readonly LINEAR: "linear";
  readonly SLACK: "slack";
  readonly SLACK_IDENTITY_LINKED: "slack-identity-linked";
  readonly OPENAI: "openai";
  readonly OPENAI_CHATGPT_SUBSCRIPTION: "openai-chatgpt-subscription";
  readonly OPENAI_CHATGPT_REAUTHORIZATION_REQUIRED: "openai-chatgpt-reauthorization-required";
  readonly OPENAI_CHATGPT_REAUTHORIZE_STARTING: "openai-chatgpt-reauthorize-starting";
  readonly AWS: "aws";
  readonly DATADOG: "datadog";
  readonly PLANETSCALE: "planetscale";
  readonly PLANETSCALE_REAUTHORIZE_STARTING: "planetscale-reauthorize-starting";
  readonly PLANETSCALE_REAUTHORIZATION_REQUIRED: "planetscale-reauthorization-required";
  readonly PLANETSCALE_REAUTHORIZE_ERROR: "planetscale-reauthorize-error";
  readonly SIGNOZ: "signoz";
  readonly WASENDERAPI: "wasenderapi";
  readonly WHAPI: "whapi";
} = {
  GITHUB_ENTERPRISE_SERVER: "github-enterprise-server",
  JIRA: "jira",
  LINEAR: "linear",
  SLACK: "slack",
  SLACK_IDENTITY_LINKED: "slack-identity-linked",
  OPENAI: "openai",
  OPENAI_CHATGPT_SUBSCRIPTION: "openai-chatgpt-subscription",
  OPENAI_CHATGPT_REAUTHORIZATION_REQUIRED: "openai-chatgpt-reauthorization-required",
  OPENAI_CHATGPT_REAUTHORIZE_STARTING: "openai-chatgpt-reauthorize-starting",
  AWS: "aws",
  DATADOG: "datadog",
  PLANETSCALE: "planetscale",
  PLANETSCALE_REAUTHORIZE_STARTING: "planetscale-reauthorize-starting",
  PLANETSCALE_REAUTHORIZATION_REQUIRED: "planetscale-reauthorization-required",
  PLANETSCALE_REAUTHORIZE_ERROR: "planetscale-reauthorize-error",
  SIGNOZ: "signoz",
  WASENDERAPI: "wasenderapi",
  WHAPI: "whapi",
};

type ConnectionDetailScenario =
  (typeof ConnectionDetailScenarios)[keyof typeof ConnectionDetailScenarios];

type ConnectionDetailProviderScenariosStoryArgs = {
  scenario: ConnectionDetailScenario;
};

function createConnectionDetailScenarioProps(
  scenario: ConnectionDetailScenario,
): Omit<
  React.ComponentProps<typeof IntegrationConnectionDetailView>,
  | "onCreateWebhookSource"
  | "onDeleteWebhookSource"
  | "onEditAuthentication"
  | "onRefreshResource"
  | "onStartProviderAppSetup"
> {
  if (scenario === ConnectionDetailScenarios.JIRA) {
    return withoutStoryHandlers(
      mergeDetailViewStoryProps(
        createJiraDetailViewStoryProps(),
        createJiraWebhookNotConfiguredDetailViewStoryProps(),
      ),
    );
  }

  if (scenario === ConnectionDetailScenarios.LINEAR) {
    return withoutStoryHandlers(createLinearDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.SLACK) {
    return withoutStoryHandlers(createSlackDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.SLACK_IDENTITY_LINKED) {
    return withoutStoryHandlers(buildIdentityLinkedSlackDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.OPENAI) {
    return withoutStoryHandlers(createOpenAiDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.OPENAI_CHATGPT_SUBSCRIPTION) {
    return withoutStoryHandlers(createOpenAiChatGptDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.OPENAI_CHATGPT_REAUTHORIZATION_REQUIRED) {
    return withoutStoryHandlers(
      buildOpenAiChatGptReauthorizationStateStoryProps({
        errorMessage: "This connection needs to be re-authorized.",
        status: "error",
      }),
    );
  }

  if (scenario === ConnectionDetailScenarios.OPENAI_CHATGPT_REAUTHORIZE_STARTING) {
    return withoutStoryHandlers(
      buildOpenAiChatGptReauthorizationStateStoryProps({ isPending: true }),
    );
  }

  if (scenario === ConnectionDetailScenarios.AWS) {
    return withoutStoryHandlers(createAwsDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.DATADOG) {
    return withoutStoryHandlers(createDatadogDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.PLANETSCALE) {
    return withoutStoryHandlers(createPlanetScaleDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.PLANETSCALE_REAUTHORIZE_STARTING) {
    return withoutStoryHandlers(
      buildPlanetScaleReauthorizationStateStoryProps({ isPending: true }),
    );
  }

  if (scenario === ConnectionDetailScenarios.PLANETSCALE_REAUTHORIZATION_REQUIRED) {
    return withoutStoryHandlers(
      buildPlanetScaleReauthorizationStateStoryProps({
        errorMessage: "This connection needs to be re-authorized.",
        status: "error",
      }),
    );
  }

  if (scenario === ConnectionDetailScenarios.PLANETSCALE_REAUTHORIZE_ERROR) {
    return withoutStoryHandlers(
      buildPlanetScaleReauthorizationStateStoryProps({
        errorMessage: "Could not start connection reauthorization.",
      }),
    );
  }

  if (scenario === ConnectionDetailScenarios.SIGNOZ) {
    return withoutStoryHandlers(createSigNozDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.WASENDERAPI) {
    return withoutStoryHandlers(createWasenderApiDetailViewStoryProps());
  }

  if (scenario === ConnectionDetailScenarios.WHAPI) {
    return withoutStoryHandlers(createWhapiDetailViewStoryProps());
  }

  return withoutStoryHandlers(createGitHubEnterpriseServerDetailViewStoryProps());
}

function ConnectionDetailProviderScenariosStory(
  input: ConnectionDetailProviderScenariosStoryArgs,
): React.JSX.Element {
  return (
    <IntegrationConnectionDetailView
      {...createConnectionDetailScenarioProps(input.scenario)}
      onCreateWebhookSource={(_payload: { connectionId: string }) => {}}
      onDeleteWebhookSource={(_payload: { connectionId: string; webhookSourceId: string }) => {}}
      onEditAuthentication={(_connectionId: string) => {}}
      onRefreshResource={(_payload: { connectionId: string; kind: string }) => {}}
      onStartProviderAppSetup={async (_connectionId: string) => {}}
      titleEditor={{
        disabled: false,
        errorMessageByConnectionId: {},
        onStartEditing: (_connectionId: string) => {},
        onSave: async (_connectionId: string, _draftValue: string) => {},
      }}
    />
  );
}

const meta = {
  title: "Dashboard/Integrations/Connection Detail/Provider Scenarios",
  component: ConnectionDetailProviderScenariosStory,
  decorators: [withDashboardCenteredStory],
  argTypes: {
    scenario: {
      control: "select",
      options: [
        ConnectionDetailScenarios.GITHUB_ENTERPRISE_SERVER,
        ConnectionDetailScenarios.JIRA,
        ConnectionDetailScenarios.LINEAR,
        ConnectionDetailScenarios.SLACK,
        ConnectionDetailScenarios.SLACK_IDENTITY_LINKED,
        ConnectionDetailScenarios.OPENAI,
        ConnectionDetailScenarios.OPENAI_CHATGPT_SUBSCRIPTION,
        ConnectionDetailScenarios.OPENAI_CHATGPT_REAUTHORIZATION_REQUIRED,
        ConnectionDetailScenarios.OPENAI_CHATGPT_REAUTHORIZE_STARTING,
        ConnectionDetailScenarios.AWS,
        ConnectionDetailScenarios.DATADOG,
        ConnectionDetailScenarios.PLANETSCALE,
        ConnectionDetailScenarios.PLANETSCALE_REAUTHORIZE_STARTING,
        ConnectionDetailScenarios.PLANETSCALE_REAUTHORIZATION_REQUIRED,
        ConnectionDetailScenarios.PLANETSCALE_REAUTHORIZE_ERROR,
        ConnectionDetailScenarios.SIGNOZ,
        ConnectionDetailScenarios.WASENDERAPI,
        ConnectionDetailScenarios.WHAPI,
      ],
    },
  },
  args: {
    scenario: ConnectionDetailScenarios.GITHUB_ENTERPRISE_SERVER,
  },
} satisfies Meta<ConnectionDetailProviderScenariosStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
