import {
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
  type AnyIntegrationDefinition,
} from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { getDashboardStoryControlPlaneApiOrigin } from "../../storybook/dashboard-story-config.js";
import { withDashboardCenteredStory, withDashboardPageStory } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import {
  createSlackDetailViewStoryProps,
  createStoryWebhookTriggerCapabilitiesProviderMetadata,
} from "../integrations/integration-story-harness.js";
import { useIntegrationWebhookSourceActions } from "../integrations/integration-webhook-source-actions.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { refreshIntegrationWebhookTriggerCapabilities } from "../integrations/integrations-service.js";
import {
  createIntegrationStoryQueryClient,
  createIntegrationStoryTarget,
  createJsonStoryResponse,
  getIntegrationStoryWebhookSources,
  IntegrationSetupRouteStory,
  IntegrationStoryControlPlaneProvider,
  type IntegrationStoryControlPlaneHandler,
  setIntegrationStoryDirectoryData,
  setIntegrationStoryWebhookSources,
} from "./integration-setup-flow-story-support.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
const ActiveConnectionStatus: IntegrationConnection["status"] = "active";
const SlackStorySyncedBotEvents = [
  "app_mention",
  "message.channels",
  "message.groups",
  "reaction_added",
  "reaction_removed",
] satisfies readonly string[];
const SlackStorySyncedBotScopes = [
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "reactions:read",
] satisfies readonly string[];

function getSlackDefinitionOrThrow(): AnyIntegrationDefinition {
  const definition = IntegrationRegistry.getDefinition({
    familyId: "slack",
    variantId: "slack-default",
  });

  if (definition === null || definition === undefined) {
    throw new Error("Missing Slack integration definition for Storybook.");
  }

  return definition;
}

const SlackDefinition = getSlackDefinitionOrThrow();
const SlackTarget = createIntegrationStoryTarget({
  definition: SlackDefinition,
  config: {
    api_base_url: "https://slack.com/api",
  },
});

function createStoryQueryClient(input: {
  connections?: readonly IntegrationConnection[];
  webhookSources?: readonly IntegrationWebhookSource[];
}) {
  return createIntegrationStoryQueryClient({
    targets: [SlackTarget],
    ...(input.connections === undefined ? {} : { connections: input.connections }),
    ...(input.webhookSources === undefined ? {} : { webhookSources: input.webhookSources }),
  });
}

export function createDraftSlackConnection(input?: {
  config?: Record<string, unknown>;
  configuredSecretNames?: readonly string[];
  externalSubjectId?: string;
  repairAction?: IntegrationConnection["repairAction"];
}): IntegrationConnection {
  return {
    id: "icn_slack_story_draft",
    targetKey: "slack-default",
    displayName: "Engineering Slack",
    status: "active",
    connectionMethodId: "slack-bot-token",
    connectionMethodLabel: "Slack app",
    config: {
      connection_method: "slack-bot-token",
      ...(input?.config ?? {}),
    },
    ...(input?.externalSubjectId === undefined
      ? {}
      : { externalSubjectId: input.externalSubjectId }),
    ...(input?.configuredSecretNames === undefined
      ? {}
      : { configuredSecretNames: [...input.configuredSecretNames] }),
    ...(input?.repairAction === undefined ? {} : { repairAction: input.repairAction }),
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

function createSlackBotIdentityRepairAction(): NonNullable<IntegrationConnection["repairAction"]> {
  return {
    id: "slack-bot-identity",
    title: "Slack bot identity missing",
    description:
      "This connection needs its Slack bot identity before Slack thread routing can be enabled.",
    actionLabel: "Fix Slack bot identity",
    pendingLabel: "Fixing...",
  };
}

function createWebhookSourceFixture(): IntegrationWebhookSource {
  return {
    id: "iws_slack_story",
    targetKey: "slack-default",
    integrationConnectionId: "icn_slack_story_draft",
    displayName: "Slack Events API webhook",
    endpointKey: "eps_slack_story",
    callbackUrl: `${getDashboardStoryControlPlaneApiOrigin()}/p/integration/webhooks/slack-default/eps_slack_story`,
    status: "active",
    providerMetadata: createStoryWebhookTriggerCapabilitiesProviderMetadata({
      definition: SlackDefinition,
      events: ["message.channels", "app_mention"],
      permissions: [{ permission: "channels:history" }, { permission: "app_mentions:read" }],
    }),
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

const StoryFormUpdateRequestBodySchema = z.object({
  displayName: z.string(),
  config: z.record(z.string(), z.unknown()),
  secrets: z.record(z.string(), z.string()).optional(),
});

const StoryDraftConnectionRequestBodySchema = z.object({
  displayName: z.string(),
});

const StorySlackManifestStartRequestBodySchema = z.object({
  appConfigToken: z.string(),
  manifest: z.record(z.string(), z.unknown()),
});

const StoryRefreshSlackTriggerCapabilitiesRequestBodySchema = z
  .object({
    appConfigToken: z.string().min(1),
  })
  .strict();

function createSlackSourceTruthProviderMetadata(): Record<string, unknown> {
  return {
    [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
      events: [...SlackStorySyncedBotEvents],
      permissions: SlackStorySyncedBotScopes.map((permission) => ({ permission })),
    },
  };
}

function createSlackStoryControlPlaneHandler(): IntegrationStoryControlPlaneHandler {
  return async ({
    directoryData,
    method,
    path,
    queryClient,
    request,
    storyControlPlaneApiOrigin,
  }) => {
    const refreshCapabilitiesMatch = path.match(
      /^\/v1\/integration\/connections\/([^/]+)\/webhook-sources\/trigger-capabilities\/refresh$/,
    );
    if (method === "POST" && refreshCapabilitiesMatch !== null) {
      const connectionId = decodeURIComponent(refreshCapabilitiesMatch[1] ?? "");
      const requestBody: unknown = await request.json();
      StoryRefreshSlackTriggerCapabilitiesRequestBodySchema.parse(requestBody);
      const currentWebhookSources = getIntegrationStoryWebhookSources({
        connectionId,
        queryClient,
      });
      const currentSource = currentWebhookSources[0];
      if (currentSource === undefined) {
        return createJsonStoryResponse(
          { code: "WEBHOOK_SOURCE_NOT_FOUND", message: "Webhook source not found." },
          404,
        );
      }

      const updatedSource: IntegrationWebhookSource = {
        ...currentSource,
        providerMetadata: {
          ...currentSource.providerMetadata,
          ...createSlackSourceTruthProviderMetadata(),
        },
        updatedAt: "2026-04-26T00:45:00.000Z",
      };

      setIntegrationStoryWebhookSources({
        connectionId,
        queryClient,
        webhookSources: [updatedSource],
      });

      return createJsonStoryResponse(updatedSource);
    }

    const updateFormMatch = path.match(/^\/v1\/integration\/connections\/([^/]+)\/form$/);
    if (method === "PUT" && updateFormMatch !== null) {
      const connectionId = decodeURIComponent(updateFormMatch[1] ?? "");
      const requestBody: unknown = await request.json();
      const body = StoryFormUpdateRequestBodySchema.parse(requestBody);
      const currentConnection =
        directoryData.connections.find((connection) => connection.id === connectionId) ?? null;
      if (currentConnection === null) {
        return createJsonStoryResponse(
          { code: "CONNECTION_NOT_FOUND", message: "Connection not found." },
          404,
        );
      }

      const nextConfiguredSecretNames = new Set(currentConnection.configuredSecretNames ?? []);
      for (const secretName of Object.keys(body.secrets ?? {})) {
        nextConfiguredSecretNames.add(secretName);
      }

      const updatedConnection: IntegrationConnection = {
        ...currentConnection,
        displayName: body.displayName,
        config: body.config,
        configuredSecretNames:
          nextConfiguredSecretNames.size === 0 ? undefined : [...nextConfiguredSecretNames].sort(),
        updatedAt: "2026-04-26T00:30:00.000Z",
      };

      setIntegrationStoryDirectoryData(queryClient, {
        targets: directoryData.targets,
        connections: directoryData.connections.map((connection) =>
          connection.id === connectionId ? updatedConnection : connection,
        ),
      });

      return createJsonStoryResponse(updatedConnection);
    }

    const repairConnectionMatch = path.match(/^\/v1\/integration\/connections\/([^/]+)\/repair$/);
    if (method === "POST" && repairConnectionMatch !== null) {
      const connectionId = decodeURIComponent(repairConnectionMatch[1] ?? "");
      const currentConnection =
        directoryData.connections.find((connection) => connection.id === connectionId) ?? null;
      if (currentConnection === null) {
        return createJsonStoryResponse(
          { code: "CONNECTION_NOT_FOUND", message: "Connection not found." },
          404,
        );
      }

      const { repairAction, ...connectionWithoutRepairAction } = currentConnection;
      void repairAction;
      const updatedConnection: IntegrationConnection = {
        ...connectionWithoutRepairAction,
        config: {
          ...(currentConnection.config ?? {}),
          bot_user_id: "U0123456789",
        },
        updatedAt: "2026-04-26T00:45:00.000Z",
      };

      setIntegrationStoryDirectoryData(queryClient, {
        targets: directoryData.targets,
        connections: directoryData.connections.map((connection) =>
          connection.id === connectionId ? updatedConnection : connection,
        ),
      });

      return createJsonStoryResponse(updatedConnection);
    }

    const createDraftMatch = path.match(
      /^\/v1\/integration\/connections\/([^/]+)\/slack-bot-token\/draft$/,
    );
    if (method === "POST" && createDraftMatch !== null) {
      const targetKey = decodeURIComponent(createDraftMatch[1] ?? "");
      const requestBody: unknown = await request.json();
      const body = StoryDraftConnectionRequestBodySchema.parse(requestBody);
      const createdConnection: IntegrationConnection = {
        id: "icn_slack_story_created",
        targetKey,
        displayName: body.displayName,
        status: "active",
        connectionMethodId: "slack-bot-token",
        connectionMethodLabel: "Slack app",
        config: {
          connection_method: "slack-bot-token",
        },
        createdAt: "2026-04-26T00:30:00.000Z",
        updatedAt: "2026-04-26T00:30:00.000Z",
      };

      setIntegrationStoryDirectoryData(queryClient, {
        targets: directoryData.targets,
        connections: [...directoryData.connections, createdConnection],
      });
      setIntegrationStoryWebhookSources({
        connectionId: createdConnection.id,
        queryClient,
        webhookSources: [
          {
            ...createWebhookSourceFixture(),
            integrationConnectionId: createdConnection.id,
          },
        ],
      });

      return createJsonStoryResponse(createdConnection, 201);
    }

    const startManifestMatch = path.match(
      /^\/v1\/integration\/connections\/([^/]+)\/setup\/slack-app\/start$/,
    );
    if (method === "POST" && startManifestMatch !== null) {
      const requestBody: unknown = await request.json();
      StorySlackManifestStartRequestBodySchema.parse(requestBody);
      return createJsonStoryResponse({
        kind: "redirect",
        authorizationUrl: `${storyControlPlaneApiOrigin}/storybook/slack-app-install`,
      });
    }

    return null;
  };
}

const SlackStoryControlPlaneHandlers = [createSlackStoryControlPlaneHandler()];

function SlackCreatePageStory(): React.JSX.Element {
  const [queryClient] = useState(() => createStoryQueryClient({}));

  return (
    <IntegrationSetupRouteStory
      handlers={SlackStoryControlPlaneHandlers}
      initialEntries={["/integrations/slack-default/add"]}
      queryClient={queryClient}
      routeKind="create-and-setup"
    />
  );
}

export function SlackAppSetupPageStory(input: {
  connection: IntegrationConnection;
  initialEntry?: string;
  webhookSource?: IntegrationWebhookSource;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [input.connection],
      webhookSources: [input.webhookSource ?? createWebhookSourceFixture()],
    }),
  );

  return (
    <IntegrationSetupRouteStory
      handlers={SlackStoryControlPlaneHandlers}
      initialEntries={[
        input.initialEntry ?? "/integrations/slack-default/icn_slack_story_draft/slack-app/setup",
      ]}
      queryClient={queryClient}
      routeKind="setup"
    />
  );
}

function SlackConnectedWebhookVerifiedRefreshStory({
  includeAppId = true,
}: {
  includeAppId?: boolean;
} = {}): React.JSX.Element {
  const model = createSlackConnectedWebhookVerifiedRefreshStoryModel({ includeAppId });
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: model.storyConnections,
      webhookSources: model.initialWebhookSources,
    }),
  );

  return (
    <IntegrationStoryControlPlaneProvider
      handlers={SlackStoryControlPlaneHandlers}
      queryClient={queryClient}
    >
      <SlackConnectedWebhookVerifiedRefreshStoryContent model={model} queryClient={queryClient} />
    </IntegrationStoryControlPlaneProvider>
  );
}

type SlackConnectedWebhookVerifiedRefreshStoryModel = ReturnType<
  typeof createSlackConnectedWebhookVerifiedRefreshStoryModel
>;

function createSlackConnectedWebhookVerifiedRefreshStoryModel(input: { includeAppId: boolean }) {
  const storyProps = createSlackDetailViewStoryProps();
  const selectedConnection = storyProps.connections[0];
  if (selectedConnection === undefined) {
    throw new Error("Slack detail story must define a connection.");
  }
  const initialWebhookSourceState =
    storyProps.webhookSourceStateByConnectionId?.get(selectedConnection.id) ?? null;
  if (initialWebhookSourceState === null) {
    throw new Error("Slack detail story must define webhook source state.");
  }
  const initialWebhookSources = initialWebhookSourceState.items.map((source) => ({
    ...source,
    providerMetadata: {},
  }));
  const storyConnections = storyProps.connections.map((connection) => ({
    id: connection.id,
    targetKey: "slack-default",
    displayName: connection.displayName,
    status: ActiveConnectionStatus,
    connectionMethodId: "slack-bot-token",
    connectionMethodLabel: "Slack app",
    config: {
      connection_method: "slack-bot-token",
      client_id: "3555487893074.10993991013813",
      ...(input.includeAppId ? { app_id: "A0123456789" } : {}),
    },
    configuredSecretNames: ["botToken", "clientSecret", "signingSecret"],
    supportsWebhookSources: true,
    webhookTriggerCapabilitiesRefreshAction: {
      actionLabel: "Sync webhook events",
      pendingLabel: "Syncing...",
      ...(input.includeAppId
        ? {}
        : { disabledMessage: "Add the Slack App ID before syncing webhook events." }),
      bodyForm: {
        title: "Sync webhook events",
        submitLabel: "Sync",
        fields: [
          {
            name: "appConfigToken",
            label: "App configuration token",
            inputType: "password",
            required: true,
            placeholder: "xoxe.xoxp-...",
            description: "Generate a temporary app configuration token and paste it below",
            actions: [
              {
                label: "https://api.slack.com/apps",
                href: "https://api.slack.com/apps",
                opensInNewWindow: true,
              },
            ],
          },
        ],
      },
    },
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  })) satisfies readonly IntegrationConnection[];
  const storyDetailConnections = storyProps.connections.map((connection, index) => {
    const storyConnection = storyConnections[index];
    if (storyConnection === undefined) {
      throw new Error("Slack detail story connection is missing.");
    }

    return {
      ...connection,
      ...storyConnection,
    };
  });

  return {
    initialWebhookSourceState,
    initialWebhookSources,
    selectedConnection,
    storyConnections,
    storyDetailConnections,
    storyProps,
  };
}

function SlackConnectedWebhookVerifiedRefreshStoryContent(input: {
  model: SlackConnectedWebhookVerifiedRefreshStoryModel;
  queryClient: ReturnType<typeof createStoryQueryClient>;
}): React.JSX.Element {
  const [webhookSources, setWebhookSources] = useState<readonly IntegrationWebhookSource[]>(
    () => input.model.initialWebhookSources,
  );
  const refreshMutation = useMutation({
    mutationFn: (payload: { body: Readonly<Record<string, unknown>>; connectionId: string }) =>
      refreshIntegrationWebhookTriggerCapabilities(payload),
    onSuccess: (source) => {
      setWebhookSources((currentSources) =>
        currentSources.map((currentSource) =>
          currentSource.id === source.id ? source : currentSource,
        ),
      );
      input.queryClient.setQueryData(
        ["integration-webhook-sources", source.integrationConnectionId],
        [source],
      );
      void input.queryClient.invalidateQueries({
        queryKey: ["integration-webhook-sources", source.integrationConnectionId],
      });
    },
  });
  const webhookSourceStateByConnectionId = new Map(
    input.model.storyProps.webhookSourceStateByConnectionId,
  );
  webhookSourceStateByConnectionId.set(input.model.selectedConnection.id, {
    ...input.model.initialWebhookSourceState,
    items: webhookSources,
    syncErrorMessage:
      refreshMutation.isError &&
      refreshMutation.variables?.connectionId === input.model.selectedConnection.id
        ? refreshMutation.error instanceof Error
          ? refreshMutation.error.message
          : "Could not sync webhook events."
        : null,
  });
  const webhookSourceActions = useIntegrationWebhookSourceActions({
    connections: input.model.storyConnections,
    refreshTriggerCapabilities: (payload, options) => {
      refreshMutation.mutate(payload, {
        onSuccess: () => {
          options?.onSuccess?.();
        },
      });
    },
    refreshingTriggerCapabilitiesConnectionId:
      refreshMutation.isPending && refreshMutation.variables !== undefined
        ? refreshMutation.variables.connectionId
        : null,
  });

  return (
    <div className="flex flex-col gap-6">
      <IntegrationConnectionDetailView
        {...input.model.storyProps}
        connections={input.model.storyDetailConnections}
        renderWebhookSourceActions={webhookSourceActions.renderWebhookSourceActions}
        webhookSourceStateByConnectionId={webhookSourceStateByConnectionId}
      />
      {webhookSourceActions.dialog}
    </div>
  );
}

function SlackInstalledDetailPageStory(): React.JSX.Element {
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [
        createDraftSlackConnection({
          config: {
            app_id: "A0123456789",
            client_id: "3555487893074.10993991013813",
            team_id: "T0123456789",
          },
          configuredSecretNames: ["botToken", "clientSecret", "signingSecret"],
          externalSubjectId: "T0123456789",
        }),
      ],
      webhookSources: [createWebhookSourceFixture()],
    }),
  );

  return (
    <IntegrationSetupRouteStory
      handlers={SlackStoryControlPlaneHandlers}
      initialEntries={[
        "/integrations/slack-default?connectionId=icn_slack_story_draft&connectionNotice=installed",
      ]}
      queryClient={queryClient}
      routeKind="detail"
    />
  );
}

function SlackMissingBotIdentityRepairStory(): React.JSX.Element {
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [
        createDraftSlackConnection({
          config: {
            app_id: "A0123456789",
            client_id: "3555487893074.10993991013813",
          },
          configuredSecretNames: ["botToken", "clientSecret", "signingSecret"],
          externalSubjectId: "T0123456789",
          repairAction: createSlackBotIdentityRepairAction(),
        }),
      ],
      webhookSources: [createWebhookSourceFixture()],
    }),
  );

  return (
    <IntegrationSetupRouteStory
      handlers={SlackStoryControlPlaneHandlers}
      initialEntries={["/integrations/slack-default?connectionId=icn_slack_story_draft"]}
      queryClient={queryClient}
      routeKind="detail"
    />
  );
}

const pageMeta = {
  title: "Dashboard/Integrations/Setup/SlackApp",
  decorators: [withDashboardPageStory],
  excludeStories: ["createDraftSlackConnection", "SlackAppSetupPageStory"],
} satisfies Meta;

export default pageMeta;

type PageStory = StoryObj<typeof pageMeta>;

export const AddConnection: PageStory = {
  render: function RenderStory() {
    return <SlackCreatePageStory />;
  },
};

export const ConnectedWebhookVerifiedRefresh: PageStory = {
  render: function RenderStory() {
    return <SlackConnectedWebhookVerifiedRefreshStory />;
  },
};

export const ConnectedWebhookSyncMissingAppId: PageStory = {
  render: function RenderStory() {
    return <SlackConnectedWebhookVerifiedRefreshStory includeAppId={false} />;
  },
};

export const InstalledRedirect: PageStory = {
  render: function RenderStory() {
    return <SlackInstalledDetailPageStory />;
  },
};

export const MissingBotIdentityRepair: PageStory = {
  render: function RenderStory() {
    return <SlackMissingBotIdentityRepairStory />;
  },
};

export const InstalledDetailPreview: PageStory = {
  decorators: [withDashboardCenteredStory],
  render: function RenderStory() {
    return (
      <IntegrationConnectionDetailView
        {...createSlackDetailViewStoryProps()}
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
