import {
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
  type AnyIntegrationDefinition,
} from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { z } from "zod";

import { resetDashboardConfigForTest } from "../../config.js";
import { withDashboardCenteredStory, withDashboardPageStory } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import {
  createSlackDetailViewStoryProps,
  createStoryWebhookTriggerCapabilitiesProviderMetadata,
} from "../integrations/integration-story-harness.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { refreshIntegrationWebhookTriggerCapabilities } from "../integrations/integrations-service.js";
import { useSlackWebhookSourceActions } from "../integrations/slack-webhook-source-actions.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { IntegrationConnectionCreatePage } from "./integration-connection-create-page.js";
import { IntegrationConnectionSetupPage } from "./integration-connection-setup-page.js";
import { IntegrationsPage } from "./integrations-page.js";
import { createStoryConnectionMethods } from "./organization-integrations-settings-page-story-support.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
const StoryControlPlaneApiOrigin = "https://control-plane.example.com";
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

function configureDashboardRuntimeForStory(): void {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: StoryControlPlaneApiOrigin,
  });
  resetDashboardConfigForTest();
}

function createStoryQueryClient(input: {
  connections?: readonly IntegrationConnection[];
  webhookSources?: readonly IntegrationWebhookSource[];
}): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
      },
    },
  });

  queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
    targets: [createSlackTargetFixture()],
    connections: [...(input.connections ?? [])],
  });
  queryClient.setQueryData(SESSION_QUERY_KEY, {
    session: {
      activeOrganizationId: "org_mistle",
    },
  });

  for (const source of input.webhookSources ?? []) {
    queryClient.setQueryData(
      ["integration-webhook-sources", source.integrationConnectionId],
      [source],
    );
  }

  return queryClient;
}

function createSlackTargetFixture(): IntegrationTarget {
  return {
    targetKey: "slack-default",
    familyId: SlackDefinition.familyId,
    variantId: SlackDefinition.variantId,
    enabled: true,
    config: {
      api_base_url: "https://slack.com/api",
    },
    displayName: SlackDefinition.displayName,
    description: SlackDefinition.description ?? "",
    ...(SlackDefinition.logoKey === undefined ? {} : { logoKey: SlackDefinition.logoKey }),
    connectionMethods: createStoryConnectionMethods(SlackDefinition),
    targetHealth: {
      configStatus: "valid",
    },
  };
}

export function createDraftSlackConnection(input?: {
  config?: Record<string, unknown>;
  configuredSecretNames?: readonly string[];
  externalSubjectId?: string;
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
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

function createWebhookSourceFixture(): IntegrationWebhookSource {
  return {
    id: "iws_slack_story",
    targetKey: "slack-default",
    integrationConnectionId: "icn_slack_story_draft",
    displayName: "Slack Events API webhook",
    endpointKey: "eps_slack_story",
    callbackUrl:
      "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_slack_story",
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

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createPageResponse<T>(items: readonly T[]): {
  items: readonly T[];
  totalResults: number;
  nextPage: null;
  previousPage: null;
} {
  return {
    items,
    totalResults: items.length,
    nextPage: null,
    previousPage: null,
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

function useSlackStoryControlPlane(input: { queryClient: QueryClient }): void {
  useEffect(() => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (
      resource: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const request = resource instanceof Request ? resource : new Request(resource, init);
      const url = new URL(request.url);

      if (url.origin !== StoryControlPlaneApiOrigin) {
        return originalFetch(resource, init);
      }

      const method = request.method.toUpperCase();
      const path = url.pathname;
      const directoryData = input.queryClient.getQueryData<{
        targets: readonly IntegrationTarget[];
        connections: readonly IntegrationConnection[];
      }>(SETTINGS_INTEGRATIONS_QUERY_KEY) ?? { targets: [], connections: [] };

      if (method === "GET" && path === "/v1/integration/targets") {
        return createJsonResponse(createPageResponse(directoryData.targets));
      }

      if (method === "GET" && path === "/v1/integration/connections") {
        return createJsonResponse(createPageResponse(directoryData.connections));
      }

      const webhookSourcesMatch = path.match(
        /^\/v1\/integration\/connections\/([^/]+)\/webhook-sources$/,
      );
      if (method === "GET" && webhookSourcesMatch !== null) {
        const connectionId = decodeURIComponent(webhookSourcesMatch[1] ?? "");
        const webhookSources =
          input.queryClient.getQueryData<readonly IntegrationWebhookSource[]>([
            "integration-webhook-sources",
            connectionId,
          ]) ?? [];
        return createJsonResponse(webhookSources);
      }

      const refreshCapabilitiesMatch = path.match(
        /^\/v1\/integration\/connections\/([^/]+)\/webhook-sources\/trigger-capabilities\/refresh$/,
      );
      if (method === "POST" && refreshCapabilitiesMatch !== null) {
        const connectionId = decodeURIComponent(refreshCapabilitiesMatch[1] ?? "");
        const requestBody: unknown = await request.json();
        StoryRefreshSlackTriggerCapabilitiesRequestBodySchema.parse(requestBody);
        const currentWebhookSources =
          input.queryClient.getQueryData<readonly IntegrationWebhookSource[]>([
            "integration-webhook-sources",
            connectionId,
          ]) ?? [];
        const currentSource = currentWebhookSources[0];
        if (currentSource === undefined) {
          return createJsonResponse(
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

        input.queryClient.setQueryData(
          ["integration-webhook-sources", connectionId],
          [updatedSource],
        );

        return createJsonResponse(updatedSource);
      }

      const updateFormMatch = path.match(/^\/v1\/integration\/connections\/([^/]+)\/form$/);
      if (method === "PUT" && updateFormMatch !== null) {
        const connectionId = decodeURIComponent(updateFormMatch[1] ?? "");
        const requestBody: unknown = await request.json();
        const body = StoryFormUpdateRequestBodySchema.parse(requestBody);
        const currentConnection =
          directoryData.connections.find((connection) => connection.id === connectionId) ?? null;
        if (currentConnection === null) {
          return createJsonResponse(
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
            nextConfiguredSecretNames.size === 0
              ? undefined
              : [...nextConfiguredSecretNames].sort(),
          updatedAt: "2026-04-26T00:30:00.000Z",
        };

        input.queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: directoryData.targets,
          connections: directoryData.connections.map((connection) =>
            connection.id === connectionId ? updatedConnection : connection,
          ),
        });

        return createJsonResponse(updatedConnection);
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

        input.queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: directoryData.targets,
          connections: [...directoryData.connections, createdConnection],
        });
        input.queryClient.setQueryData(
          ["integration-webhook-sources", createdConnection.id],
          [
            {
              ...createWebhookSourceFixture(),
              integrationConnectionId: createdConnection.id,
            },
          ],
        );

        return createJsonResponse(createdConnection, 201);
      }

      const startManifestMatch = path.match(
        /^\/v1\/integration\/connections\/([^/]+)\/setup\/slack-app\/start$/,
      );
      if (method === "POST" && startManifestMatch !== null) {
        const requestBody: unknown = await request.json();
        StorySlackManifestStartRequestBodySchema.parse(requestBody);
        return createJsonResponse({
          kind: "redirect",
          authorizationUrl: `${StoryControlPlaneApiOrigin}/storybook/slack-app-install`,
        });
      }

      return createJsonResponse(
        { code: "STORYBOOK_UNHANDLED", message: `${method} ${path} is not handled in Storybook.` },
        500,
      );
    };

    return () => {
      globalThis.fetch = originalFetch;
    };
  }, [input.queryClient]);
}

function StoryQueryClientProvider(input: {
  queryClient: QueryClient;
  children: React.ReactNode;
}): React.JSX.Element {
  useSlackStoryControlPlane({ queryClient: input.queryClient });

  return <QueryClientProvider client={input.queryClient}>{input.children}</QueryClientProvider>;
}

function SlackCreatePageStory(): React.JSX.Element {
  configureDashboardRuntimeForStory();
  const [queryClient] = useState(() => createStoryQueryClient({}));
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />}>
          <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="/integrations">
            <Route element={<Outlet />} handle={ROUTE_HANDLES.integrationDetail} path=":targetKey">
              <Route
                element={<IntegrationConnectionCreatePage />}
                handle={ROUTE_HANDLES.integrationCreate}
                path="add"
              />
              <Route
                element={<IntegrationConnectionSetupPage />}
                handle={ROUTE_HANDLES.integrationSetup}
                path=":connectionId/:setupRouteSegment/setup"
              />
            </Route>
          </Route>
        </Route>,
      ),
      {
        initialEntries: ["/integrations/slack-default/add"],
      },
    ),
  );

  return (
    <StoryQueryClientProvider queryClient={queryClient}>
      <RouterProvider router={router} />
    </StoryQueryClientProvider>
  );
}

export function SlackAppSetupPageStory(input: {
  connection: IntegrationConnection;
  initialEntry?: string;
  webhookSource?: IntegrationWebhookSource;
}): React.JSX.Element {
  configureDashboardRuntimeForStory();
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [input.connection],
      webhookSources: [input.webhookSource ?? createWebhookSourceFixture()],
    }),
  );
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />}>
          <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="/integrations">
            <Route element={<Outlet />} handle={ROUTE_HANDLES.integrationDetail} path=":targetKey">
              <Route
                element={<IntegrationConnectionSetupPage />}
                handle={ROUTE_HANDLES.integrationSetup}
                path=":connectionId/:setupRouteSegment/setup"
              />
            </Route>
          </Route>
        </Route>,
      ),
      {
        initialEntries: [
          input.initialEntry ?? "/integrations/slack-default/icn_slack_story_draft/slack-app/setup",
        ],
      },
    ),
  );

  return (
    <StoryQueryClientProvider queryClient={queryClient}>
      <RouterProvider router={router} />
    </StoryQueryClientProvider>
  );
}

function SlackConnectedWebhookVerifiedRefreshStory(): React.JSX.Element {
  configureDashboardRuntimeForStory();
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
  const [webhookSources, setWebhookSources] = useState<readonly IntegrationWebhookSource[]>(
    () => initialWebhookSources,
  );
  const webhookSourceStateByConnectionId = new Map(storyProps.webhookSourceStateByConnectionId);
  webhookSourceStateByConnectionId.set(selectedConnection.id, {
    ...initialWebhookSourceState,
    items: webhookSources,
  });
  const storyConnections = storyProps.connections.map((connection) => ({
    id: connection.id,
    targetKey: "slack-default",
    displayName: connection.displayName,
    status: "active",
    connectionMethodId: "slack-bot-token",
    connectionMethodLabel: "Slack app",
    config: {
      connection_method: "slack-bot-token",
      client_id: "3555487893074.10993991013813",
      app_id: "A0123456789",
    },
    configuredSecretNames: ["botToken", "clientSecret", "signingSecret"],
    supportsWebhookSources: true,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  })) satisfies readonly IntegrationConnection[];
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: storyConnections,
      webhookSources,
    }),
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
      queryClient.setQueryData(
        ["integration-webhook-sources", source.integrationConnectionId],
        [source],
      );
      void queryClient.invalidateQueries({
        queryKey: ["integration-webhook-sources", source.integrationConnectionId],
      });
    },
  });
  const slackWebhookSourceActions = useSlackWebhookSourceActions({
    connections: storyConnections,
    refreshTriggerCapabilities: (payload, options) => {
      refreshMutation.mutate(payload, {
        onSuccess: () => {
          options?.onSuccess?.();
        },
      });
    },
    refreshTriggerCapabilitiesError:
      refreshMutation.isError && refreshMutation.variables !== undefined
        ? {
            connectionId: refreshMutation.variables.connectionId,
            message:
              refreshMutation.error instanceof Error
                ? refreshMutation.error.message
                : "Could not sync webhook events.",
          }
        : null,
    refreshingTriggerCapabilitiesConnectionId:
      refreshMutation.isPending && refreshMutation.variables !== undefined
        ? refreshMutation.variables.connectionId
        : null,
  });

  return (
    <StoryQueryClientProvider queryClient={queryClient}>
      <div className="flex flex-col gap-6">
        <IntegrationConnectionDetailView
          {...storyProps}
          connections={storyProps.connections.slice(0, 1)}
          renderWebhookSourceActions={slackWebhookSourceActions.renderWebhookSourceActions}
          webhookSourceStateByConnectionId={webhookSourceStateByConnectionId}
        />
        {slackWebhookSourceActions.dialog}
      </div>
    </StoryQueryClientProvider>
  );
}

function SlackInstalledDetailPageStory(): React.JSX.Element {
  configureDashboardRuntimeForStory();
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
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />}>
          <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="/integrations">
            <Route
              element={<IntegrationsPage />}
              handle={ROUTE_HANDLES.integrationDetail}
              path=":targetKey"
            />
          </Route>
        </Route>,
      ),
      {
        initialEntries: [
          "/integrations/slack-default?connectionId=icn_slack_story_draft&connectionNotice=installed",
        ],
      },
    ),
  );

  return (
    <StoryQueryClientProvider queryClient={queryClient}>
      <RouterProvider router={router} />
    </StoryQueryClientProvider>
  );
}

const pageMeta = {
  title: "Dashboard/Integrations/Setup/Slack App",
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

export const SetupWithManifest: PageStory = {
  render: function RenderStory() {
    return <SlackAppSetupPageStory connection={createDraftSlackConnection()} />;
  },
};

export const SetupConfiguredExistingApp: PageStory = {
  render: function RenderStory() {
    return (
      <SlackAppSetupPageStory
        connection={createDraftSlackConnection({
          config: {
            app_id: "A0123456789",
            client_id: "3555487893074.10993991013813",
          },
          configuredSecretNames: ["botToken", "clientSecret", "signingSecret"],
          externalSubjectId: "T0123456789",
        })}
      />
    );
  },
};

export const ConnectedWebhookVerifiedRefresh: PageStory = {
  render: function RenderStory() {
    return <SlackConnectedWebhookVerifiedRefreshStory />;
  },
};

export const InstalledRedirect: PageStory = {
  render: function RenderStory() {
    return <SlackInstalledDetailPageStory />;
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
