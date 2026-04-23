import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
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

import { resetDashboardConfigForTest } from "../../config.js";
import { withDashboardCenteredStory, withDashboardPageStory } from "../../storybook/decorators.js";
import {
  IntegrationConnectionDetailView,
  type IntegrationConnectionDetailViewProps,
} from "../integrations/integration-connection-detail-view.js";
import { createGitHubAppDetailViewStoryProps } from "../integrations/integration-story-harness.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { IntegrationConnectionCreatePage } from "./integration-connection-create-page.js";
import { IntegrationConnectionGitHubManualSetupPage } from "./integration-connection-github-manual-setup-page.js";
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
const StoryIntegrationCreateHandle = {
  ...ROUTE_HANDLES.integrationCreate,
  description: "",
} as const;
const StoryIntegrationGitHubManualSetupHandle = {
  ...ROUTE_HANDLES.integrationGitHubManualSetup,
  description: "",
} as const;

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
    targets: [createGitHubTargetFixture()],
    connections: [...(input.connections ?? [])],
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
    connectionMethods: GitHubDefinition.connectionMethods?.map((method) => {
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

      if (method.kind === "redirect") {
        return {
          id: method.id,
          label: method.label,
          kind: method.kind,
          ui: method.ui,
        };
      }

      return {
        id: method.id,
        label: method.label,
        kind: method.kind,
        ui: method.ui,
      };
    }),
    targetHealth: {
      configStatus: "valid",
    },
  };
}

function createDraftGitHubConnection(input?: {
  config?: Record<string, unknown>;
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
    providerMetadata: {},
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  };
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
                handle={StoryIntegrationCreateHandle}
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
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function GitHubManualSetupPageStory(input: {
  connection: IntegrationConnection;
  webhookSources: readonly IntegrationWebhookSource[];
}): React.JSX.Element {
  configureDashboardRuntimeForStory();
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [input.connection],
      webhookSources: input.webhookSources,
    }),
  );
  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />}>
          <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="/integrations">
            <Route element={<Outlet />} handle={ROUTE_HANDLES.integrationDetail} path=":targetKey">
              <Route
                element={<IntegrationConnectionGitHubManualSetupPage />}
                handle={StoryIntegrationGitHubManualSetupHandle}
                path=":connectionId/github-app/setup"
              />
            </Route>
          </Route>
        </Route>,
      ),
      {
        initialEntries: ["/integrations/github-cloud/icn_github_story_draft/github-app/setup"],
      },
    ),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function GitHubDetailStory(input: {
  props: Omit<
    IntegrationConnectionDetailViewProps,
    | "onCreateWebhookSource"
    | "onDeleteWebhookSource"
    | "onEditAuthentication"
    | "onRefreshResource"
    | "onStartGitHubAppInstallation"
  >;
}): React.JSX.Element {
  return (
    <IntegrationConnectionDetailView
      {...input.props}
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
}

const pageMeta = {
  title: "Dashboard/Integrations/Add Flows/GitHub",
  decorators: [withDashboardPageStory],
} satisfies Meta;

export default pageMeta;

type PageStory = StoryObj<typeof pageMeta>;

export const AddConnection: PageStory = {
  render: function RenderStory() {
    return <GitHubCreatePageStory />;
  },
};

export const SetupAppManually: PageStory = {
  render: function RenderStory() {
    return (
      <GitHubManualSetupPageStory
        connection={createDraftGitHubConnection()}
        webhookSources={[createWebhookSourceFixture()]}
      />
    );
  },
};

export const SetupAppManuallyWithPrefilledValues: PageStory = {
  render: function RenderStory() {
    return (
      <GitHubManualSetupPageStory
        connection={createDraftGitHubConnection({
          config: {
            app_id: "12345",
            app_slug: "mistle-github-app",
            client_id: "Iv1.prefilledstorybook",
          },
        })}
        webhookSources={[createWebhookSourceFixture()]}
      />
    );
  },
};

export const InstalledDetail: PageStory = {
  decorators: [withDashboardCenteredStory],
  render: function RenderStory() {
    return <GitHubDetailStory props={createGitHubAppDetailViewStoryProps()} />;
  },
};
