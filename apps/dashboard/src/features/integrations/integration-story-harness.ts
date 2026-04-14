import {
  buildIntegrationConnectionDetailItems,
  buildIntegrationConnectionResourceItemsByKey,
  createRefreshingResourceKey,
} from "../pages/integrations-page-view-model.js";
import type { IntegrationWebhookSourceSectionState } from "../pages/use-integration-webhook-source-state.js";
import type { IntegrationConnectionDetailViewProps } from "./integration-connection-detail-view.js";
import type {
  IntegrationConnection,
  IntegrationConnectionResource,
  IntegrationWebhookSource,
} from "./integrations-service.js";

export const DemoIntegrationConnections: readonly IntegrationConnection[] = [
  {
    id: "icn_github_primary",
    targetKey: "github",
    displayName: "Engineering GitHub",
    status: "active",
    config: {
      connection_method: "github-app-installation",
      app_id: "123",
      app_slug: "mistle-github-app",
      installation_id: 12345,
    },
    externalSubjectId: "mistle-labs",
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-11T04:30:00.000Z",
    resources: [
      {
        kind: "repositories",
        selectionMode: "multi",
        count: 41,
        syncState: "ready",
        lastSyncedAt: "2026-03-11T04:25:00.000Z",
      },
      {
        kind: "organizations",
        selectionMode: "single",
        count: 1,
        syncState: "ready",
        lastSyncedAt: "2026-03-11T04:25:00.000Z",
      },
    ],
  },
  {
    id: "icn_github_archive",
    targetKey: "github",
    displayName: "Archive Mirror",
    status: "error",
    config: { connection_method: "api-key" },
    createdAt: "2026-02-14T00:00:00.000Z",
    updatedAt: "2026-03-10T10:15:00.000Z",
    resources: [
      {
        kind: "repositories",
        selectionMode: "multi",
        count: 0,
        syncState: "error",
        lastErrorMessage: "GitHub returned a 403 while reading repository visibility.",
      },
      {
        kind: "organizations",
        selectionMode: "single",
        count: 0,
        syncState: "never-synced",
      },
    ],
  },
] as const;

export function getPrimaryDemoIntegrationConnection(): IntegrationConnection {
  const connection =
    DemoIntegrationConnections.find((item) => item.id === "icn_github_primary") ?? null;
  if (connection === null) {
    throw new Error("Expected a primary integration story connection.");
  }

  return connection;
}

export function createDetailViewStoryProps(input?: {
  connections?: readonly IntegrationConnection[];
  refreshingResourceKeys?: ReadonlySet<string>;
}) {
  const connections = input?.connections ?? DemoIntegrationConnections;
  const refreshingResourceKeys = input?.refreshingResourceKeys ?? new Set<string>();

  return {
    connections: buildIntegrationConnectionDetailItems({
      connections,
      refreshingResourceKeys,
    }),
    resourceItemsByKey: buildIntegrationConnectionResourceItemsByKey([
      {
        connectionId: "icn_github_primary",
        state: {
          errorMessage: null,
          isLoading: false,
          items: [
            {
              id: "repo_1",
              familyId: "github",
              kind: "repositories",
              handle: "mistle/dashboard",
              displayName: "mistle/dashboard",
              status: "accessible",
              metadata: {},
            },
            {
              id: "repo_2",
              familyId: "github",
              kind: "repositories",
              handle: "mistle/control-plane-api",
              displayName: "mistle/control-plane-api",
              status: "accessible",
              metadata: {},
            },
          ],
          kind: "repositories",
        },
      },
      {
        connectionId: "icn_github_archive",
        state: {
          errorMessage: null,
          isLoading: false,
          items: [],
          kind: "repositories",
        },
      },
    ]),
  };
}

export function createRefreshingDetailViewStoryProps() {
  const primaryConnection = getPrimaryDemoIntegrationConnection();

  return createDetailViewStoryProps({
    connections: [primaryConnection],
    refreshingResourceKeys: new Set<string>([
      createRefreshingResourceKey({
        connectionId: primaryConnection.id,
        kind: "repositories",
      }),
    ]),
  });
}

export function createDenseGitHubAppDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  const connectionId = "icn_github_dense";

  return {
    connections: [
      {
        id: connectionId,
        authMethodId: "github-app-installation",
        authMethodLabel: "GitHub App installation",
        bindingCount: 3,
        canDelete: false,
        contextItems: [
          {
            label: "App ID",
            value: "3079908",
          },
          {
            label: "App slug",
            value: "jon-mistle-github-app",
          },
          {
            label: "Installation",
            value: "116007157",
          },
        ],
        displayName: "GH",
        installActionLabel: "Manage installation",
        resources: [
          {
            count: 11,
            kind: "repository",
            lastSyncedAt: "2026-04-13T15:37:00.000Z",
            syncState: "ready",
          },
          {
            count: 45,
            kind: "branch",
            lastSyncedAt: "2026-04-13T15:37:00.000Z",
            syncState: "ready",
          },
          {
            count: 5,
            kind: "user",
            lastSyncedAt: "2026-04-13T15:37:00.000Z",
            syncState: "ready",
          },
        ],
        status: "active",
        webhookInstructions:
          "Copy the callback URL into your GitHub App webhook settings, then install the app to finish setup.",
      },
    ],
    onRefreshResource: () => {},
    resourceItemsByKey: buildIntegrationConnectionResourceItemsByKey([
      {
        connectionId,
        state: {
          errorMessage: null,
          isLoading: false,
          items: [
            {
              id: "repo_dense_1",
              familyId: "github",
              kind: "repository",
              handle: "mistlehq/company-os",
              displayName: "mistlehq/company-os",
              status: "accessible",
              metadata: {},
            },
            {
              id: "repo_dense_2",
              familyId: "github",
              kind: "repository",
              handle: "mistlehq/e2e-test-repo",
              displayName: "mistlehq/e2e-test-repo",
              status: "accessible",
              metadata: {},
            },
            {
              id: "repo_dense_3",
              familyId: "github",
              kind: "repository",
              handle: "mistlehq/mistle",
              displayName: "mistlehq/mistle",
              status: "accessible",
              metadata: {},
            },
            {
              id: "repo_dense_4",
              familyId: "github",
              kind: "repository",
              handle: "mistlehq/tools",
              displayName: "mistlehq/tools",
              status: "accessible",
              metadata: {},
            },
          ],
          kind: "repository",
        },
      },
      {
        connectionId,
        state: {
          errorMessage: null,
          isLoading: false,
          items: [
            {
              id: "branch_dense_1",
              familyId: "github",
              kind: "branch",
              handle: "main",
              displayName: "main",
              status: "accessible",
              metadata: {},
            },
            {
              id: "branch_dense_2",
              familyId: "github",
              kind: "branch",
              handle: "integration-form-page",
              displayName: "integration-form-page",
              status: "accessible",
              metadata: {},
            },
            {
              id: "branch_dense_3",
              familyId: "github",
              kind: "branch",
              handle: "feat/sandbox-followup-orchestration",
              displayName: "feat/sandbox-followup-orchestration",
              status: "accessible",
              metadata: {},
            },
            {
              id: "branch_dense_4",
              familyId: "github",
              kind: "branch",
              handle: "session-primary-repo-cli-cwd",
              displayName: "session-primary-repo-cli-cwd",
              status: "accessible",
              metadata: {},
            },
            {
              id: "branch_dense_5",
              familyId: "github",
              kind: "branch",
              handle: "normalize-uploaded-image-followup",
              displayName: "normalize-uploaded-image-followup",
              status: "accessible",
              metadata: {},
            },
          ],
          kind: "branch",
        },
      },
      {
        connectionId,
        state: {
          errorMessage: null,
          isLoading: false,
          items: [
            {
              id: "user_dense_1",
              familyId: "github",
              kind: "user",
              handle: "blacksmith-sh[bot]",
              displayName: "blacksmith-sh[bot]",
              status: "accessible",
              metadata: {},
            },
            {
              id: "user_dense_2",
              familyId: "github",
              kind: "user",
              handle: "dependabot[bot]",
              displayName: "dependabot[bot]",
              status: "accessible",
              metadata: {},
            },
            {
              id: "user_dense_3",
              familyId: "github",
              kind: "user",
              handle: "jlowhy",
              displayName: "jlowhy",
              status: "accessible",
              metadata: {},
            },
          ],
          kind: "user",
        },
      },
    ]),
    showWebhookSources: true,
    webhookSourceStateByConnectionId: new Map<string, IntegrationWebhookSourceSectionState>([
      [
        connectionId,
        {
          createErrorMessage: null,
          deleteErrorMessage: null,
          deletingWebhookSourceId: null,
          isCreating: false,
          isLoading: false,
          items: [
            {
              callbackUrl:
                "http://localhost:5100/p/integration/webhooks/github-cloud/-uV97vES3GH033SdR8524w",
              createdAt: "2026-04-13T15:37:00.000Z",
              displayName: "GitHub App webhook",
              endpointKey: "github-cloud",
              id: "iws_01densegithubsource",
              integrationConnectionId: connectionId,
              providerMetadata: {},
              status: "active",
              targetKey: "github-cloud",
              updatedAt: "2026-04-13T15:37:00.000Z",
            },
          ],
          loadErrorMessage: null,
          revealedWebhookSecret: null,
        },
      ],
    ]),
  };
}

type DenseDetailStorySpec = {
  authMethodId?: string;
  authMethodLabel?: string;
  bindingCount?: number;
  connectionId: string;
  contextItems?: readonly {
    label: string;
    value: string;
  }[];
  displayName: string;
  familyId?: string;
  installActionLabel?: string;
  resources?: readonly {
    count: number;
    items: readonly string[];
    kind: string;
    lastErrorMessage?: string;
    lastSyncedAt?: string;
    syncState: "never-synced" | "syncing" | "ready" | "error";
  }[];
  setupDescription?: string;
  setupStatusLabel?: string;
  showCreateWebhookSource?: boolean;
  status?: "active" | "error" | "revoked";
  webhookInstructions?: string;
  webhookSources?: readonly IntegrationWebhookSource[];
};

function createDenseResourceItems(
  input: DenseDetailStorySpec,
): IntegrationConnectionDetailViewProps["resourceItemsByKey"] {
  const resources = input.resources ?? [];
  const familyId = input.familyId ?? "integration";

  return buildIntegrationConnectionResourceItemsByKey(
    resources.map((resource) => ({
      connectionId: input.connectionId,
      state: {
        errorMessage: null,
        isLoading: false,
        items: resource.items.map(
          (item, index): IntegrationConnectionResource => ({
            id: `${input.connectionId}:${resource.kind}:${String(index + 1)}`,
            displayName: item,
            familyId,
            handle: item,
            kind: resource.kind,
            metadata: {},
            status: "accessible",
          }),
        ),
        kind: resource.kind,
      },
    })),
  );
}

function createWebhookSourceSectionState(
  input: DenseDetailStorySpec,
): IntegrationConnectionDetailViewProps["webhookSourceStateByConnectionId"] | undefined {
  if (input.webhookSources === undefined) {
    return undefined;
  }

  return new Map<string, IntegrationWebhookSourceSectionState>([
    [
      input.connectionId,
      {
        createErrorMessage: null,
        deleteErrorMessage: null,
        deletingWebhookSourceId: null,
        isCreating: false,
        isLoading: false,
        items: input.webhookSources,
        loadErrorMessage: null,
        revealedWebhookSecret: null,
      },
    ],
  ]);
}

function createDenseDetailViewStoryProps(
  input: DenseDetailStorySpec,
): IntegrationConnectionDetailViewProps {
  const resourceItemsByKey = createDenseResourceItems(input);
  const webhookSourceStateByConnectionId = createWebhookSourceSectionState(input);

  return {
    connections: [
      {
        bindingCount: input.bindingCount ?? 0,
        canDelete: input.bindingCount === undefined || input.bindingCount === 0,
        ...(input.authMethodId === undefined ? {} : { authMethodId: input.authMethodId }),
        ...(input.authMethodLabel === undefined ? {} : { authMethodLabel: input.authMethodLabel }),
        ...(input.contextItems === undefined ? {} : { contextItems: input.contextItems }),
        displayName: input.displayName,
        id: input.connectionId,
        ...(input.installActionLabel === undefined
          ? {}
          : { installActionLabel: input.installActionLabel }),
        resources: (input.resources ?? []).map((resource) => ({
          count: resource.count,
          isRefreshing: false,
          kind: resource.kind,
          ...(resource.lastErrorMessage === undefined
            ? {}
            : { lastErrorMessage: resource.lastErrorMessage }),
          ...(resource.lastSyncedAt === undefined ? {} : { lastSyncedAt: resource.lastSyncedAt }),
          syncState: resource.syncState,
        })),
        ...(input.setupDescription === undefined
          ? {}
          : { setupDescription: input.setupDescription }),
        ...(input.setupStatusLabel === undefined
          ? {}
          : { setupStatusLabel: input.setupStatusLabel }),
        status: input.status ?? "active",
        ...(input.webhookInstructions === undefined
          ? {}
          : { webhookInstructions: input.webhookInstructions }),
      },
    ],
    onEditApiKey: () => {},
    onRefreshResource: () => {},
    ...(resourceItemsByKey === undefined ? {} : { resourceItemsByKey }),
    ...(webhookSourceStateByConnectionId === undefined
      ? {}
      : {
          showCreateWebhookSource: input.showCreateWebhookSource ?? false,
          showWebhookSources: true,
          webhookSourceStateByConnectionId,
        }),
  };
}

const DenseStoryLastSyncedAt = "2026-04-13T15:37:00.000Z";

export function createDenseGitHubEnterpriseServerDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    familyId: "github",
    authMethodId: "github-app-installation",
    authMethodLabel: "GitHub App installation",
    bindingCount: 2,
    connectionId: "icn_github_ghes_dense",
    contextItems: [
      { label: "App ID", value: "88421" },
      { label: "App slug", value: "mistle-ghes" },
      { label: "Installation", value: "992144" },
    ],
    displayName: "GitHub Enterprise",
    installActionLabel: "Manage installation",
    resources: [
      {
        count: 7,
        items: [
          "platform/control-plane",
          "platform/dashboard",
          "platform/data-plane",
          "platform/agents",
        ],
        kind: "repository",
        lastSyncedAt: DenseStoryLastSyncedAt,
        syncState: "ready",
      },
      {
        count: 18,
        items: ["main", "release/2026.04", "feat/self-hosted-webhooks", "ops/incident-runbook"],
        kind: "branch",
        lastSyncedAt: DenseStoryLastSyncedAt,
        syncState: "ready",
      },
    ],
    webhookInstructions:
      "Copy the callback URL into your GitHub App webhook settings, then install the app to finish setup.",
    webhookSources: [
      {
        callbackUrl:
          "https://control-plane.example.com/p/integration/webhooks/github-enterprise-server/ep_ghes_123",
        createdAt: DenseStoryLastSyncedAt,
        displayName: "GitHub Enterprise App webhook",
        endpointKey: "github-enterprise-server",
        id: "iws_ghes_123",
        integrationConnectionId: "icn_github_ghes_dense",
        providerMetadata: {},
        status: "active",
        targetKey: "github-enterprise-server",
        updatedAt: DenseStoryLastSyncedAt,
      },
    ],
  });
}

export function createDenseGitHubApiKeyDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    familyId: "github",
    authMethodId: "api-key",
    authMethodLabel: "API key",
    bindingCount: 2,
    connectionId: "icn_github_api_key_dense",
    contextItems: [
      { label: "API base URL", value: "https://api.github.com" },
      { label: "Owner", value: "mistlehq" },
    ],
    displayName: "GitHub Personal Access Token",
    resources: [
      {
        count: 11,
        items: ["mistlehq/company-os", "mistlehq/mistle", "mistlehq/tools", "mistlehq/mistle-next"],
        kind: "repository",
        lastSyncedAt: DenseStoryLastSyncedAt,
        syncState: "ready",
      },
      {
        count: 21,
        items: ["main", "integration-form-page", "migrate-website", "fix/github-target-errors"],
        kind: "branch",
        lastSyncedAt: DenseStoryLastSyncedAt,
        syncState: "ready",
      },
    ],
  });
}

export function createDenseGitHubEnterpriseServerApiKeyDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    familyId: "github",
    authMethodId: "api-key",
    authMethodLabel: "API key",
    bindingCount: 1,
    connectionId: "icn_github_ghes_api_key_dense",
    contextItems: [
      { label: "API base URL", value: "https://github.acme.example/api/v3" },
      { label: "Owner", value: "platform" },
    ],
    displayName: "GitHub Enterprise Token",
    resources: [
      {
        count: 7,
        items: [
          "platform/control-plane",
          "platform/dashboard",
          "platform/data-plane",
          "platform/agents",
        ],
        kind: "repository",
        lastSyncedAt: DenseStoryLastSyncedAt,
        syncState: "ready",
      },
      {
        count: 18,
        items: ["main", "release/2026.04", "feat/self-hosted-webhooks", "ops/incident-runbook"],
        kind: "branch",
        lastSyncedAt: DenseStoryLastSyncedAt,
        syncState: "ready",
      },
    ],
  });
}

export function createDenseJiraDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    bindingCount: 1,
    connectionId: "icn_jira_dense",
    displayName: "Jira Production",
    showCreateWebhookSource: true,
    webhookSources: [
      {
        callbackUrl:
          "https://control-plane.example.com/p/integration/webhooks/jira-default/ep_jira_dense",
        createdAt: DenseStoryLastSyncedAt,
        displayName: "Jira admin webhook",
        endpointKey: "ep_jira_dense",
        id: "iws_jira_dense",
        integrationConnectionId: "icn_jira_dense",
        providerMetadata: {},
        remoteRegistrationId: "10001",
        status: "active",
        targetKey: "jira-default",
        updatedAt: DenseStoryLastSyncedAt,
      },
    ],
  });
}

export function createDenseJiraServiceAccountApiTokenDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    bindingCount: 1,
    connectionId: "icn_jira_service_account_api_dense",
    displayName: "Jira Service Account",
  });
}

export function createDenseJiraServiceAccountOauthDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    bindingCount: 1,
    connectionId: "icn_jira_service_account_oauth_dense",
    displayName: "Jira OAuth Service Account",
  });
}

export function createDenseLinearDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    authMethodId: "api-key",
    authMethodLabel: "API key",
    connectionId: "icn_linear_dense",
    displayName: "Linear Workspace",
  });
}

export function createDenseSlackDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    authMethodId: "slack-bot-token",
    authMethodLabel: "Bot token",
    bindingCount: 2,
    connectionId: "icn_slack_dense",
    displayName: "Slack Engineering",
    webhookSources: [
      {
        callbackUrl:
          "https://control-plane.example.com/p/integration/webhooks/slack-default/ep_slack_dense",
        createdAt: DenseStoryLastSyncedAt,
        displayName: "Slack Events API webhook",
        endpointKey: "ep_slack_dense",
        id: "iws_slack_dense",
        integrationConnectionId: "icn_slack_dense",
        providerMetadata: {},
        status: "active",
        targetKey: "slack-default",
        updatedAt: DenseStoryLastSyncedAt,
      },
    ],
  });
}

export function createDenseOpenAiDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    authMethodId: "api-key",
    authMethodLabel: "API key",
    connectionId: "icn_openai_dense",
    displayName: "OpenAI Production",
  });
}

export function createDenseOpenAiChatGptDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    authMethodId: "chatgpt-device-code",
    authMethodLabel: "ChatGPT subscription",
    connectionId: "icn_openai_chatgpt_dense",
    displayName: "OpenAI ChatGPT Subscription",
  });
}

export function createDenseAwsDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    authMethodId: "aws-assume-role",
    authMethodLabel: "Access key + AssumeRole",
    connectionId: "icn_aws_dense",
    displayName: "AWS Engineering",
  });
}

export function createDenseDatadogDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    authMethodId: "api-key",
    authMethodLabel: "API key",
    connectionId: "icn_datadog_dense",
    displayName: "Datadog Production",
  });
}

export function createDensePlanetScaleDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    authMethodId: "oauth2-authorization-code",
    authMethodLabel: "PlanetScale OAuth",
    connectionId: "icn_planetscale_dense",
    displayName: "PlanetScale Hosted MCP",
  });
}

export function createDenseSigNozDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createDenseDetailViewStoryProps({
    authMethodId: "oauth2-authorization-code",
    authMethodLabel: "SigNoz OAuth",
    connectionId: "icn_signoz_dense",
    displayName: "SigNoz Hosted MCP",
  });
}

export function createDenseIntegrationGalleryStoryProps(): IntegrationConnectionDetailViewProps {
  const storyProps = [
    createDenseGitHubAppDetailViewStoryProps(),
    createDenseGitHubEnterpriseServerDetailViewStoryProps(),
    createDenseJiraDetailViewStoryProps(),
    createDenseLinearDetailViewStoryProps(),
    createDenseSlackDetailViewStoryProps(),
    createDenseOpenAiDetailViewStoryProps(),
    createDenseAwsDetailViewStoryProps(),
    createDenseDatadogDetailViewStoryProps(),
    createDensePlanetScaleDetailViewStoryProps(),
    createDenseSigNozDetailViewStoryProps(),
  ];

  return {
    connections: storyProps.flatMap((story) => story.connections),
    onEditApiKey: () => {},
    onRefreshResource: () => {},
    resourceItemsByKey: new Map(
      storyProps.flatMap((story) => Array.from(story.resourceItemsByKey?.entries() ?? [])),
    ),
    showCreateWebhookSource: true,
    showWebhookSources: true,
    webhookSourceStateByConnectionId: new Map(
      storyProps.flatMap((story) =>
        Array.from(story.webhookSourceStateByConnectionId?.entries() ?? []),
      ),
    ),
  };
}

export type DenseIntegrationDetailControlVariant =
  | "github-cloud:github-app-installation"
  | "github-cloud:api-key"
  | "github-enterprise-server:github-app-installation"
  | "github-enterprise-server:api-key"
  | "jira-default:jira-personal-api-token"
  | "jira-default:jira-service-account-api-token"
  | "jira-default:jira-service-account-oauth-client-credentials"
  | "linear-default:api-key"
  | "slack-default:slack-bot-token"
  | "openai-default:api-key"
  | "openai-default:chatgpt-device-code"
  | "aws-cli-default:aws-assume-role"
  | "datadog-default:api-key"
  | "planetscale-mcp:oauth2-authorization-code"
  | "signoz-mcp:oauth2-authorization-code";

export function createDenseIntegrationDetailViewStoryPropsForVariant(
  variant: DenseIntegrationDetailControlVariant,
): IntegrationConnectionDetailViewProps {
  if (variant === "github-cloud:github-app-installation") {
    return createDenseGitHubAppDetailViewStoryProps();
  }
  if (variant === "github-cloud:api-key") {
    return createDenseGitHubApiKeyDetailViewStoryProps();
  }
  if (variant === "github-enterprise-server:github-app-installation") {
    return createDenseGitHubEnterpriseServerDetailViewStoryProps();
  }
  if (variant === "github-enterprise-server:api-key") {
    return createDenseGitHubEnterpriseServerApiKeyDetailViewStoryProps();
  }
  if (variant === "jira-default:jira-personal-api-token") {
    return createDenseJiraDetailViewStoryProps();
  }
  if (variant === "jira-default:jira-service-account-api-token") {
    return createDenseJiraServiceAccountApiTokenDetailViewStoryProps();
  }
  if (variant === "jira-default:jira-service-account-oauth-client-credentials") {
    return createDenseJiraServiceAccountOauthDetailViewStoryProps();
  }
  if (variant === "linear-default:api-key") {
    return createDenseLinearDetailViewStoryProps();
  }
  if (variant === "slack-default:slack-bot-token") {
    return createDenseSlackDetailViewStoryProps();
  }
  if (variant === "openai-default:api-key") {
    return createDenseOpenAiDetailViewStoryProps();
  }
  if (variant === "openai-default:chatgpt-device-code") {
    return createDenseOpenAiChatGptDetailViewStoryProps();
  }
  if (variant === "aws-cli-default:aws-assume-role") {
    return createDenseAwsDetailViewStoryProps();
  }
  if (variant === "datadog-default:api-key") {
    return createDenseDatadogDetailViewStoryProps();
  }
  if (variant === "planetscale-mcp:oauth2-authorization-code") {
    return createDensePlanetScaleDetailViewStoryProps();
  }
  return createDenseSigNozDetailViewStoryProps();
}
