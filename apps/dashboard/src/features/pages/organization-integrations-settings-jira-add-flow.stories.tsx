import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { z } from "zod";

import { getDashboardStoryControlPlaneApiOrigin } from "../../storybook/dashboard-story-config.js";
import { withDashboardCenteredStory, withDashboardPageStory } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import {
  createJiraDetailViewStoryProps,
  createJiraWebhookNotConfiguredDetailViewStoryProps,
  createStoryWebhookTriggerCapabilitiesProviderMetadata,
} from "../integrations/integration-story-harness.js";
import type { ManagedWebhookSetupResult } from "../integrations/integrations-service-shared.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import {
  createIntegrationStoryQueryClient,
  createIntegrationStoryTarget,
  createJsonStoryResponse,
  IntegrationSetupRouteStory,
  type IntegrationStoryControlPlaneHandler,
  setIntegrationStoryDirectoryData,
  setIntegrationStoryWebhookSources,
} from "./integration-setup-flow-story-support.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
const StoryNow = "2026-04-27T00:00:00.000Z";
const StoryJiraWebhookCreatedSetup = {
  status: "created",
  webhookSourceId: "iws_jira_story",
} satisfies ManagedWebhookSetupResult;
const StoryJiraWebhookFailureSetup = {
  status: "failed",
  message: "Jira admin webhook creation failed (403): Forbidden",
} satisfies ManagedWebhookSetupResult;

const JiraConnectionMethodLabels = {
  "jira-personal-api-token": "Personal API token",
  "jira-service-account-api-token": "Service account API token",
  "jira-service-account-oauth-client-credentials": "Service account OAuth client credentials",
} satisfies Record<JiraConnectionMethodId, string>;

type JiraConnectionMethodId =
  | "jira-personal-api-token"
  | "jira-service-account-api-token"
  | "jira-service-account-oauth-client-credentials";

type JiraAddFlowInitialEntry =
  | string
  | {
      pathname: string;
      search: string;
      state: {
        managedWebhookSetup: ManagedWebhookSetupResult;
      };
    };

function getJiraDefinitionOrThrow(): AnyIntegrationDefinition {
  const definition = IntegrationRegistry.getDefinition({
    familyId: "jira",
    variantId: "jira-default",
  });

  if (definition === null || definition === undefined) {
    throw new Error("Missing Jira integration definition for Storybook.");
  }

  return definition;
}

const JiraDefinition = getJiraDefinitionOrThrow();

const JiraTarget = createIntegrationStoryTarget({
  definition: JiraDefinition,
  config: {},
  ...(JiraDefinition.webhookSource === undefined
    ? {}
    : {
        webhookSource: {
          lifecycle: JiraDefinition.webhookSource.lifecycle,
          requiresSourceSelection: true,
        },
      }),
});

function createJiraConnection(input?: {
  id?: string;
  displayName?: string;
  methodId?: JiraConnectionMethodId;
}): IntegrationConnection {
  const methodId = input?.methodId ?? "jira-personal-api-token";
  const methodLabel = JiraConnectionMethodLabels[methodId];

  return {
    id: input?.id ?? "icn_jira_story",
    targetKey: "jira-default",
    displayName: input?.displayName ?? "Engineering Jira",
    status: "active",
    connectionMethodId: methodId,
    connectionMethodLabel: methodLabel,
    config: createJiraConnectionConfig(methodId),
    configuredSecretNames: [methodLabel],
    supportsWebhookSources: methodId === "jira-personal-api-token",
    createdAt: StoryNow,
    updatedAt: StoryNow,
  };
}

function createJiraConnectionConfig(methodId: JiraConnectionMethodId): Record<string, unknown> {
  if (methodId === "jira-personal-api-token") {
    return {
      connection_method: methodId,
      site_url: "https://mistle.atlassian.net",
      email: "jon@example.com",
    };
  }

  if (methodId === "jira-service-account-api-token") {
    return {
      connection_method: methodId,
      cloud_id: "cloud-mistle-engineering",
    };
  }

  return {
    connection_method: methodId,
    cloud_id: "cloud-mistle-engineering",
    client_id: "jira-client-story",
  };
}

function createJiraWebhookSource(input?: { connectionId?: string }): IntegrationWebhookSource {
  const connectionId = input?.connectionId ?? "icn_jira_story";
  return {
    id: "iws_jira_story",
    targetKey: "jira-default",
    integrationConnectionId: connectionId,
    displayName: "Webhook",
    endpointKey: "ep_jira_story",
    callbackUrl: `${getDashboardStoryControlPlaneApiOrigin()}/p/integration/webhooks/jira-default/ep_jira_story`,
    remoteRegistrationId: "10001",
    status: "active",
    providerMetadata: {
      ...createStoryWebhookTriggerCapabilitiesProviderMetadata({
        definition: JiraDefinition,
        events: ["jira:issue_created", "jira:issue_updated", "comment_created"],
        permissions: [{ permission: "read:jira-work" }, { permission: "manage:jira-webhook" }],
      }),
    },
    createdAt: StoryNow,
    updatedAt: StoryNow,
  };
}

const StoryCreateFormConnectionRequestBodySchema = z.object({
  displayName: z.string(),
  methodId: z.enum([
    "jira-personal-api-token",
    "jira-service-account-api-token",
    "jira-service-account-oauth-client-credentials",
  ]),
  config: z.record(z.string(), z.unknown()),
  secrets: z.record(z.string(), z.string()),
});

function createJiraStoryControlPlaneHandler(input: {
  managedWebhookSetup: ManagedWebhookSetupResult;
}): IntegrationStoryControlPlaneHandler {
  return async ({ directoryData, method, path, queryClient, request }) => {
    if (method === "POST" && path === "/v1/integration/connections/jira-default/form") {
      const requestBody: unknown = await request.json();
      const body = StoryCreateFormConnectionRequestBodySchema.parse(requestBody);
      const createdConnection = createJiraConnection({
        id: "icn_jira_created",
        displayName: body.displayName,
        methodId: body.methodId,
      });

      setIntegrationStoryDirectoryData(queryClient, {
        targets: directoryData.targets,
        connections: [...directoryData.connections, createdConnection],
      });

      if (
        body.methodId === "jira-personal-api-token" &&
        input.managedWebhookSetup.status === "created"
      ) {
        setIntegrationStoryWebhookSources({
          connectionId: createdConnection.id,
          queryClient,
          webhookSources: [createJiraWebhookSource({ connectionId: createdConnection.id })],
        });
      }

      return createJsonStoryResponse(
        {
          ...createdConnection,
          config: body.config,
          ...(body.methodId === "jira-personal-api-token"
            ? { managedWebhookSetup: input.managedWebhookSetup }
            : {}),
        },
        201,
      );
    }

    return null;
  };
}

export function JiraAddFlowStory(input: {
  initialEntry: JiraAddFlowInitialEntry;
  connections?: readonly IntegrationConnection[];
  webhookSources?: readonly IntegrationWebhookSource[];
  managedWebhookSetup?: ManagedWebhookSetupResult;
}): React.JSX.Element {
  const managedWebhookSetup = input.managedWebhookSetup ?? StoryJiraWebhookCreatedSetup;
  const [queryClient] = useState(() =>
    createIntegrationStoryQueryClient({
      targets: [JiraTarget],
      ...(input.connections === undefined ? {} : { connections: input.connections }),
      ...(input.webhookSources === undefined ? {} : { webhookSources: input.webhookSources }),
    }),
  );
  const [handlers] = useState(() => [
    createJiraStoryControlPlaneHandler({
      managedWebhookSetup,
    }),
  ]);

  return (
    <IntegrationSetupRouteStory
      handlers={handlers}
      initialEntries={[input.initialEntry]}
      queryClient={queryClient}
      routeKind="create-and-detail"
    />
  );
}

function createJiraResultInitialEntry(
  managedWebhookSetup: ManagedWebhookSetupResult,
): Exclude<JiraAddFlowInitialEntry, string> {
  return {
    pathname: "/integrations/jira-default",
    search: "?connectionId=icn_jira_story",
    state: {
      managedWebhookSetup,
    },
  };
}

const pageMeta = {
  title: "Dashboard/Integrations/Setup/Jira",
  decorators: [withDashboardPageStory],
  excludeStories: ["JiraAddFlowStory"],
} satisfies Meta;

export default pageMeta;

type PageStory = StoryObj<typeof pageMeta>;

export const WebhookCreated: PageStory = {
  render: function RenderStory() {
    return (
      <JiraAddFlowStory
        connections={[createJiraConnection()]}
        initialEntry={createJiraResultInitialEntry(StoryJiraWebhookCreatedSetup)}
        managedWebhookSetup={StoryJiraWebhookCreatedSetup}
        webhookSources={[createJiraWebhookSource()]}
      />
    );
  },
};

export const WebhookFailed: PageStory = {
  render: function RenderStory() {
    return (
      <JiraAddFlowStory
        connections={[createJiraConnection()]}
        initialEntry={createJiraResultInitialEntry(StoryJiraWebhookFailureSetup)}
        managedWebhookSetup={StoryJiraWebhookFailureSetup}
      />
    );
  },
};

export const WebhookNotConfigured: PageStory = {
  render: function RenderStory() {
    return (
      <JiraAddFlowStory
        connections={[createJiraConnection()]}
        initialEntry="/integrations/jira-default?connectionId=icn_jira_story"
      />
    );
  },
};

export const ServiceAccountApiTokenDetail: PageStory = {
  render: function RenderStory() {
    return (
      <JiraAddFlowStory
        connections={[
          createJiraConnection({
            displayName: "Jira Service Account",
            id: "icn_jira_service_account",
            methodId: "jira-service-account-api-token",
          }),
        ]}
        initialEntry="/integrations/jira-default?connectionId=icn_jira_service_account"
      />
    );
  },
};

export const ServiceAccountOAuthClientCredentialsDetail: PageStory = {
  render: function RenderStory() {
    return (
      <JiraAddFlowStory
        connections={[
          createJiraConnection({
            displayName: "Jira OAuth Service Account",
            id: "icn_jira_oauth_service_account",
            methodId: "jira-service-account-oauth-client-credentials",
          }),
        ]}
        initialEntry="/integrations/jira-default?connectionId=icn_jira_oauth_service_account"
      />
    );
  },
};

export const ConnectedWebhookConfiguredDetailPreview: PageStory = {
  decorators: [withDashboardCenteredStory],
  render: function RenderStory() {
    return (
      <IntegrationConnectionDetailView
        {...createJiraDetailViewStoryProps()}
        onCreateWebhookSource={() => {}}
        onDeleteWebhookSource={() => {}}
        onEditAuthentication={() => {}}
        onRefreshResource={() => {}}
        titleEditor={{
          disabled: false,
          errorMessageByConnectionId: {},
          onStartEditing: () => {},
          onSave: async () => {},
        }}
      />
    );
  },
};

export const ConnectedWebhookMissingDetailPreview: PageStory = {
  decorators: [withDashboardCenteredStory],
  render: function RenderStory() {
    return (
      <IntegrationConnectionDetailView
        {...createJiraWebhookNotConfiguredDetailViewStoryProps()}
        onCreateWebhookSource={() => {}}
        onDeleteWebhookSource={() => {}}
        onEditAuthentication={() => {}}
        onRefreshResource={() => {}}
        titleEditor={{
          disabled: false,
          errorMessageByConnectionId: {},
          onStartEditing: () => {},
          onSave: async () => {},
        }}
      />
    );
  },
};
