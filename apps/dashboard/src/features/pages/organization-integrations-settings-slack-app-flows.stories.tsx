import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { createSlackDetailViewStoryProps } from "../integrations/integration-story-harness.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { IntegrationConnectionCreatePage } from "./integration-connection-create-page.js";
import { IntegrationConnectionSlackAppSetupPage } from "./integration-connection-slack-app-setup-page.js";
import { IntegrationsPage } from "./integrations-page.js";
import { createStoryConnectionMethods } from "./organization-integrations-settings-page-story-support.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
const StoryControlPlaneApiOrigin = "https://control-plane.example.com";

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
  globalThis.__MISTLE_RUNTIME_CONFIG__ = {
    controlPlaneApiOrigin: StoryControlPlaneApiOrigin,
  };
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

function createDraftSlackConnection(input?: {
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
    providerMetadata: {},
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
        /^\/v1\/integration\/connections\/([^/]+)\/slack-app\/draft$/,
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
        /^\/v1\/integration\/connections\/([^/]+)\/slack-app-manifest\/start$/,
      );
      if (method === "POST" && startManifestMatch !== null) {
        const requestBody: unknown = await request.json();
        StorySlackManifestStartRequestBodySchema.parse(requestBody);
        return createJsonResponse({
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
                element={<IntegrationConnectionSlackAppSetupPage />}
                handle={ROUTE_HANDLES.integrationSlackAppSetup}
                path=":connectionId/slack-app/setup"
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

function SlackAppSetupPageStory(input: {
  connection: IntegrationConnection;
  initialEntry?: string;
}): React.JSX.Element {
  configureDashboardRuntimeForStory();
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [input.connection],
      webhookSources: [createWebhookSourceFixture()],
    }),
  );
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />}>
          <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="/integrations">
            <Route element={<Outlet />} handle={ROUTE_HANDLES.integrationDetail} path=":targetKey">
              <Route
                element={<IntegrationConnectionSlackAppSetupPage />}
                handle={ROUTE_HANDLES.integrationSlackAppSetup}
                path=":connectionId/slack-app/setup"
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

function SlackInstalledDetailPageStory(): React.JSX.Element {
  configureDashboardRuntimeForStory();
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [
        createDraftSlackConnection({
          config: {
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
          "/integrations/slack-default?connectionId=icn_slack_story_draft&slackApp=installed",
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
  title: "Dashboard/Integrations/Slack App Flows",
  decorators: [withDashboardPageStory],
} satisfies Meta;

export default pageMeta;

type PageStory = StoryObj<typeof pageMeta>;

export const AddConnection: PageStory = {
  render: function RenderStory() {
    return <SlackCreatePageStory />;
  },
};

export const SetupDraftWithManifest: PageStory = {
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
            client_id: "3555487893074.10993991013813",
          },
          configuredSecretNames: ["botToken", "clientSecret", "signingSecret"],
          externalSubjectId: "T0123456789",
        })}
      />
    );
  },
};

export const ManifestInstalledDetail: PageStory = {
  render: function RenderStory() {
    return <SlackInstalledDetailPageStory />;
  },
};

export const InstalledDetail: PageStory = {
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
