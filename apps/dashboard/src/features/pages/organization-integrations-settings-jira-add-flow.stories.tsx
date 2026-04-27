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
import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { ManagedWebhookSetupResult } from "../integrations/integrations-service-shared.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { IntegrationConnectionCreatePage } from "./integration-connection-create-page.js";
import { IntegrationsPage } from "./integrations-page.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
const StoryControlPlaneApiOrigin = "https://control-plane.example.com";
const StoryNow = "2026-04-27T00:00:00.000Z";

type JiraAddFlowInitialEntry =
  | string
  | {
      pathname: string;
      search: string;
      state: {
        managedWebhookSetupMessage: string;
      };
    };

function configureDashboardRuntimeForStory(): void {
  globalThis.__MISTLE_RUNTIME_CONFIG__ = {
    controlPlaneApiOrigin: StoryControlPlaneApiOrigin,
  };
  resetDashboardConfigForTest();
}

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

function createJiraTargetFixture(): IntegrationTarget {
  return {
    targetKey: "jira-default",
    familyId: JiraDefinition.familyId,
    variantId: JiraDefinition.variantId,
    enabled: true,
    config: {},
    displayName: JiraDefinition.displayName,
    description: JiraDefinition.description ?? "",
    ...(JiraDefinition.logoKey === undefined ? {} : { logoKey: JiraDefinition.logoKey }),
    connectionMethods: JiraDefinition.connectionMethods?.map((method) => {
      if (method.kind === "form") {
        return {
          id: method.id,
          label: method.label,
          kind: method.kind,
          secretFields: method.secretFields.map((field) => ({
            name: field.name,
            label: field.label,
            ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
            ...(field.description === undefined ? {} : { description: field.description }),
            ...(field.optional === undefined ? {} : { optional: field.optional }),
            inputType: field.inputType,
            ...(field.slotKey === undefined ? {} : { slotKey: field.slotKey }),
          })),
        };
      }

      return {
        id: method.id,
        label: method.label,
        kind: method.kind,
        ui: method.ui,
      };
    }),
    webhookSource:
      JiraDefinition.webhookSource === undefined
        ? undefined
        : {
            lifecycle: JiraDefinition.webhookSource.lifecycle,
            requiresSourceSelection: true,
          },
    targetHealth: {
      configStatus: "valid",
    },
  };
}

function createJiraConnection(input?: {
  id?: string;
  displayName?: string;
}): IntegrationConnection {
  return {
    id: input?.id ?? "icn_jira_story",
    targetKey: "jira-default",
    displayName: input?.displayName ?? "Engineering Jira",
    status: "active",
    connectionMethodId: "jira-personal-api-token",
    connectionMethodLabel: "Personal API token",
    config: {
      connection_method: "jira-personal-api-token",
      site_url: "https://mistle.atlassian.net",
      email: "jon@example.com",
    },
    configuredSecretNames: ["Personal API token"],
    supportsWebhookSources: true,
    createdAt: StoryNow,
    updatedAt: StoryNow,
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
    callbackUrl:
      "https://control-plane.example.com/p/integration/webhooks/jira-default/ep_jira_story",
    remoteRegistrationId: "10001",
    status: "active",
    providerMetadata: {
      registeredEvents: [
        "jira:issue_created",
        "jira:issue_updated",
        "comment_created",
        "comment_updated",
      ],
    },
    createdAt: StoryNow,
    updatedAt: StoryNow,
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

const StoryCreateFormConnectionRequestBodySchema = z.object({
  displayName: z.string(),
  methodId: z.literal("jira-personal-api-token"),
  config: z.record(z.string(), z.unknown()),
  secrets: z.record(z.string(), z.string()),
});

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
    targets: [createJiraTargetFixture()],
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

function useJiraStoryControlPlane(input: {
  managedWebhookSetup: ManagedWebhookSetupResult;
  queryClient: QueryClient;
}): void {
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
        return createJsonResponse(
          input.queryClient.getQueryData<readonly IntegrationWebhookSource[]>([
            "integration-webhook-sources",
            connectionId,
          ]) ?? [],
        );
      }

      if (method === "POST" && path === "/v1/integration/connections/jira-default/form") {
        const requestBody: unknown = await request.json();
        const body = StoryCreateFormConnectionRequestBodySchema.parse(requestBody);
        const createdConnection = createJiraConnection({
          id: "icn_jira_created",
          displayName: body.displayName,
        });

        input.queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: directoryData.targets,
          connections: [...directoryData.connections, createdConnection],
        });

        if (input.managedWebhookSetup.status === "created") {
          input.queryClient.setQueryData(
            ["integration-webhook-sources", createdConnection.id],
            [createJiraWebhookSource({ connectionId: createdConnection.id })],
          );
        }

        return createJsonResponse(
          {
            ...createdConnection,
            config: body.config,
            managedWebhookSetup: input.managedWebhookSetup,
          },
          201,
        );
      }

      return createJsonResponse(
        { code: "STORYBOOK_UNHANDLED", message: `${method} ${path} is not handled in Storybook.` },
        500,
      );
    };

    return () => {
      globalThis.fetch = originalFetch;
    };
  }, [input.managedWebhookSetup, input.queryClient]);
}

function StoryQueryClientProvider(input: {
  managedWebhookSetup: ManagedWebhookSetupResult;
  queryClient: QueryClient;
  children: React.ReactNode;
}): React.JSX.Element {
  useJiraStoryControlPlane({
    managedWebhookSetup: input.managedWebhookSetup,
    queryClient: input.queryClient,
  });

  return <QueryClientProvider client={input.queryClient}>{input.children}</QueryClientProvider>;
}

function JiraAddFlowStory(input: {
  initialEntry: JiraAddFlowInitialEntry;
  connections?: readonly IntegrationConnection[];
  webhookSources?: readonly IntegrationWebhookSource[];
  managedWebhookSetup: ManagedWebhookSetupResult;
}): React.JSX.Element {
  configureDashboardRuntimeForStory();
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      ...(input.connections === undefined ? {} : { connections: input.connections }),
      ...(input.webhookSources === undefined ? {} : { webhookSources: input.webhookSources }),
    }),
  );
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />}>
          <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="/integrations">
            <Route element={<Outlet />} handle={ROUTE_HANDLES.integrationDetail} path=":targetKey">
              <Route element={<IntegrationsPage />} index />
              <Route
                element={<IntegrationConnectionCreatePage />}
                handle={ROUTE_HANDLES.integrationCreate}
                path="add"
              />
            </Route>
          </Route>
        </Route>,
      ),
      {
        initialEntries: [input.initialEntry],
      },
    ),
  );

  return (
    <StoryQueryClientProvider
      managedWebhookSetup={input.managedWebhookSetup}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </StoryQueryClientProvider>
  );
}

const pageMeta = {
  title: "Dashboard/Integrations/Jira Add Flow",
  decorators: [withDashboardPageStory],
} satisfies Meta;

export default pageMeta;

type PageStory = StoryObj<typeof pageMeta>;

export const AddConnection: PageStory = {
  render: function RenderStory() {
    return (
      <JiraAddFlowStory
        initialEntry="/integrations/jira-default/add"
        managedWebhookSetup={{
          status: "created",
          webhookSourceId: "iws_jira_story",
        }}
      />
    );
  },
};

export const WebhookCreatedResult: PageStory = {
  render: function RenderStory() {
    return (
      <JiraAddFlowStory
        connections={[createJiraConnection()]}
        initialEntry="/integrations/jira-default?connectionId=icn_jira_story"
        managedWebhookSetup={{
          status: "created",
          webhookSourceId: "iws_jira_story",
        }}
        webhookSources={[createJiraWebhookSource()]}
      />
    );
  },
};

export const WebhookFailedResult: PageStory = {
  render: function RenderStory() {
    return (
      <JiraAddFlowStory
        connections={[createJiraConnection()]}
        initialEntry={{
          pathname: "/integrations/jira-default",
          search: "?connectionId=icn_jira_story&managedWebhookSetup=failed",
          state: {
            managedWebhookSetupMessage: "Jira admin webhook creation failed (403): Forbidden",
          },
        }}
        managedWebhookSetup={{
          status: "failed",
          message: "Jira admin webhook creation failed (403): Forbidden",
        }}
      />
    );
  },
};
