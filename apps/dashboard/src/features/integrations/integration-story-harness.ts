import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";

import {
  buildIntegrationConnectionDetailItems,
  buildIntegrationConnectionResourceItemsByKey,
  createIntegrationConnectionResourceKey,
  resolveIntegrationConnectionDetailWebhookPolicy,
} from "../pages/integrations-page-view-model.js";
import { resolveVisibleConnectionMethodConfigFields } from "../pages/use-integration-connection-editor-state-helpers.js";
import type { IntegrationWebhookSourceSectionState } from "../pages/use-integration-webhook-source-state.js";
import type { IntegrationConnectionDetailViewProps } from "./integration-connection-detail-view.js";
import type { IntegrationConnectionMethod } from "./integrations-service-shared.js";
import type {
  IntegrationConnection,
  IntegrationConnectionResource,
  IntegrationWebhookSource,
} from "./integrations-service.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();

type StoryAuthMethodSpec = {
  familyId: string;
  methodId: string;
  variantId: string;
};

type StoryResolvedAuthMethod = {
  authMethodId: string;
  authMethodLabel: string;
  definition: AnyIntegrationDefinition;
  normalizedMethod: IntegrationConnectionMethod;
  secretLabels: readonly string[];
};

function getDefinitionOrThrow(input: {
  familyId: string;
  variantId: string;
}): AnyIntegrationDefinition {
  const definition = IntegrationRegistry.getDefinition(input);
  if (definition === null) {
    throw new Error(
      `Missing browser integration definition '${input.familyId}/${input.variantId}' for Storybook.`,
    );
  }

  if (definition === undefined) {
    throw new Error(
      `Browser integration definition '${input.familyId}/${input.variantId}' resolved to undefined.`,
    );
  }

  return definition;
}

function resolveAuthMethodOrThrow(input: StoryAuthMethodSpec): StoryResolvedAuthMethod {
  const definition = getDefinitionOrThrow({
    familyId: input.familyId,
    variantId: input.variantId,
  });
  const method = definition.connectionMethods?.find((connectionMethod) => {
    return connectionMethod.id === input.methodId;
  });

  if (method === undefined) {
    throw new Error(
      `Missing connection method '${input.methodId}' for '${input.familyId}/${input.variantId}' in Storybook.`,
    );
  }

  return {
    authMethodId: method.id,
    authMethodLabel: method.label,
    definition,
    normalizedMethod: normalizeStoryConnectionMethod(method),
    secretLabels: method.kind === "form" ? method.secretFields.map((field) => field.label) : [],
  };
}

function resolveStoryAuthFields(input: {
  authMethod: StoryAuthMethodSpec;
  connectionConfig?: Record<string, unknown>;
  connectionId: string;
}):
  | {
      authFields: readonly {
        label: string;
        value: string;
      }[];
      authSecretLabels?: readonly string[];
      authMethodId: string;
      authMethodLabel: string;
    }
  | undefined {
  const resolvedAuthMethod = resolveAuthMethodOrThrow(input.authMethod);
  const baseFields = [
    {
      label: "Method",
      value: resolvedAuthMethod.authMethodLabel,
    },
  ];

  if (input.connectionConfig === undefined) {
    return {
      authFields: baseFields,
      ...(resolvedAuthMethod.secretLabels.length === 0
        ? {}
        : { authSecretLabels: resolvedAuthMethod.secretLabels }),
      authMethodId: resolvedAuthMethod.authMethodId,
      authMethodLabel: resolvedAuthMethod.authMethodLabel,
    };
  }

  return {
    authFields: [
      ...baseFields,
      ...resolveVisibleConnectionMethodConfigFields({
        connectionId: input.connectionId,
        connectionMethod: resolvedAuthMethod.normalizedMethod,
        connectionConfig: input.connectionConfig,
        targetConfig: {},
        targetFamilyId: resolvedAuthMethod.definition.familyId,
        targetKey: resolvedAuthMethod.definition.variantId,
        targetVariantId: resolvedAuthMethod.definition.variantId,
      }),
    ],
    ...(resolvedAuthMethod.secretLabels.length === 0
      ? {}
      : { authSecretLabels: resolvedAuthMethod.secretLabels }),
    authMethodId: resolvedAuthMethod.authMethodId,
    authMethodLabel: resolvedAuthMethod.authMethodLabel,
  };
}

function normalizeStoryConnectionMethod(input: {
  id: string;
  kind: "device-authorization" | "form" | "redirect";
  label: string;
  secretFields?: readonly {
    description?: string;
    inputType: "password" | "text" | "textarea";
    label: string;
    name: string;
    placeholder?: string;
    slotKey?: string;
  }[];
  ui?: {
    create?: {
      helperText?: string;
      submitLabel?: string;
    };
    pending?: {
      description?: string;
      title?: string;
    };
  };
}): IntegrationConnectionMethod {
  if (input.kind === "form") {
    return {
      id: input.id,
      kind: "form",
      label: input.label,
      secretFields: [...(input.secretFields ?? [])],
    };
  }

  if (input.kind === "redirect") {
    if (input.ui?.create?.helperText === undefined || input.ui.create.submitLabel === undefined) {
      throw new Error(`Redirect method '${input.id}' is missing create UI for Storybook.`);
    }

    return {
      id: input.id,
      kind: "redirect",
      label: input.label,
      ui: {
        create: {
          helperText: input.ui.create.helperText,
          submitLabel: input.ui.create.submitLabel,
        },
      },
    };
  }

  if (input.ui?.create?.helperText === undefined || input.ui.create.submitLabel === undefined) {
    throw new Error(
      `Device authorization method '${input.id}' is missing create UI for Storybook.`,
    );
  }

  return {
    id: input.id,
    kind: "device-authorization",
    label: input.label,
    ui: {
      create: {
        helperText: input.ui.create.helperText,
        submitLabel: input.ui.create.submitLabel,
      },
      ...(input.ui.pending === undefined
        ? {}
        : {
            pending: {
              ...(input.ui.pending.description === undefined
                ? {}
                : { description: input.ui.pending.description }),
              ...(input.ui.pending.title === undefined ? {} : { title: input.ui.pending.title }),
            },
          }),
    },
  };
}

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
          errorMessage: null,
        },
      },
      {
        connectionId: "icn_github_archive",
        state: {
          isLoading: false,
          items: [],
          kind: "repositories",
          errorMessage: null,
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
      createIntegrationConnectionResourceKey({
        connectionId: primaryConnection.id,
        kind: "repositories",
      }),
    ]),
  });
}

export function createGitHubAppDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  const connectionId = "icn_github_dense";

  return {
    connections: [
      {
        id: connectionId,
        ...resolveStoryAuthFields({
          authMethod: {
            familyId: "github",
            methodId: "github-app-installation",
            variantId: "github-cloud",
          },
          connectionId,
        }),
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
        displayName: "GitHub App (Ready)",
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
            syncState: "error",
          },
          {
            count: 0,
            kind: "user",
            syncState: "never-synced",
          },
        ],
        status: "active",
      },
    ],
    onRefreshResource: () => {},
    resourceItemsByKey: buildIntegrationConnectionResourceItemsByKey([
      {
        connectionId,
        state: {
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
          errorMessage: null,
        },
      },
      {
        connectionId,
        state: {
          errorMessage:
            "GitHub returned a 403 while loading branch data. Check installation repository access.",
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
          isLoading: false,
          items: [],
          kind: "user",
          errorMessage: null,
        },
      },
    ]),
    webhookPolicy: resolveIntegrationConnectionDetailWebhookPolicy({
      webhookSource: { lifecycle: "implicit" },
    }),
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

export function createGitHubAppSetupIncompleteDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  const connectionId = "icn_github_setup_incomplete";

  return {
    connections: [
      {
        id: connectionId,
        ...resolveStoryAuthFields({
          authMethod: {
            familyId: "github",
            methodId: "github-app-installation",
            variantId: "github-cloud",
          },
          connectionId,
        }),
        bindingCount: 0,
        canDelete: true,
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
            value: "Pending",
          },
        ],
        displayName: "GitHub App (Setup Incomplete)",
        installActionLabel: "Install GitHub App",
        resources: [],
        setup: {
          description: "Set these URLs in your GitHub App settings, then install the app.",
          postInstallationSetupUrl:
            "https://control-plane.example.com/p/integration/callbacks/github-app-installation",
        },
        status: "active",
      },
    ],
    webhookPolicy: resolveIntegrationConnectionDetailWebhookPolicy({
      webhookSource: { lifecycle: "implicit" },
    }),
    webhookSourceStateByConnectionId: new Map([
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
                "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_github_setup_incomplete",
              createdAt: "2026-04-13T15:37:00.000Z",
              displayName: "GitHub App webhook",
              endpointKey: "ep_github_setup_incomplete",
              id: "iws_github_setup_incomplete",
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

export function createGitHubNotSyncedDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  const connectionId = "icn_github_not_synced";

  return {
    connections: [
      {
        id: connectionId,
        ...resolveStoryAuthFields({
          authMethod: {
            familyId: "github",
            methodId: "github-app-installation",
            variantId: "github-cloud",
          },
          connectionId,
        }),
        bindingCount: 0,
        canDelete: true,
        contextItems: [
          {
            label: "App ID",
            value: "3079908",
          },
          {
            label: "App slug",
            value: "mistle-github-app",
          },
          {
            label: "Installation",
            value: "116007157",
          },
        ],
        displayName: "New GitHub Connection",
        installActionLabel: "Manage installation",
        resources: [
          {
            count: 0,
            kind: "repositories",
            syncState: "never-synced",
          },
          {
            count: 0,
            kind: "branches",
            syncState: "never-synced",
          },
          {
            count: 0,
            kind: "users",
            syncState: "never-synced",
          },
        ],
        status: "active",
      },
    ],
    onRefreshResource: () => {},
    resourceItemsByKey: buildIntegrationConnectionResourceItemsByKey([
      {
        connectionId,
        state: {
          isLoading: false,
          items: [],
          kind: "repositories",
          errorMessage: null,
        },
      },
      {
        connectionId,
        state: {
          isLoading: false,
          items: [],
          kind: "branches",
          errorMessage: null,
        },
      },
      {
        connectionId,
        state: {
          isLoading: false,
          items: [],
          kind: "users",
          errorMessage: null,
        },
      },
    ]),
  };
}

type ScenarioDetailStorySpec = {
  authMethod?: StoryAuthMethodSpec;
  bindingCount?: number;
  connectionConfig?: Record<string, unknown>;
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
  setup?:
    | {
        description?: string;
        errorMessage?: string;
        isPending?: boolean;
        postInstallationSetupUrl?: string;
      }
    | undefined;
  webhookLifecycle?: "implicit" | "managed";
  status?: "active" | "error" | "revoked";
  webhookSources?: readonly IntegrationWebhookSource[];
};

function createResourceItems(
  input: ScenarioDetailStorySpec,
): IntegrationConnectionDetailViewProps["resourceItemsByKey"] {
  const resources = input.resources ?? [];
  const familyId = input.familyId ?? "integration";

  return buildIntegrationConnectionResourceItemsByKey(
    resources.map((resource) => ({
      connectionId: input.connectionId,
      state: {
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
        errorMessage: null,
      },
    })),
  );
}

function createWebhookSourceSectionState(
  input: ScenarioDetailStorySpec,
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

function createWebhookPolicy(input: ScenarioDetailStorySpec) {
  if (input.webhookSources === undefined) {
    return undefined;
  }

  return resolveIntegrationConnectionDetailWebhookPolicy({
    webhookSource:
      input.webhookLifecycle === undefined ? {} : { lifecycle: input.webhookLifecycle },
  });
}

function createScenarioDetailViewStoryProps(
  input: ScenarioDetailStorySpec,
): IntegrationConnectionDetailViewProps {
  const authMethod =
    input.authMethod === undefined
      ? undefined
      : resolveStoryAuthFields({
          authMethod: input.authMethod,
          ...(input.connectionConfig === undefined
            ? {}
            : { connectionConfig: input.connectionConfig }),
          connectionId: input.connectionId,
        });
  const resourceItemsByKey = createResourceItems(input);
  const webhookPolicy = createWebhookPolicy(input);
  const webhookSourceStateByConnectionId = createWebhookSourceSectionState(input);

  return {
    connections: [
      {
        bindingCount: input.bindingCount ?? 0,
        canDelete: input.bindingCount === undefined || input.bindingCount === 0,
        ...(authMethod === undefined ? {} : authMethod),
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
        ...(input.setup === undefined ? {} : { setup: input.setup }),
        status: input.status ?? "active",
      },
    ],
    onEditAuthentication: () => {},
    onRefreshResource: () => {},
    ...(resourceItemsByKey === undefined ? {} : { resourceItemsByKey }),
    ...(webhookSourceStateByConnectionId === undefined
      ? {}
      : {
          ...(webhookPolicy === undefined ? {} : { webhookPolicy }),
          webhookSourceStateByConnectionId,
        }),
  };
}

const DenseStoryLastSyncedAt = "2026-04-13T15:37:00.000Z";

export function createGitHubEnterpriseServerDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createScenarioDetailViewStoryProps({
    familyId: "github",
    authMethod: {
      familyId: "github",
      methodId: "github-app-installation",
      variantId: "github-enterprise-server",
    },
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

export function createJiraDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createScenarioDetailViewStoryProps({
    authMethod: {
      familyId: "jira",
      methodId: "jira-personal-api-token",
      variantId: "jira-default",
    },
    bindingCount: 1,
    connectionConfig: {
      connection_method: "jira-personal-api-token",
      email: "jon@example.com",
      site_url: "https://mistle.atlassian.net",
    },
    connectionId: "icn_jira_dense",
    displayName: "Jira (Webhook Configured)",
    webhookLifecycle: "managed",
    webhookSources: [
      {
        callbackUrl:
          "https://control-plane.example.com/p/integration/webhooks/jira-default/ep_jira_dense",
        createdAt: DenseStoryLastSyncedAt,
        displayName: "Webhook",
        endpointKey: "ep_jira_dense",
        id: "iws_jira_dense",
        integrationConnectionId: "icn_jira_dense",
        providerMetadata: {
          registeredEvents: [
            "jira:issue_created",
            "jira:issue_updated",
            "comment_created",
            "comment_updated",
          ],
        },
        remoteRegistrationId: "10001",
        status: "active",
        targetKey: "jira-default",
        updatedAt: DenseStoryLastSyncedAt,
      },
    ],
  });
}

export function createJiraWebhookNotConfiguredDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createScenarioDetailViewStoryProps({
    authMethod: {
      familyId: "jira",
      methodId: "jira-personal-api-token",
      variantId: "jira-default",
    },
    bindingCount: 1,
    connectionConfig: {
      connection_method: "jira-personal-api-token",
      email: "jon@example.com",
      site_url: "https://mistle.atlassian.net",
    },
    connectionId: "icn_jira_setup_incomplete",
    displayName: "Jira (Webhook Not Configured)",
    webhookLifecycle: "managed",
    webhookSources: [],
  });
}

export function createLinearDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createScenarioDetailViewStoryProps({
    authMethod: {
      familyId: "linear",
      methodId: "api-key",
      variantId: "linear-default",
    },
    connectionId: "icn_linear_dense",
    displayName: "Linear Workspace",
  });
}

export function createSlackDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  const storyProps = [
    {
      bindingCount: 2,
      connectionId: "icn_slack_engineering",
      displayName: "Slack Engineering",
      endpointKey: "ep_slack_engineering",
      resources: [
        {
          count: 3,
          items: ["#alerts", "#engineering", "#platform-help"],
          kind: "channel",
          lastSyncedAt: DenseStoryLastSyncedAt,
          syncState: "ready" as const,
        },
      ],
      webhookSourceId: "iws_slack_engineering",
    },
    {
      bindingCount: 1,
      connectionId: "icn_slack_support",
      displayName: "Slack Support",
      endpointKey: "ep_slack_support",
      resources: [
        {
          count: 2,
          items: ["#support-escalations", "#customer-incidents"],
          kind: "channel",
          lastSyncedAt: DenseStoryLastSyncedAt,
          syncState: "ready" as const,
        },
      ],
      webhookSourceId: "iws_slack_support",
    },
    {
      bindingCount: 3,
      connectionId: "icn_slack_growth",
      displayName: "Slack Growth",
      endpointKey: "ep_slack_growth",
      resources: [
        {
          count: 0,
          items: [],
          kind: "channel",
          lastErrorMessage: "Slack returned rate_limited while listing channels.",
          syncState: "error" as const,
        },
      ],
      webhookSourceId: "iws_slack_growth",
    },
    {
      bindingCount: 0,
      connectionId: "icn_slack_ops",
      displayName: "Slack Ops",
      endpointKey: "ep_slack_ops",
      resources: [
        {
          count: 0,
          items: [],
          kind: "channel",
          syncState: "never-synced" as const,
        },
      ],
      webhookSourceId: "iws_slack_ops",
    },
    {
      bindingCount: 1,
      connectionId: "icn_slack_design",
      displayName: "Slack Design",
      endpointKey: "ep_slack_design",
      resources: [
        {
          count: 1,
          items: ["#design-crit"],
          kind: "channel",
          syncState: "syncing" as const,
        },
      ],
      webhookSourceId: "iws_slack_design",
    },
  ].map((connection) =>
    createScenarioDetailViewStoryProps({
      authMethod: {
        familyId: "slack",
        methodId: "slack-bot-token",
        variantId: "slack-default",
      },
      bindingCount: connection.bindingCount,
      connectionId: connection.connectionId,
      displayName: connection.displayName,
      familyId: "slack",
      resources: connection.resources,
      webhookSources: [
        {
          callbackUrl: `https://control-plane.example.com/p/integration/webhooks/slack-default/${connection.endpointKey}`,
          createdAt: DenseStoryLastSyncedAt,
          displayName: "Slack Events API webhook",
          endpointKey: connection.endpointKey,
          id: connection.webhookSourceId,
          integrationConnectionId: connection.connectionId,
          providerMetadata: {},
          status: "active",
          targetKey: "slack-default",
          updatedAt: DenseStoryLastSyncedAt,
        },
      ],
    }),
  );

  return {
    connections: storyProps.flatMap((story) => story.connections),
    onRefreshResource: () => {},
    resourceItemsByKey: buildIntegrationConnectionResourceItemsByKey(
      storyProps.flatMap((story) =>
        Array.from(story.resourceItemsByKey?.entries() ?? []).map(([key, state]) => ({
          connectionId: key.slice(0, key.lastIndexOf(":")),
          state,
        })),
      ),
    ),
    webhookPolicy: resolveIntegrationConnectionDetailWebhookPolicy({
      webhookSource: { lifecycle: "implicit" },
    }),
    webhookSourceStateByConnectionId: new Map(
      storyProps.flatMap((story) =>
        Array.from(story.webhookSourceStateByConnectionId?.entries() ?? []),
      ),
    ),
  };
}

export function createOpenAiDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createScenarioDetailViewStoryProps({
    authMethod: {
      familyId: "openai",
      methodId: "api-key",
      variantId: "openai-default",
    },
    connectionId: "icn_openai_dense",
    displayName: "OpenAI Production",
  });
}

export function createAwsDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createScenarioDetailViewStoryProps({
    authMethod: {
      familyId: "aws",
      methodId: "aws-assume-role",
      variantId: "aws-cli-default",
    },
    connectionId: "icn_aws_dense",
    displayName: "AWS Engineering",
  });
}

export function createDatadogDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createScenarioDetailViewStoryProps({
    authMethod: {
      familyId: "datadog",
      methodId: "api-key",
      variantId: "datadog-default",
    },
    connectionId: "icn_datadog_dense",
    displayName: "Datadog Production",
  });
}

export function createPlanetScaleDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createScenarioDetailViewStoryProps({
    authMethod: {
      familyId: "planetscale",
      methodId: "oauth2-authorization-code",
      variantId: "planetscale-mcp",
    },
    connectionId: "icn_planetscale_dense",
    displayName: "PlanetScale Hosted MCP",
  });
}

export function createSigNozDetailViewStoryProps(): IntegrationConnectionDetailViewProps {
  return createScenarioDetailViewStoryProps({
    authMethod: {
      familyId: "signoz",
      methodId: "oauth2-authorization-code",
      variantId: "signoz-mcp",
    },
    connectionId: "icn_signoz_dense",
    displayName: "SigNoz Hosted MCP",
  });
}
