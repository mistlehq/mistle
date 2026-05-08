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
import {
  createGitHubAppDetailViewStoryProps,
  createStoryWebhookTriggerCapabilitiesProviderMetadata,
} from "../integrations/integration-story-harness.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { IntegrationConnectionCreatePage } from "./integration-connection-create-page.js";
import { IntegrationConnectionSetupPage } from "./integration-connection-setup-page.js";
import { IntegrationsPage } from "./integrations-page.js";
import { createStoryConnectionMethods } from "./organization-integrations-settings-page-story-support.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
function getGitHubDefinitionOrThrow(): AnyIntegrationDefinition {
  const definition = IntegrationRegistry.getDefinition({
    familyId: "github",
    variantId: "github-cloud",
  });

  if (definition === null || definition === undefined) {
    throw new Error("Missing GitHub Cloud integration definition for Storybook.");
  }

  return definition;
}

const GitHubDefinition = getGitHubDefinitionOrThrow();
const StoryControlPlaneApiOrigin = "https://control-plane.example.com";

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
    targets: [createGitHubTargetFixture()],
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

function createGitHubTargetFixture(): IntegrationTarget {
  return {
    targetKey: "github-cloud",
    familyId: GitHubDefinition.familyId,
    variantId: GitHubDefinition.variantId,
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
    displayName: GitHubDefinition.displayName,
    description: GitHubDefinition.description ?? "",
    ...(GitHubDefinition.logoKey === undefined ? {} : { logoKey: GitHubDefinition.logoKey }),
    connectionMethods: createStoryConnectionMethods(GitHubDefinition),
    targetHealth: {
      configStatus: "valid",
    },
  };
}

export function createDraftGitHubConnection(input?: {
  config?: Record<string, unknown>;
  configuredSecretNames?: readonly string[];
  externalSubjectId?: string;
}): IntegrationConnection {
  return {
    id: "icn_github_story_draft",
    targetKey: "github-cloud",
    displayName: "Engineering GitHub",
    status: "active",
    connectionMethodId: "github-app-installation",
    connectionMethodLabel: "GitHub App installation",
    config: {
      connection_method: "github-app-installation",
      ...(input?.config ?? {}),
    },
    ...(input?.externalSubjectId === undefined
      ? {}
      : { externalSubjectId: input.externalSubjectId }),
    ...(input?.configuredSecretNames === undefined
      ? {}
      : { configuredSecretNames: [...input.configuredSecretNames] }),
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  };
}

function createWebhookSourceFixture(): IntegrationWebhookSource {
  return {
    id: "iws_github_story",
    targetKey: "github-cloud",
    integrationConnectionId: "icn_github_story_draft",
    displayName: "GitHub App webhook",
    endpointKey: "eps_github_story",
    callbackUrl:
      "https://control-plane.example.com/p/integration/webhooks/github-cloud/eps_github_story",
    status: "active",
    providerMetadata: createStoryWebhookTriggerCapabilitiesProviderMetadata({
      definition: GitHubDefinition,
      events: ["issues", "pull_request", "check_suite"],
      permissions: [
        { permission: "issues", access: "read" },
        { permission: "pull_requests", access: "read" },
        { permission: "checks", access: "read" },
      ],
    }),
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
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

const StoryGitHubManifestStartRequestBodySchema = z.object({
  manifest: z.record(z.string(), z.unknown()),
  ownerKind: z.enum(["organization", "personal"]),
  organizationSlug: z.string().optional(),
});

function useGitHubStoryControlPlane(input: { queryClient: QueryClient }): void {
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
          updatedAt: "2026-04-24T00:00:00.000Z",
        };

        input.queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: directoryData.targets,
          connections: directoryData.connections.map((connection) =>
            connection.id === connectionId ? updatedConnection : connection,
          ),
        });

        return createJsonResponse(updatedConnection);
      }

      const startInstallMatch = path.match(
        /^\/v1\/integration\/connections\/([^/]+)\/setup\/github-app-installation\/start$/,
      );
      if (method === "POST" && startInstallMatch !== null) {
        return createJsonResponse({
          kind: "redirect",
          authorizationUrl: `${StoryControlPlaneApiOrigin}/storybook/github-app-install`,
        });
      }

      const startManifestMatch = path.match(
        /^\/v1\/integration\/connections\/([^/]+)\/setup\/github-app\/start$/,
      );
      if (method === "POST" && startManifestMatch !== null) {
        const requestBody: unknown = await request.json();
        StoryGitHubManifestStartRequestBodySchema.parse(requestBody);
        return createJsonResponse({
          kind: "form-post",
          submissionUrl: "https://github.com/settings/apps/new",
          fields: {
            manifest: JSON.stringify({
              name: "Mistle GitHub App",
            }),
          },
        });
      }

      const createDraftMatch = path.match(
        /^\/v1\/integration\/connections\/([^/]+)\/github-app-installation\/draft$/,
      );
      if (method === "POST" && createDraftMatch !== null) {
        const targetKey = decodeURIComponent(createDraftMatch[1] ?? "");
        const requestBody: unknown = await request.json();
        const body = StoryDraftConnectionRequestBodySchema.parse(requestBody);
        const createdConnection: IntegrationConnection = {
          id: "icn_github_story_created",
          targetKey,
          displayName: body.displayName,
          status: "active",
          connectionMethodId: "github-app-installation",
          connectionMethodLabel: "GitHub App installation",
          config: {
            connection_method: "github-app-installation",
          },
          createdAt: "2026-04-24T00:00:00.000Z",
          updatedAt: "2026-04-24T00:00:00.000Z",
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
  useGitHubStoryControlPlane({ queryClient: input.queryClient });

  return <QueryClientProvider client={input.queryClient}>{input.children}</QueryClientProvider>;
}

function GitHubCreatePageStory(): React.JSX.Element {
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
            </Route>
          </Route>
        </Route>,
      ),
      {
        initialEntries: ["/integrations/github-cloud/add"],
      },
    ),
  );

  return (
    <StoryQueryClientProvider queryClient={queryClient}>
      <RouterProvider router={router} />
    </StoryQueryClientProvider>
  );
}

export function GitHubAppSetupPageStory(input: {
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
            "/integrations/github-cloud/icn_github_story_draft/github-app/setup",
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

function GitHubInstalledDetailPageStory(): React.JSX.Element {
  configureDashboardRuntimeForStory();
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [
        createDraftGitHubConnection({
          config: {
            app_id: "12345",
            app_slug: "mistle-github-app",
            client_id: "Iv1.installedstorybook",
            installation_id: "12345",
          },
          configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
          externalSubjectId: "12345",
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
          "/integrations/github-cloud?connectionId=icn_github_story_draft&connectionNotice=installed",
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
  title: "Dashboard/Integrations/Setup/GitHub App",
  decorators: [withDashboardPageStory],
  excludeStories: ["createDraftGitHubConnection", "GitHubAppSetupPageStory"],
} satisfies Meta;

export default pageMeta;

type PageStory = StoryObj<typeof pageMeta>;

export const AddConnection: PageStory = {
  render: function RenderStory() {
    return <GitHubCreatePageStory />;
  },
};

export const SetupWithManifest: PageStory = {
  render: function RenderStory() {
    return <GitHubAppSetupPageStory connection={createDraftGitHubConnection()} />;
  },
};

export const SetupWithExistingApp: PageStory = {
  render: function RenderStory() {
    return (
      <GitHubAppSetupPageStory
        connection={createDraftGitHubConnection({
          config: {
            app_id: "12345",
            app_slug: "mistle-github-app",
            client_id: "Iv1.prefilledstorybook",
          },
        })}
      />
    );
  },
};

export const ReadyToInstall: PageStory = {
  render: function RenderStory() {
    return (
      <GitHubAppSetupPageStory
        connection={createDraftGitHubConnection({
          config: {
            app_id: "12345",
            app_slug: "mistle-github-app",
            client_id: "Iv1.prefilledstorybook",
          },
          configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
        })}
      />
    );
  },
};

export const ManifestCreated: PageStory = {
  render: function RenderStory() {
    return (
      <GitHubAppSetupPageStory
        connection={createDraftGitHubConnection({
          config: {
            app_id: "12345",
            app_slug: "mistle-github-app",
            client_id: "Iv1.manifeststorybook",
          },
          configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
        })}
        initialEntry="/integrations/github-cloud/icn_github_story_draft/github-app/setup?githubAppManifest=created"
      />
    );
  },
};

export const InstalledRedirect: PageStory = {
  render: function RenderStory() {
    return <GitHubInstalledDetailPageStory />;
  },
};

export const InstalledDetailPreview: PageStory = {
  decorators: [withDashboardCenteredStory],
  render: function RenderStory() {
    return (
      <IntegrationConnectionDetailView
        {...createGitHubAppDetailViewStoryProps()}
        onCreateWebhookSource={() => {}}
        onDeleteWebhookSource={() => {}}
        onEditAuthentication={() => {}}
        onRefreshResource={() => {}}
        onStartGitHubAppInstallation={async () => {}}
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
