import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { z } from "zod";

import { getDashboardStoryControlPlaneApiOrigin } from "../../storybook/dashboard-story-config.js";
import { withDashboardCenteredStory, withDashboardPageStory } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import {
  createGitHubAppDetailViewStoryProps,
  createStoryWebhookTriggerCapabilitiesProviderMetadata,
} from "../integrations/integration-story-harness.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
  StartedProviderAppSetup,
} from "../integrations/integrations-service.js";
import { GitHubInstallationSelectionPanel } from "./integration-connection-provider-app-setup-pane.js";
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
const GitHubTarget = createIntegrationStoryTarget({
  definition: GitHubDefinition,
  config: {
    api_base_url: "https://api.github.com",
    web_base_url: "https://github.com",
  },
});

function createStoryQueryClient(input: {
  connections?: readonly IntegrationConnection[];
  webhookSources?: readonly IntegrationWebhookSource[];
}) {
  return createIntegrationStoryQueryClient({
    targets: [GitHubTarget],
    ...(input.connections === undefined ? {} : { connections: input.connections }),
    ...(input.webhookSources === undefined ? {} : { webhookSources: input.webhookSources }),
  });
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
    callbackUrl: `${getDashboardStoryControlPlaneApiOrigin()}/p/integration/webhooks/github-cloud/eps_github_story`,
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

const StorySelectInstallationRequestBodySchema = z.object({
  installationId: z.string(),
});

const StoryGitHubInstallationSelectionOptions: Extract<
  StartedProviderAppSetup,
  { kind: "installation-selection" }
>["options"] = [
  {
    accountLogin: "mistle",
    accountType: "Organization",
    installationId: "92345",
    repositorySelection: "all",
  },
  {
    accountLogin: "mistle-labs",
    accountType: "Organization",
    installationId: "92346",
    repositorySelection: "selected",
  },
  {
    accountLogin: "thomasjiang",
    accountType: "User",
    installationId: "92347",
    repositorySelection: "selected",
  },
];

function createGitHubStoryControlPlaneHandler(): IntegrationStoryControlPlaneHandler {
  return async ({
    directoryData,
    method,
    path,
    queryClient,
    request,
    storyControlPlaneApiOrigin,
  }) => {
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
        updatedAt: "2026-04-24T00:00:00.000Z",
      };

      setIntegrationStoryDirectoryData(queryClient, {
        targets: directoryData.targets,
        connections: directoryData.connections.map((connection) =>
          connection.id === connectionId ? updatedConnection : connection,
        ),
      });

      return createJsonStoryResponse(updatedConnection);
    }

    const startInstallMatch = path.match(
      /^\/v1\/integration\/connections\/([^/]+)\/setup\/github-app-installation\/start$/,
    );
    if (method === "POST" && startInstallMatch !== null) {
      const connectionId = decodeURIComponent(startInstallMatch[1] ?? "");
      if (connectionId === "icn_github_story_selection") {
        return createJsonStoryResponse({
          kind: "installation-selection",
          options: StoryGitHubInstallationSelectionOptions,
        });
      }

      return createJsonStoryResponse({
        kind: "redirect",
        authorizationUrl: `${storyControlPlaneApiOrigin}/storybook/github-app-install`,
      });
    }

    const selectInstallMatch = path.match(
      /^\/v1\/integration\/connections\/([^/]+)\/setup\/github-app-installation\/select-installation$/,
    );
    if (method === "POST" && selectInstallMatch !== null) {
      const connectionId = decodeURIComponent(selectInstallMatch[1] ?? "");
      const requestBody: unknown = await request.json();
      const body = StorySelectInstallationRequestBodySchema.parse(requestBody);
      const currentConnection =
        directoryData.connections.find((connection) => connection.id === connectionId) ?? null;
      if (currentConnection === null) {
        return createJsonStoryResponse(
          { code: "CONNECTION_NOT_FOUND", message: "Connection not found." },
          404,
        );
      }

      const updatedConnection: IntegrationConnection = {
        ...currentConnection,
        config: {
          ...currentConnection.config,
          installation_id: body.installationId,
        },
        externalSubjectId: body.installationId,
        updatedAt: "2026-04-24T00:00:00.000Z",
      };

      setIntegrationStoryDirectoryData(queryClient, {
        targets: directoryData.targets,
        connections: directoryData.connections.map((connection) =>
          connection.id === connectionId ? updatedConnection : connection,
        ),
      });

      return createJsonStoryResponse({
        connectionId,
        targetKey: currentConnection.targetKey,
        completionRedirect: {
          kind: "connection-detail",
          notice: "installed",
        },
      });
    }

    const startManifestMatch = path.match(
      /^\/v1\/integration\/connections\/([^/]+)\/setup\/github-app\/start$/,
    );
    if (method === "POST" && startManifestMatch !== null) {
      const requestBody: unknown = await request.json();
      StoryGitHubManifestStartRequestBodySchema.parse(requestBody);
      return createJsonStoryResponse({
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

    return null;
  };
}

const GitHubStoryControlPlaneHandlers = [createGitHubStoryControlPlaneHandler()];

function GitHubCreatePageStory(): React.JSX.Element {
  const [queryClient] = useState(() => createStoryQueryClient({}));

  return (
    <IntegrationSetupRouteStory
      handlers={GitHubStoryControlPlaneHandlers}
      initialEntries={["/integrations/github-cloud/add"]}
      queryClient={queryClient}
      routeKind="create-and-setup"
    />
  );
}

export function GitHubAppSetupPageStory(input: {
  connection: IntegrationConnection;
  initialEntry?: string;
}): React.JSX.Element {
  const [queryClient] = useState(() =>
    createStoryQueryClient({
      connections: [input.connection],
      webhookSources: [createWebhookSourceFixture()],
    }),
  );

  return (
    <IntegrationSetupRouteStory
      handlers={GitHubStoryControlPlaneHandlers}
      initialEntries={[
        input.initialEntry ?? "/integrations/github-cloud/icn_github_story_draft/github-app/setup",
      ]}
      queryClient={queryClient}
      routeKind="setup"
    />
  );
}

function GitHubInstalledDetailPageStory(): React.JSX.Element {
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

  return (
    <IntegrationSetupRouteStory
      handlers={GitHubStoryControlPlaneHandlers}
      initialEntries={[
        "/integrations/github-cloud?connectionId=icn_github_story_draft&connectionNotice=installed",
      ]}
      queryClient={queryClient}
      routeKind="detail"
    />
  );
}

const pageMeta = {
  title: "Dashboard/Integrations/Setup/GitHubApp",
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

export const ExistingAppWithInstallationsToSelect: PageStory = {
  render: function RenderStory() {
    return (
      <GitHubAppSetupPageStory
        connection={{
          ...createDraftGitHubConnection({
            config: {
              app_id: "12345",
              app_slug: "mistle-github-app",
              client_id: "Iv1.selectionstorybook",
            },
            configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
          }),
          id: "icn_github_story_selection",
        }}
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

export const InstallationSelectionPanel: PageStory = {
  decorators: [withDashboardCenteredStory],
  render: function RenderStory() {
    const [pendingInstallationId, setPendingInstallationId] = useState<string | null>(null);

    return (
      <div className="w-[560px] max-w-[calc(100vw-2rem)]">
        <GitHubInstallationSelectionPanel
          isPending={pendingInstallationId !== null}
          onSelectInstallation={(installationId) => {
            setPendingInstallationId(installationId);
          }}
          options={StoryGitHubInstallationSelectionOptions}
          pendingInstallationId={pendingInstallationId}
        />
      </div>
    );
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
        onStartProviderAppSetup={async () => {}}
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
