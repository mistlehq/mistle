import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";

import { getDashboardStoryControlPlaneApiOrigin } from "../../storybook/dashboard-story-config.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { IntegrationConnectionCreatePage } from "./integration-connection-create-page.js";
import { IntegrationConnectionSetupPage } from "./integration-connection-setup-page.js";
import { IntegrationsPage } from "./integrations-page.js";
import { createStoryConnectionMethods } from "./organization-integrations-settings-page-story-support.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type IntegrationStoryDirectoryData = {
  targets: readonly IntegrationTarget[];
  connections: readonly IntegrationConnection[];
};
type IntegrationStoryInitialEntries = NonNullable<
  NonNullable<Parameters<typeof createMemoryRouter>[1]>["initialEntries"]
>;

export type IntegrationStoryControlPlaneRequest = {
  directoryData: IntegrationStoryDirectoryData;
  method: string;
  path: string;
  queryClient: QueryClient;
  request: Request;
  storyControlPlaneApiOrigin: string;
  url: URL;
};

export type IntegrationStoryControlPlaneHandler = (
  input: IntegrationStoryControlPlaneRequest,
) => Promise<Response | null>;

export function createIntegrationStoryTarget(input: {
  config: Record<string, unknown>;
  definition: AnyIntegrationDefinition;
  targetKey?: string;
  webhookSource?: IntegrationTarget["webhookSource"];
}): IntegrationTarget {
  return {
    targetKey: input.targetKey ?? input.definition.variantId,
    familyId: input.definition.familyId,
    variantId: input.definition.variantId,
    kind: input.definition.kind,
    enabled: true,
    config: input.config,
    displayName: input.definition.displayName,
    description: input.definition.description ?? "",
    ...(input.definition.logoKey === undefined ? {} : { logoKey: input.definition.logoKey }),
    connectionMethods: createStoryConnectionMethods(input.definition),
    ...(input.webhookSource === undefined ? {} : { webhookSource: input.webhookSource }),
    targetHealth: {
      configStatus: "valid",
    },
  };
}

export function createIntegrationStoryQueryClient(input: {
  activeOrganizationId?: string;
  connections?: readonly IntegrationConnection[];
  organizationName?: string;
  targets: readonly IntegrationTarget[];
  webhookSources?: readonly IntegrationWebhookSource[];
}): QueryClient {
  const activeOrganizationId = input.activeOrganizationId ?? "org_mistle";
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
    targets: [...input.targets],
    connections: [...(input.connections ?? [])],
  });
  queryClient.setQueryData(SESSION_QUERY_KEY, {
    session: {
      activeOrganizationId,
    },
  });

  if (input.organizationName !== undefined) {
    queryClient.setQueryData(organizationSummaryQueryKey(activeOrganizationId), {
      name: input.organizationName,
    });
  }

  for (const source of input.webhookSources ?? []) {
    queryClient.setQueryData(
      ["integration-webhook-sources", source.integrationConnectionId],
      [source],
    );
  }

  return queryClient;
}

export function createJsonStoryResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createPageStoryResponse<T>(items: readonly T[]): {
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

function getIntegrationStoryDirectoryData(queryClient: QueryClient): IntegrationStoryDirectoryData {
  return (
    queryClient.getQueryData<IntegrationStoryDirectoryData>(SETTINGS_INTEGRATIONS_QUERY_KEY) ?? {
      targets: [],
      connections: [],
    }
  );
}

export function setIntegrationStoryDirectoryData(
  queryClient: QueryClient,
  directoryData: IntegrationStoryDirectoryData,
): void {
  queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, directoryData);
}

export function getIntegrationStoryWebhookSources(input: {
  connectionId: string;
  queryClient: QueryClient;
}): readonly IntegrationWebhookSource[] {
  return (
    input.queryClient.getQueryData<readonly IntegrationWebhookSource[]>([
      "integration-webhook-sources",
      input.connectionId,
    ]) ?? []
  );
}

export function setIntegrationStoryWebhookSources(input: {
  connectionId: string;
  queryClient: QueryClient;
  webhookSources: readonly IntegrationWebhookSource[];
}): void {
  input.queryClient.setQueryData(
    ["integration-webhook-sources", input.connectionId],
    input.webhookSources,
  );
}

export function IntegrationStoryControlPlaneProvider(input: {
  children: React.ReactNode;
  handlers?: readonly IntegrationStoryControlPlaneHandler[];
  queryClient: QueryClient;
}): React.JSX.Element {
  // Storybook stories need to synchronize with the browser fetch boundary so page code can
  // exercise the real dashboard query paths without a running control-plane service.
  useEffect(() => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (
      resource: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const request = resource instanceof Request ? resource : new Request(resource, init);
      const url = new URL(request.url);
      const storyControlPlaneApiOrigin = getDashboardStoryControlPlaneApiOrigin();

      if (url.origin !== storyControlPlaneApiOrigin) {
        return originalFetch(resource, init);
      }

      const method = request.method.toUpperCase();
      const path = url.pathname;
      const directoryData = getIntegrationStoryDirectoryData(input.queryClient);

      if (method === "GET" && path === "/v1/integration/targets") {
        return createJsonStoryResponse(createPageStoryResponse(directoryData.targets));
      }

      if (method === "GET" && path === "/v1/integration/connections") {
        return createJsonStoryResponse(createPageStoryResponse(directoryData.connections));
      }

      const webhookSourcesMatch = path.match(
        /^\/v1\/integration\/connections\/([^/]+)\/webhook-sources$/,
      );
      if (method === "GET" && webhookSourcesMatch !== null) {
        const connectionId = decodeURIComponent(webhookSourcesMatch[1] ?? "");
        return createJsonStoryResponse(
          getIntegrationStoryWebhookSources({
            connectionId,
            queryClient: input.queryClient,
          }),
        );
      }

      const requestInput: IntegrationStoryControlPlaneRequest = {
        directoryData,
        method,
        path,
        queryClient: input.queryClient,
        request,
        storyControlPlaneApiOrigin,
        url,
      };

      for (const handler of input.handlers ?? []) {
        const response = await handler(requestInput);
        if (response !== null) {
          return response;
        }
      }

      return createJsonStoryResponse(
        { code: "STORYBOOK_UNHANDLED", message: `${method} ${path} is not handled in Storybook.` },
        500,
      );
    };

    return () => {
      globalThis.fetch = originalFetch;
    };
  }, [input.handlers, input.queryClient]);

  return <QueryClientProvider client={input.queryClient}>{input.children}</QueryClientProvider>;
}

export function IntegrationSetupRouteStory(input: {
  handlers?: readonly IntegrationStoryControlPlaneHandler[];
  initialEntries: IntegrationStoryInitialEntries;
  queryClient: QueryClient;
  routeKind: "create-and-detail" | "create-and-setup" | "detail" | "setup";
}): React.JSX.Element {
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />}>
          <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="/integrations">
            <Route element={<Outlet />} handle={ROUTE_HANDLES.integrationDetail} path=":targetKey">
              {input.routeKind === "detail" || input.routeKind === "create-and-detail" ? (
                <Route element={<IntegrationsPage />} index />
              ) : null}
              {input.routeKind === "create-and-detail" || input.routeKind === "create-and-setup" ? (
                <Route
                  element={<IntegrationConnectionCreatePage />}
                  handle={ROUTE_HANDLES.integrationCreate}
                  path="add"
                />
              ) : null}
              {input.routeKind === "setup" || input.routeKind === "create-and-setup" ? (
                <Route
                  element={<IntegrationConnectionSetupPage />}
                  handle={ROUTE_HANDLES.integrationSetup}
                  path=":connectionId/:setupRouteSegment/setup"
                />
              ) : null}
            </Route>
          </Route>
        </Route>,
      ),
      {
        initialEntries: [...input.initialEntries],
      },
    ),
  );

  return (
    <IntegrationStoryControlPlaneProvider
      {...(input.handlers === undefined ? {} : { handlers: input.handlers })}
      queryClient={input.queryClient}
    >
      <RouterProvider router={router} />
    </IntegrationStoryControlPlaneProvider>
  );
}
