import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";

import { getDashboardStoryControlPlaneApiOrigin } from "../../storybook/dashboard-story-config.js";
import { withDashboardPageStory } from "../../storybook/decorators.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { IntegrationConnectionSetupPage } from "./integration-connection-setup-page.js";
import { createStoryConnectionMethods } from "./organization-integrations-settings-page-story-support.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
const ActiveConnectionStatus: IntegrationConnection["status"] = "active";
function getWasenderApiDefinitionOrThrow() {
  const definition = IntegrationRegistry.getDefinition({
    familyId: "wasenderapi",
    variantId: "wasenderapi-mcp",
  });

  if (definition === null || definition === undefined) {
    throw new Error("Missing WasenderAPI integration definition for Storybook.");
  }

  return definition;
}

const WasenderApiDefinition = getWasenderApiDefinitionOrThrow();

function createWasenderApiTargetFixture(): IntegrationTarget {
  return {
    targetKey: "wasenderapi-mcp",
    familyId: WasenderApiDefinition.familyId,
    variantId: WasenderApiDefinition.variantId,
    kind: WasenderApiDefinition.kind,
    enabled: true,
    config: {},
    displayName: WasenderApiDefinition.displayName,
    description: WasenderApiDefinition.description ?? "",
    ...(WasenderApiDefinition.logoKey === undefined
      ? {}
      : { logoKey: WasenderApiDefinition.logoKey }),
    connectionMethods: createStoryConnectionMethods(WasenderApiDefinition),
    targetHealth: {
      configStatus: "valid",
    },
  };
}

function createDraftWasenderApiConnection(input?: {
  configuredSecretNames?: readonly string[];
}): IntegrationConnection {
  return {
    id: "icn_wasenderapi_story_draft",
    targetKey: "wasenderapi-mcp",
    displayName: "WasenderAPI Production",
    status: ActiveConnectionStatus,
    connectionMethodId: "api-key",
    connectionMethodLabel: "Personal access token",
    config: {
      connection_method: "api-key",
    },
    ...(input?.configuredSecretNames === undefined
      ? {}
      : { configuredSecretNames: [...input.configuredSecretNames] }),
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
  };
}

function createWasenderApiWebhookSource(input: {
  connection: IntegrationConnection;
}): IntegrationWebhookSource {
  return {
    id: "iws_wasenderapi_story",
    targetKey: "wasenderapi-mcp",
    integrationConnectionId: input.connection.id,
    displayName: "WasenderAPI webhook",
    endpointKey: "eps_wasenderapi_story",
    callbackUrl: `${getDashboardStoryControlPlaneApiOrigin()}/p/integration/webhooks/wasenderapi-mcp/eps_wasenderapi_story`,
    status: "active",
    providerMetadata: {},
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
  };
}

function createStoryQueryClient(input: {
  connections: readonly IntegrationConnection[];
  webhookSources: readonly IntegrationWebhookSource[];
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
    targets: [createWasenderApiTargetFixture()],
    connections: [...input.connections],
  });
  queryClient.setQueryData(SESSION_QUERY_KEY, {
    session: {
      activeOrganizationId: "org_mistle",
    },
  });
  queryClient.setQueryData(organizationSummaryQueryKey("org_mistle"), {
    name: "Mistle",
  });

  for (const source of input.webhookSources) {
    queryClient.setQueryData(
      ["integration-webhook-sources", source.integrationConnectionId],
      [source],
    );
  }

  return queryClient;
}

function WasenderApiSetupPageStory(input: {
  connection: IntegrationConnection;
  initialEntry?: string;
  webhookSource?: IntegrationWebhookSource;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [input.connection],
      webhookSources: [
        input.webhookSource ??
          createWasenderApiWebhookSource({
            connection: input.connection,
          }),
      ],
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
          input.initialEntry ??
            "/integrations/wasenderapi-mcp/icn_wasenderapi_story_draft/provider-configuration/setup",
        ],
      },
    ),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function WasenderApiFlowsStory(): React.JSX.Element {
  return <WasenderApiSetupPageStory connection={createDraftWasenderApiConnection()} />;
}

const pageMeta = {
  title: "Dashboard/Integrations/WasenderAPI Flows",
  component: WasenderApiFlowsStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof WasenderApiFlowsStory>;

export default pageMeta;

type PageStory = StoryObj<typeof pageMeta>;

export const SetupProviderConfiguration: PageStory = {
  render: function RenderStory() {
    return <WasenderApiSetupPageStory connection={createDraftWasenderApiConnection()} />;
  },
};

export const SetupCredentialsConfigured: PageStory = {
  render: function RenderStory() {
    return (
      <WasenderApiSetupPageStory
        connection={createDraftWasenderApiConnection({
          configuredSecretNames: ["personalAccessToken", "webhookSecret"],
        })}
      />
    );
  },
};
