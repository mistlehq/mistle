// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import {
  GitHubCloudBrowserDefinition,
  SlackBrowserDefinition,
} from "@mistle/integrations-definitions/browser";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type JSX } from "react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { cleanupTestQueryClients, createTestQueryClient } from "../../test-support/query-client.js";
import { createStoryWebhookTriggerCapabilitiesProviderMetadata } from "../integrations/integration-story-harness.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileIntegrationDirectoryQueryKey,
  sandboxProfileVersionTriggerConfigQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionSetupScriptQueryKey,
  sandboxProfileVersionsQueryKey,
  sandboxProvidersQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type {
  SandboxProfileVersion,
  SandboxProfileVersionDraftTriggerImpactTrigger,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { organizationSandboxStorageSettingsQueryKey } from "../settings/organization/sandbox-storage-service.js";
import { triggersListQueryKey } from "../triggers/triggers-query-keys.js";
import type { TriggersListResult } from "../triggers/triggers-types.js";
import {
  WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY,
  WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX,
} from "../triggers/use-webhook-trigger-prerequisites.js";
import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";
import {
  applyCreatedSandboxProfileVersionDraftToVersions,
  applyDiscardedSandboxProfileVersionDraftToVersions,
  applyPublishedSandboxProfileVersionToProfile,
  applyPublishedSandboxProfileVersionToVersions,
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  resolveCronExpressionBreakdown,
  resolveSandboxProfileEditorVersionMode,
  resolveSandboxProfileSetupScriptIntegrationRows,
  resolveSetupAssistantStartDialogVariant,
  resolveSnapshotRefreshScheduleBehaviorDescription,
  shouldPollSandboxProfileSnapshotJobs,
  shouldRedirectDraftSandboxProfileViewToPublished,
} from "./sandbox-profile-editor-page-model.js";
import {
  SandboxProfileDefaultRedirect,
  SetupAssistantCloseDialog,
  SetupAssistantStartDialog,
  SetupAssistantStartupProgress,
  SandboxProfileEditorPage,
  SandboxProfileEditorShell,
  SandboxProfileEditorView,
  SandboxProfileSetupScriptPanel,
  resolveSelectedSandboxProfileAgentRuntimeId,
} from "./sandbox-profile-editor-page.js";

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserver {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    },
    writable: true,
  });
});

function expectElementToFollow(previous: Element, next: Element): void {
  expect(previous.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
}

afterEach(() => {
  cleanup();
  void cleanupTestQueryClients();
});

function createSandboxProfileVersionFixture(input: {
  sandboxProfileId: string;
  version: number;
  state: SandboxProfileVersion["state"];
  agentRuntimeId?: SandboxProfileVersion["agentRuntimeId"];
  defaultPersistenceMode?: SandboxProfileVersion["defaultPersistenceMode"];
  maintenanceScript?: string | null;
  isActive: boolean;
  usable?: boolean;
  latestSnapshotJob?: SandboxProfileVersion["latestSnapshotJob"];
  refreshSchedule?: SandboxProfileVersion["refreshSchedule"];
}): SandboxProfileVersion {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    state: input.state,
    agentRuntimeId: input.agentRuntimeId ?? "codex",
    gitCommitSigningIntegrationConnectionId: null,
    mistleMcpEnabled: false,
    mistleMcpApiKeyId: null,
    defaultPersistenceMode: input.defaultPersistenceMode ?? "ephemeral",
    sandboxConnectionId: null,
    sandboxProvider: "docker",
    sandboxResources: null,
    maintenanceScript: input.maintenanceScript ?? null,
    isActive: input.isActive,
    usable: input.usable ?? input.state === "published",
    latestSnapshotJob: input.latestSnapshotJob ?? null,
    refreshSchedule: input.refreshSchedule ?? null,
  };
}

type SandboxProfileEditorTestVersionState =
  | "draft"
  | "draft-with-published"
  | "published"
  | "published-with-draft"
  | "published-pending-with-draft"
  | "published-pending-with-older-active"
  | "published-manual-refresh-no-snapshot"
  | "published-no-snapshot"
  | "published-pending"
  | "published-manual-refresh-failed-no-snapshot"
  | "published-failed-with-older-active"
  | "published-failed";

type SandboxProfileEditorTestRouteView = "published" | "draft" | "default";
type SandboxProfileEditorTestRouteSection = "sandbox-profile" | "triggers" | "snapshot" | null;

const SlackTriggerConnectionId = "icn_slack_test";
const SlackTriggerWebhookSourceId = "iws_slack_test";
const GitHubTriggerConnectionId = "icn_github_test";
const GitHubTriggerWebhookSourceId = "iws_github_test";

function createSlackTriggerConnection(input: { id?: string } = {}): IntegrationConnection {
  return {
    id: input.id ?? SlackTriggerConnectionId,
    targetKey: "slack-default",
    displayName: "Slack Engineering",
    status: "active",
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  };
}

function createSlackTriggerTarget(): IntegrationTarget {
  return {
    targetKey: "slack-default",
    familyId: SlackBrowserDefinition.familyId,
    variantId: SlackBrowserDefinition.variantId,
    kind: SlackBrowserDefinition.kind,
    enabled: true,
    config: {},
    displayName: SlackBrowserDefinition.displayName,
    description: "Slack workspace",
    ...(SlackBrowserDefinition.logoKey === undefined
      ? {}
      : { logoKey: SlackBrowserDefinition.logoKey }),
    supportedWebhookEvents: [
      {
        eventType: "slack:app_mention",
        providerEventType: "app_mention",
        displayName: "App mention",
        requirements: {
          anyOf: [
            {
              event: "app_mention",
              permissions: [{ permission: "app_mentions:read" }],
            },
          ],
        },
      },
    ],
    targetHealth: {
      configStatus: "valid",
    },
  };
}

function createSlackTriggerWebhookSource(): IntegrationWebhookSource {
  return {
    id: SlackTriggerWebhookSourceId,
    targetKey: "slack-default",
    integrationConnectionId: SlackTriggerConnectionId,
    displayName: "Slack Events API webhook",
    endpointKey: "ep_slack_test",
    status: "active",
    providerMetadata: createStoryWebhookTriggerCapabilitiesProviderMetadata({
      definition: SlackBrowserDefinition,
      events: ["app_mention"],
      permissions: [{ permission: "app_mentions:read" }],
    }),
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  };
}

function createGitHubTriggerConnection(input: { id?: string } = {}): IntegrationConnection {
  return {
    id: input.id ?? GitHubTriggerConnectionId,
    targetKey: "github-cloud",
    displayName: "GitHub",
    status: "active",
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  };
}

function createGitHubTriggerTarget(): IntegrationTarget {
  return {
    targetKey: "github-cloud",
    familyId: GitHubCloudBrowserDefinition.familyId,
    variantId: GitHubCloudBrowserDefinition.variantId,
    kind: GitHubCloudBrowserDefinition.kind,
    enabled: true,
    config: {},
    displayName: GitHubCloudBrowserDefinition.displayName,
    description: "GitHub repositories",
    ...(GitHubCloudBrowserDefinition.logoKey === undefined
      ? {}
      : { logoKey: GitHubCloudBrowserDefinition.logoKey }),
    supportedWebhookEvents: [
      {
        eventType: "github.pull_request.opened",
        providerEventType: "pull_request",
        displayName: "Pull request opened",
        requirements: {
          anyOf: [
            {
              event: "pull_request",
              permissions: [{ permission: "pull_requests", access: "read" }],
            },
          ],
        },
      },
      {
        eventType: "github.issue_comment.created",
        providerEventType: "issue_comment",
        displayName: "Issue comment created",
        requirements: {
          anyOf: [
            {
              event: "issue_comment",
              permissions: [{ permission: "issues", access: "read" }],
            },
          ],
        },
      },
    ],
    targetHealth: {
      configStatus: "valid",
    },
  };
}

function createGitHubTriggerWebhookSource(
  input: {
    id?: string;
    connectionId?: string;
    events?: readonly ("pull_request" | "issue_comment")[];
    permissions?: readonly { permission: string; access: string }[];
  } = {},
): IntegrationWebhookSource {
  return {
    id: input.id ?? GitHubTriggerWebhookSourceId,
    targetKey: "github-cloud",
    integrationConnectionId: input.connectionId ?? GitHubTriggerConnectionId,
    displayName: "GitHub webhook",
    endpointKey: "ep_github_test",
    status: "active",
    providerMetadata: createStoryWebhookTriggerCapabilitiesProviderMetadata({
      definition: GitHubCloudBrowserDefinition,
      events: input.events ?? ["pull_request", "issue_comment"],
      permissions: input.permissions ?? [
        { permission: "pull_requests", access: "read" },
        { permission: "issues", access: "read" },
      ],
    }),
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  };
}

function createRunningSnapshotJobFixture(input: {
  id: string;
  trigger: "publish" | "manual_refresh";
}): NonNullable<SandboxProfileVersion["latestSnapshotJob"]> {
  return {
    id: input.id,
    sandboxInstanceId: `sbi_${input.id}`,
    trigger: input.trigger,
    state: "running",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-04-23T00:01:00.000Z",
    startedAt: "2026-04-23T00:01:05.000Z",
    finishedAt: null,
  };
}

function createFailedSnapshotJobFixture(): NonNullable<SandboxProfileVersion["latestSnapshotJob"]> {
  return {
    id: "ssj_failed_initial_materialization",
    sandboxInstanceId: "sbi_failed_initial_materialization",
    trigger: "publish",
    state: "failed",
    errorCode: "snapshot_materialization_failed",
    errorMessage: "Snapshot materialization failed.",
    createdAt: "2026-04-23T00:01:00.000Z",
    startedAt: "2026-04-23T00:01:05.000Z",
    finishedAt: "2026-04-23T00:01:30.000Z",
  };
}

function createFailedManualSnapshotJobFixture(): NonNullable<
  SandboxProfileVersion["latestSnapshotJob"]
> {
  return {
    id: "ssj_failed_manual_materialization",
    sandboxInstanceId: "sbi_failed_manual_materialization",
    trigger: "manual_refresh",
    state: "failed",
    errorCode: "snapshot_materialization_failed",
    errorMessage: "Snapshot materialization failed.",
    createdAt: "2026-04-23T00:01:00.000Z",
    startedAt: "2026-04-23T00:01:05.000Z",
    finishedAt: "2026-04-23T00:01:30.000Z",
  };
}

function createSandboxProfileVersionsForTest(input: {
  profileId: string;
  defaultPersistenceMode?: SandboxProfileVersion["defaultPersistenceMode"];
  maintenanceScript?: string | null;
  refreshSchedule?: SandboxProfileVersion["refreshSchedule"];
  version: number;
  versionState: SandboxProfileEditorTestVersionState;
}): SandboxProfileVersion[] {
  function createVersion(versionInput: {
    state: SandboxProfileVersion["state"];
    isActive?: boolean;
    latestSnapshotJob?: SandboxProfileVersion["latestSnapshotJob"];
    usable?: boolean;
    version?: number;
  }): SandboxProfileVersion {
    const versionFixture = createSandboxProfileVersionFixture({
      sandboxProfileId: input.profileId,
      version: versionInput.version ?? input.version,
      state: versionInput.state,
      maintenanceScript: input.maintenanceScript ?? null,
      ...(input.defaultPersistenceMode === undefined
        ? {}
        : { defaultPersistenceMode: input.defaultPersistenceMode }),
      isActive: versionInput.isActive ?? false,
    });

    return {
      ...versionFixture,
      ...(versionInput.latestSnapshotJob === undefined
        ? {}
        : { latestSnapshotJob: versionInput.latestSnapshotJob }),
      ...(versionInput.state !== "published" || input.refreshSchedule === undefined
        ? {}
        : { refreshSchedule: input.refreshSchedule }),
      ...(versionInput.usable === undefined ? {} : { usable: versionInput.usable }),
    };
  }

  switch (input.versionState) {
    case "draft-with-published":
      return [
        createVersion({
          version: input.version - 1,
          state: "published",
          isActive: true,
        }),
        createVersion({
          state: "draft",
        }),
      ];
    case "published-with-draft":
      return [
        createVersion({
          state: "published",
          isActive: true,
        }),
        createVersion({
          version: input.version + 1,
          state: "draft",
        }),
      ];
    case "published-pending-with-draft":
      return [
        createVersion({
          state: "published",
          usable: false,
          latestSnapshotJob: createRunningSnapshotJobFixture({
            id: "ssj_pending_initial_materialization",
            trigger: "publish",
          }),
        }),
        createVersion({
          version: input.version + 1,
          state: "draft",
        }),
      ];
    case "published-pending-with-older-active":
      return [
        createVersion({
          version: input.version - 1,
          state: "published",
          isActive: true,
        }),
        createVersion({
          state: "published",
          usable: false,
          latestSnapshotJob: createRunningSnapshotJobFixture({
            id: "ssj_pending_new_publish",
            trigger: "publish",
          }),
        }),
      ];
    case "published-failed-with-older-active":
      return [
        createVersion({
          version: input.version - 1,
          state: "published",
          isActive: true,
        }),
        createVersion({
          state: "published",
          usable: false,
          latestSnapshotJob: createFailedSnapshotJobFixture(),
        }),
      ];
    case "published-manual-refresh-no-snapshot":
      return [
        createVersion({
          state: "published",
          usable: false,
          latestSnapshotJob: createRunningSnapshotJobFixture({
            id: "ssj_manual_refresh_initial_materialization",
            trigger: "manual_refresh",
          }),
        }),
      ];
    case "published-no-snapshot":
      return [
        createVersion({
          state: "published",
          usable: false,
        }),
      ];
    case "published-pending":
      return [
        createVersion({
          state: "published",
          usable: false,
          latestSnapshotJob: createRunningSnapshotJobFixture({
            id: "ssj_pending_initial_materialization",
            trigger: "publish",
          }),
        }),
      ];
    case "published-failed":
      return [
        createVersion({
          state: "published",
          usable: false,
          latestSnapshotJob: createFailedSnapshotJobFixture(),
        }),
      ];
    case "published-manual-refresh-failed-no-snapshot":
      return [
        createVersion({
          state: "published",
          usable: false,
          latestSnapshotJob: createFailedManualSnapshotJobFixture(),
        }),
      ];
    case "published":
      return [
        createVersion({
          state: "published",
          isActive: true,
        }),
      ];
    case "draft":
      return [
        createVersion({
          state: "draft",
        }),
      ];
  }
}

function resolveSandboxProfileEditorTestRouteView(input: {
  versionState: SandboxProfileEditorTestVersionState;
  view: SandboxProfileEditorTestRouteView | undefined;
}): SandboxProfileEditorTestRouteView {
  if (input.view !== undefined) {
    return input.view;
  }

  switch (input.versionState) {
    case "published":
    case "published-with-draft":
    case "draft-with-published":
    case "published-pending-with-draft":
    case "published-pending-with-older-active":
    case "published-failed-with-older-active":
    case "published-manual-refresh-no-snapshot":
    case "published-no-snapshot":
    case "published-pending":
    case "published-manual-refresh-failed-no-snapshot":
    case "published-failed":
      return "published";
    case "draft":
      return "draft";
  }
}

function renderSandboxProfileEditor(input?: {
  bindings?: readonly {
    id: string;
    connectionId: string;
    kind: "agent" | "git" | "connector";
    config: Record<string, unknown>;
  }[];
  connections?: readonly {
    id: string;
    displayName: string;
    targetKey: string;
    status: "active" | "error" | "revoked";
    config?: Record<string, unknown>;
  }[];
  triggerConnections?: readonly IntegrationConnection[];
  triggerTargets?: readonly IntegrationTarget[];
  triggerWebhookSources?: readonly IntegrationWebhookSource[];
  setupScript?: string | null;
  setupScriptsByVersion?: Record<number, string | null>;
  targets?: readonly {
    targetKey: string;
    displayName: string;
    familyId: string;
    variantId: string;
    config: Record<string, unknown>;
    targetHealth: {
      configStatus: "valid" | "invalid";
    };
  }[];
  integrationBindingsError?: string;
  integrationsLoading?: boolean;
  sandboxProvidersLoading?: boolean;
  defaultPersistenceMode?: SandboxProfileVersion["defaultPersistenceMode"];
  persistentSandboxesEnabled?: boolean;
  maintenanceScript?: string | null;
  profileTriggersListResult?: TriggersListResult;
  routeSearch?: string;
  routeState?: unknown;
  routeSection?: SandboxProfileEditorTestRouteSection;
  view?: SandboxProfileEditorTestRouteView;
  versionState?: SandboxProfileEditorTestVersionState;
  refreshSchedule?: SandboxProfileVersion["refreshSchedule"];
}) {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const profileId = "sbp_test";
  const version = 3;

  const activeVersion =
    input?.versionState === "published" || input?.versionState === "published-with-draft"
      ? version
      : input?.versionState === "published-pending-with-older-active" ||
          input?.versionState === "published-failed-with-older-active"
        ? version - 1
        : input?.versionState === "draft-with-published"
          ? version - 1
          : null;
  const resolvedVersionState = input?.versionState ?? "draft";
  const resolvedRouteView = resolveSandboxProfileEditorTestRouteView({
    versionState: resolvedVersionState,
    view: input?.view,
  });
  const versions = createSandboxProfileVersionsForTest({
    profileId,
    ...(input?.defaultPersistenceMode === undefined
      ? {}
      : { defaultPersistenceMode: input.defaultPersistenceMode }),
    ...(input?.refreshSchedule === undefined ? {} : { refreshSchedule: input.refreshSchedule }),
    ...(input?.maintenanceScript === undefined
      ? {}
      : { maintenanceScript: input.maintenanceScript }),
    version,
    versionState: resolvedVersionState,
  });

  seedAuthenticatedSession(queryClient);
  queryClient.setQueryData(organizationSandboxStorageSettingsQueryKey("org_123"), {
    persistentSandboxesEnabled: input?.persistentSandboxesEnabled ?? true,
    storageBackend: null,
    storageConfigSource: "managed",
    storageConfigVersion: null,
    organizationStorageConfigSummary: null,
  });
  if (input?.sandboxProvidersLoading === true) {
    const sandboxProvidersQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: sandboxProvidersQueryKey(),
      queryFn: async () => ({
        items: [],
      }),
    });

    sandboxProvidersQuery.setState({
      ...sandboxProvidersQuery.state,
      data: undefined,
      fetchStatus: "fetching",
      status: "pending",
    });
  } else {
    queryClient.setQueryData(sandboxProvidersQueryKey(), {
      items: [
        {
          id: "docker",
          displayName: "Docker",
          managed: true,
          supportsOrganizationConnection: false,
          resourceCapabilities: null,
        },
        {
          id: "e2b",
          displayName: "E2B",
          managed: true,
          supportsOrganizationConnection: true,
          resourceCapabilities: {
            vcpuCount: {
              min: 1,
              max: 8,
              step: 1,
              default: 2,
            },
            memoryMb: {
              min: 1024,
              max: 16_384,
              step: 1024,
              default: 4096,
            },
          },
        },
      ],
    });
  }
  queryClient.setQueryData(sandboxProfileDetailQueryKey(profileId), {
    id: profileId,
    displayName: "Prototype Profile",
    activeVersion,
    status: "active",
    latestVersion: version,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  });
  const triggerRouteSearchParams = new URLSearchParams(input?.routeSearch ?? "");
  const triggerAfter = triggerRouteSearchParams.get("after");
  const triggerBefore = triggerAfter === null ? triggerRouteSearchParams.get("before") : null;
  queryClient.setQueryData(
    triggersListQueryKey({
      limit: 25,
      after: triggerAfter,
      before: triggerBefore,
      sandboxProfileId: profileId,
    }),
    input?.profileTriggersListResult ?? {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    },
  );
  if (input?.integrationBindingsError !== undefined) {
    queryClient.setQueryData(sandboxProfileVersionsQueryKey(profileId), {
      versions,
    });
    queryClient.getQueryCache().build(queryClient, {
      queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
        profileId,
        version,
      }),
      queryFn: async () => {
        throw new Error(input.integrationBindingsError);
      },
    });
  } else if (input?.integrationsLoading === true) {
    queryClient.setQueryData(sandboxProfileVersionsQueryKey(profileId), {
      versions,
    });
    const bindingsQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
        profileId,
        version,
      }),
      queryFn: async () => ({
        bindings: [],
      }),
    });

    bindingsQuery.setState({
      ...bindingsQuery.state,
      data: undefined,
      fetchStatus: "fetching",
      status: "pending",
    });
  } else {
    queryClient.setQueryData(sandboxProfileVersionsQueryKey(profileId), {
      versions,
    });
    queryClient.setQueryData(
      sandboxProfileVersionIntegrationBindingsQueryKey({
        profileId,
        version,
      }),
      {
        bindings: input?.bindings ?? [],
      },
    );
  }
  queryClient.setQueryData(sandboxProfileIntegrationDirectoryQueryKey(), {
    connections: input?.connections ?? [],
    targets: input?.targets ?? [],
  });
  queryClient.setQueryData(
    sandboxProfileVersionTriggerConfigQueryKey({
      profileId,
      version,
    }),
    {
      bindings: input?.bindings ?? [],
      repositoryOptions: [],
    },
  );
  queryClient.setQueryData(WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY, {
    connections: input?.triggerConnections ?? [],
    targets: input?.triggerTargets ?? [],
  });
  for (const connection of input?.triggerConnections ?? []) {
    queryClient.setQueryData(
      [...WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX, connection.id],
      (input?.triggerWebhookSources ?? []).filter(
        (source) => source.integrationConnectionId === connection.id,
      ),
    );
  }
  for (const versionFixture of versions) {
    const versionSetupScript = input?.setupScriptsByVersion?.[versionFixture.version];
    queryClient.setQueryData(
      sandboxProfileVersionSetupScriptQueryKey({
        profileId,
        version: versionFixture.version,
      }),
      {
        sandboxProfileId: profileId,
        version: versionFixture.version,
        setupScript:
          versionSetupScript === undefined
            ? input?.setupScript === undefined
              ? "pnpm install\npnpm dev:bootstrap"
              : input.setupScript
            : versionSetupScript,
      },
    );
  }
  const resolvedRouteSection =
    input?.routeSection === undefined ? "sandbox-profile" : input.routeSection;
  const sectionPath =
    resolvedRouteSection === null
      ? ""
      : resolvedRouteSection === "snapshot"
        ? "/snapshots"
        : resolvedRouteSection === "triggers"
          ? "/triggers"
          : resolvedRouteView === "default"
            ? "/sandbox-profile"
            : `/sandbox-profile/${resolvedRouteView}`;
  const initialPath =
    resolvedRouteView === "default"
      ? `/sandbox-profiles/${profileId}`
      : `/sandbox-profiles/${profileId}${sectionPath}`;
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Outlet />} path="/">
        <Route element={<div>Outside page</div>} path="outside" />
        <Route element={<SandboxProfileEditorShell />} path="sandbox-profiles/:profileId">
          <Route element={<SandboxProfileDefaultRedirect />} index />
          <Route element={<SandboxProfileEditorPage mode="edit" />}>
            <Route path="sandbox-profile">
              <Route element={<Outlet />} index />
              <Route element={<Outlet />} path="published" />
              <Route element={<Outlet />} path="draft" />
            </Route>
            <Route element={<Outlet />} path="triggers">
              <Route element={<Outlet />} index />
              <Route element={<Outlet />} path=":triggerId" />
            </Route>
            <Route element={<Outlet />} path="snapshots" />
          </Route>
        </Route>
      </Route>,
    ),
    {
      initialEntries: [
        {
          pathname: initialPath,
          search: input?.routeSearch ?? "",
          state: input?.routeState,
        },
      ],
    },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {
    profileId,
    queryClient,
    router,
  };
}

function getAutomaticSnapshotRefreshSection(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Automatic snapshot refresh" });
  const section = heading.closest("section");
  if (section === null) {
    throw new Error("Automatic snapshot refresh section not found.");
  }
  return section;
}

function DeleteProfileDialogHarness(input: {
  triggerUsages?: readonly {
    id: string;
    name: string;
  }[];
  triggerUsagesError?: string | null;
  triggerUsagesIsPending?: boolean;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <SandboxProfileEditorView
      activeSectionId="sandbox-profile"
      deleteProfileTriggerUsages={input.triggerUsages ?? []}
      deleteProfileTriggerUsagesError={input.triggerUsagesError ?? null}
      deleteProfileTriggerUsagesIsPending={input.triggerUsagesIsPending ?? false}
      deleteProfileError={null}
      deleteProfileIsPending={false}
      draftTriggerImpactAffectedTriggers={null}
      draftTriggerImpactError={null}
      onDraftTriggerImpactErrorDismiss={() => {}}
      hasUnpersistedIntegrationChanges={false}
      isDeleteProfileDialogOpen={isOpen}
      mode={{
        kind: "active",
        version: 1,
        activeVersion: 1,
        hasDraft: false,
        draftVersion: null,
      }}
      onConfirmDeleteProfile={() => {}}
      onDeleteProfileDialogOpenChange={setIsOpen}
      onDiscardChangesAndLeaveDraft={() => {}}
      onMakeChanges={() => {}}
      onPublish={() => {}}
      onSaveDraft={() => {}}
      onActiveSectionIdChange={() => {}}
      onSaveProfileName={async () => {}}
      onViewActive={() => {}}
      onViewDraft={() => {}}
      profileName="Production profile"
      profileNameFallback="Production profile"
      renderSectionPanel={() => <div>Section panel</div>}
      sections={[
        {
          id: "sandbox-profile",
          label: "Sandbox Profile",
        },
      ]}
      versionActionError={null}
      versionActionIsPending={false}
    />
  );
}

function DraftActionsHarness(input: {
  draftTriggerImpactAffectedTriggers?:
    | readonly SandboxProfileVersionDraftTriggerImpactTrigger[]
    | null;
  draftTriggerImpactError?: string | null;
  hasUnpersistedIntegrationChanges?: boolean;
  draftSaveError?: string | null;
}): JSX.Element {
  const [discarded, setDiscarded] = useState(false);
  const [draftTriggerImpactError, setDraftTriggerImpactError] = useState(
    input.draftTriggerImpactError ?? null,
  );

  return (
    <SandboxProfileEditorView
      activeSectionId="sandbox-profile"
      deleteProfileTriggerUsages={[]}
      deleteProfileTriggerUsagesError={null}
      deleteProfileTriggerUsagesIsPending={false}
      deleteProfileError={null}
      deleteProfileIsPending={false}
      draftSaveError={input.draftSaveError ?? null}
      draftTriggerImpactAffectedTriggers={input.draftTriggerImpactAffectedTriggers ?? null}
      draftTriggerImpactError={draftTriggerImpactError}
      onDraftTriggerImpactErrorDismiss={() => {
        setDraftTriggerImpactError(null);
      }}
      hasUnpersistedIntegrationChanges={input.hasUnpersistedIntegrationChanges ?? false}
      isDeleteProfileDialogOpen={false}
      mode={{
        kind: "draft",
        version: 2,
        activeVersion: 1,
        hasDraft: true,
      }}
      onConfirmDeleteProfile={() => {}}
      onDeleteProfileDialogOpenChange={() => {}}
      onDiscardChangesAndLeaveDraft={() => {
        setDiscarded(true);
      }}
      onMakeChanges={() => {}}
      onPublish={() => {}}
      onSaveDraft={() => {}}
      onActiveSectionIdChange={() => {}}
      onSaveProfileName={async () => {}}
      onViewActive={() => {}}
      onViewDraft={() => {}}
      profileName="Draft profile"
      profileNameFallback="Draft profile"
      renderSectionPanel={() => <div>{discarded ? "Discarded" : "Not discarded"}</div>}
      sections={[
        {
          id: "sandbox-profile",
          label: "Sandbox Profile",
        },
      ]}
      versionActionError={null}
      versionActionIsPending={false}
    />
  );
}

function renderDeleteProfileDialogHarness(input: {
  triggerUsages?: readonly {
    id: string;
    name: string;
  }[];
  triggerUsagesError?: string | null;
  triggerUsagesIsPending?: boolean;
}): void {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<DeleteProfileDialogHarness {...input} />} path="/" />,
    ),
  );

  render(<RouterProvider router={router} />);
}

function renderDraftActionsHarness(input?: {
  draftTriggerImpactAffectedTriggers?:
    | readonly SandboxProfileVersionDraftTriggerImpactTrigger[]
    | null;
  draftTriggerImpactError?: string | null;
  hasUnpersistedIntegrationChanges?: boolean;
  draftSaveError?: string | null;
}): void {
  const router = createMemoryRouter(
    createRoutesFromElements(<Route element={<DraftActionsHarness {...input} />} path="/" />),
  );

  render(<RouterProvider router={router} />);
}

function updateSetupScriptEditor(input: { editor: HTMLElement; value: string }): void {
  const editorView = getSetupScriptEditorView(input.editor);
  act(() => {
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: input.value,
      },
    });
  });
}

function readSetupScriptEditorValue(editor: HTMLElement): string {
  return getSetupScriptEditorView(editor).state.doc.toString();
}

function getSetupScriptEditorView(editor: HTMLElement): EditorView {
  const editorElement = editor.closest(".cm-editor");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("CodeMirror editor element was not found.");
  }

  const editorView = EditorView.findFromDOM(editorElement);
  if (editorView === null) {
    throw new Error("CodeMirror editor view was not found.");
  }

  return editorView;
}

describe("SandboxProfileEditorPage", () => {
  it("shows setup script test output before the setup script input", () => {
    render(
      <SandboxProfileSetupScriptPanel
        testPanel={<section aria-label="Setup script test output">Running setup script</section>}
        value="pnpm install"
      />,
    );

    const testOutput = screen.getByRole("region", {
      name: "Setup script test output",
    });
    const editor = screen.getByRole("textbox", {
      name: "Setup script",
    });

    expect(testOutput.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
  });

  it("resolves the active version for the published route when draft and published versions both exist", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: 1,
      view: "published",
      versions: [
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "published",
          isActive: true,
        }),
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 2,
          state: "draft",
          isActive: false,
        }),
      ],
    });

    expect(result).toEqual({
      ok: true,
      mode: {
        kind: "active",
        version: 1,
        activeVersion: 1,
        hasDraft: true,
        draftVersion: 2,
      },
    });
  });

  it("resolves the draft version for the draft route when the profile has not been published yet", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: null,
      view: "draft",
      versions: [
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "draft",
          isActive: false,
        }),
      ],
    });

    expect(result).toEqual({
      ok: true,
      mode: {
        kind: "draft",
        version: 1,
        activeVersion: null,
        hasDraft: true,
      },
    });
  });

  it("ignores stale runtime draft state from a different profile version", () => {
    const currentVersion = createSandboxProfileVersionFixture({
      sandboxProfileId: "sbp_current",
      version: 2,
      state: "draft",
      agentRuntimeId: "opencode",
      isActive: false,
    });

    expect(
      resolveSelectedSandboxProfileAgentRuntimeId({
        currentVersion,
        runtimeDraftState: {
          agentRuntimeId: "codex",
          sourceVersionKey: "sbp_previous:1",
        },
      }),
    ).toBe("opencode");
  });

  it("uses matching runtime draft state for unsaved agent runtime edits", () => {
    const currentVersion = createSandboxProfileVersionFixture({
      sandboxProfileId: "sbp_current",
      version: 2,
      state: "draft",
      agentRuntimeId: "opencode",
      isActive: false,
    });

    expect(
      resolveSelectedSandboxProfileAgentRuntimeId({
        currentVersion,
        runtimeDraftState: {
          agentRuntimeId: "codex",
          sourceVersionKey: "sbp_current:2",
        },
      }),
    ).toBe("codex");
  });

  it("returns an explicit unavailable state when the published resolver has no published version", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: null,
      view: "published",
      versions: [
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "draft",
          isActive: false,
        }),
      ],
    });

    expect(result).toEqual({
      ok: false,
      message: "Sandbox profile published version could not be loaded.",
    });
  });

  it("resolves the latest published version when initial snapshot materialization is still pending", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: null,
      view: "published",
      versions: [
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "published",
          isActive: false,
          usable: false,
          latestSnapshotJob: {
            id: "ssj_pending_initial_materialization",
            sandboxInstanceId: "sbi_pending_initial_materialization",
            trigger: "publish",
            state: "running",
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-04-23T00:01:00.000Z",
            startedAt: "2026-04-23T00:01:05.000Z",
            finishedAt: null,
          },
        }),
      ],
    });

    expect(result).toEqual({
      ok: true,
      mode: {
        kind: "active",
        version: 1,
        activeVersion: null,
        hasDraft: false,
        draftVersion: null,
      },
    });
  });

  it("resolves the latest published version when an older active version still exists", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: 1,
      view: "published",
      versions: [
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "published",
          isActive: true,
        }),
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 2,
          state: "published",
          isActive: false,
          usable: false,
          latestSnapshotJob: createRunningSnapshotJobFixture({
            id: "ssj_pending_new_publish",
            trigger: "publish",
          }),
        }),
      ],
    });

    expect(result).toEqual({
      ok: true,
      mode: {
        kind: "active",
        version: 2,
        activeVersion: 1,
        hasDraft: false,
        draftVersion: null,
      },
    });
  });

  it("can resolve the published version while a draft exists", () => {
    const result = resolveSandboxProfileEditorVersionMode({
      activeVersion: 1,
      view: "published",
      versions: [
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "published",
          isActive: true,
        }),
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 2,
          state: "draft",
          isActive: false,
        }),
      ],
    });

    expect(result).toEqual({
      ok: true,
      mode: {
        kind: "active",
        version: 1,
        activeVersion: 1,
        hasDraft: true,
        draftVersion: 2,
      },
    });
  });

  it("renders sandbox profile, triggers, and snapshots tabs", () => {
    renderSandboxProfileEditor();

    expect(screen.getByRole("tab", { name: "Sandbox Profile" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Triggers" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Snapshots" })).toBeDefined();
    expect(screen.getByLabelText("Profile sections").className).toContain("max-w-5xl");
    expect(screen.getByLabelText("Profile sections").parentElement?.className).toContain("px-4");
    const sandboxProfileTabPanel = screen.getByRole("tabpanel", { name: "Sandbox Profile" });
    const tabPanelRegion = sandboxProfileTabPanel.parentElement;
    expect(tabPanelRegion?.className).toContain("bg-muted/30");
    expect(sandboxProfileTabPanel.className).not.toContain("bg-muted/30");
    expect(sandboxProfileTabPanel.className).toContain("flex-1");
    const snapshotsPanelId = screen
      .getByRole("tab", { name: "Snapshots" })
      .getAttribute("aria-controls");
    if (snapshotsPanelId === null) {
      throw new Error("Expected the Snapshots tab to control a tabpanel.");
    }
    expect(document.getElementById(snapshotsPanelId)?.parentElement).toBe(tabPanelRegion);
    expect(screen.queryByRole("heading", { name: "Integrations" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Resources & Tools" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Configurations" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Setup script" })).toBeDefined();
  });

  it("shows snapshot creation feedback while initial materialization is running", () => {
    renderSandboxProfileEditor({
      versionState: "published-pending",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByText("Sandbox Profile v3's snapshot is being created")).toBeDefined();
    expect(
      screen.getByText(
        "New sessions and triggers will be available after snapshot creation succeeds.",
      ),
    ).toBeDefined();
    const detailsToggle = screen.getByRole("button", { name: "Creating snapshot" });
    expect(detailsToggle).toBeDefined();
    expect(detailsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("status", { name: "Creating snapshot" })).toBeDefined();
    expect(screen.getByText("No lifecycle events yet.")).toBeDefined();
    expect(screen.getByText("Terminal output")).toBeDefined();
    expect(screen.getByText("No output yet.")).toBeDefined();
    fireEvent.click(detailsToggle);
    expect(detailsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("No lifecycle events yet.")).toBeNull();
    expect(screen.queryByText("Terminal output")).toBeNull();
  });

  it("shows the interim runnable snapshot while a newer published snapshot is being created", () => {
    renderSandboxProfileEditor({
      versionState: "published-pending-with-older-active",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByText("Sandbox Profile v3's snapshot is being created")).toBeDefined();
    expect(
      screen.getByText("Interim, v2's snapshot will be used for new sessions and triggers."),
    ).toBeDefined();
  });

  it("shows creating while the first snapshot is materializing from a manual job", () => {
    renderSandboxProfileEditor({
      versionState: "published-manual-refresh-no-snapshot",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByRole("button", { name: "Creating snapshot" })).toBeDefined();
    expect(screen.queryByText("Refreshing")).toBeNull();
  });

  it("shows publish snapshot recovery details when initial materialization fails", () => {
    renderSandboxProfileEditor({
      versionState: "published-failed-with-older-active",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByText("Snapshot creation failed")).toBeDefined();
    expect(
      screen.getByText(
        "Version 3 was published, but its snapshot could not be created. New sessions and triggers will continue using v2 until the snapshot is retried successfully.",
      ),
    ).toBeDefined();
    expect(screen.queryByText("Snapshot materialization failed.")).toBeNull();
    expect(screen.getByText("Sandbox Profile v3's snapshot is unavailable")).toBeDefined();
    expect(
      screen.getByText("v2's snapshot will be used for new sessions and triggers."),
    ).toBeDefined();
    const detailsToggle = screen.getByRole("button", { name: "Snapshot creation details" });
    expect(detailsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("No lifecycle events yet.")).toBeDefined();
    expect(screen.getByText("Terminal output")).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry snapshot creation" })).toBeDefined();
  });

  it("asks users to retry snapshot creation when a published version has no snapshot", () => {
    renderSandboxProfileEditor({
      versionState: "published-no-snapshot",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByText("Sandbox Profile v3's snapshot is unavailable")).toBeDefined();
    expect(
      screen.getByText("Sessions and triggers are blocked until snapshot creation succeeds."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry snapshot creation" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Create snapshot" })).toBeNull();
  });

  it("keeps retry available when the latest failed job is a manual refresh and the version has no snapshot", () => {
    renderSandboxProfileEditor({
      versionState: "published-manual-refresh-failed-no-snapshot",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByText("Sandbox Profile v3's snapshot is unavailable")).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry snapshot creation" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Create snapshot" })).toBeNull();
    expect(screen.getByRole("button", { name: "Snapshot creation details" })).toBeDefined();
  });

  it("shows ready snapshots as the version used for new sessions and triggers", () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published",
    });

    expect(screen.getByText("Sandbox Profile v3's snapshot is ready")).toBeDefined();
    expect(
      screen.queryByText("This snapshot will be used for new sessions and triggers."),
    ).toBeNull();
    expect(screen.getByText("Latest snapshot: N/A")).toBeDefined();
    expect(screen.getByRole("button", { name: "Refresh snapshot (setup script)" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Refresh snapshot (maintenance)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Snapshot refresh actions" })).toBeNull();
  });

  it("shows snapshot maintenance editing without manual maintenance refresh before the schedule is saved", () => {
    renderSandboxProfileEditor({
      maintenanceScript: "echo maintain",
      routeSection: "snapshot",
      versionState: "published",
    });

    expect(screen.getByRole("button", { name: "Refresh snapshot (setup script)" })).toBeDefined();
    expect(screen.queryByText("Snapshot maintenance script")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("switch", { name: "Refresh enabled" }));

    expect(screen.queryByRole("button", { name: "Refresh snapshot (maintenance)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Snapshot refresh actions" })).toBeNull();
    expect(screen.getByText("Snapshot maintenance script")).toBeDefined();
    expect(screen.getByRole("button", { name: "Test" }).getAttribute("disabled")).toBeNull();
    expect(screen.getByRole("button", { name: "Setup Assistant" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("keeps automatic snapshot refresh editing open when maintenance Setup Assistant opens", async () => {
    renderSandboxProfileEditor({
      maintenanceScript: "echo maintain",
      routeSection: "snapshot",
      versionState: "published",
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("switch", { name: "Refresh enabled" }));
    fireEvent.change(screen.getByLabelText("Cron expression"), {
      target: { value: "0 10 * * *" },
    });
    const timezoneInput = screen.getByLabelText("Timezone");
    fireEvent.focus(timezoneInput);
    const timezoneListbox = await screen.findByRole("listbox");
    fireEvent.click(within(timezoneListbox).getByText("Asia/Singapore"));
    updateSetupScriptEditor({
      editor: screen.getByRole("textbox", { name: "Snapshot maintenance script" }),
      value: "pnpm update\npnpm test",
    });

    fireEvent.click(screen.getByRole("button", { name: "Setup Assistant" }));

    const closeButton = await screen.findByRole("button", {
      name: "Close Setup Assistant panel",
    });
    expect(closeButton).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    expect(screen.getByLabelText("Cron expression")).toHaveProperty("value", "0 10 * * *");
    expect(screen.getByLabelText("Timezone")).toHaveProperty("value", "Asia/Singapore");
    expect(
      readSetupScriptEditorValue(
        screen.getByRole("textbox", { name: "Snapshot maintenance script" }),
      ),
    ).toBe("pnpm update\npnpm test");
    expect(screen.getByText("Snapshot maintenance script")).toBeDefined();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Close Setup Assistant panel" })).toBeNull();
    });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    expect(screen.getByLabelText("Cron expression")).toHaveProperty("value", "0 10 * * *");
    expect(screen.getByLabelText("Timezone")).toHaveProperty("value", "Asia/Singapore");
    expect(
      readSetupScriptEditorValue(
        screen.getByRole("textbox", { name: "Snapshot maintenance script" }),
      ),
    ).toBe("pnpm update\npnpm test");
  });

  it("shows automatic snapshot refresh as disabled when it is not configured", () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published",
    });

    expect(screen.getByText("Snapshots will not refresh automatically.")).toBeDefined();
    expect(screen.getByText("Refresh enabled")).toBeDefined();
    expect(screen.getAllByText("No").length).toBeGreaterThan(0);
    expect(screen.queryByRole("switch", { name: "Refresh enabled" })).toBeNull();
    expect(screen.queryByLabelText("Cron expression")).toBeNull();
    expect(screen.queryByText("Snapshot maintenance script")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("shows schedule fields after automatic snapshot refresh is enabled", () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published",
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("switch", { name: "Refresh enabled" }));

    expect(
      screen.getByText("Automatic snapshot refresh will start after a schedule is saved."),
    ).toBeDefined();
    expect(screen.getByText("Snapshot maintenance script")).toBeDefined();
    const cronExpressionInput = screen.getByLabelText("Cron expression");
    expect(cronExpressionInput).toBeInstanceOf(HTMLInputElement);
    expect(cronExpressionInput).toHaveProperty("value", "0 9 * * *");
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
  });

  it("shows an existing automatic snapshot refresh schedule", () => {
    renderSandboxProfileEditor({
      refreshSchedule: {
        scheduleId: "sched_snapshot_refresh",
        name: "Snapshot refresh",
        cronExpression: "0 9 * * 1",
        timezone: "Asia/Singapore",
        enabled: true,
        nextScheduledAt: "2026-04-30T01:00:00.000Z",
      },
      routeSection: "snapshot",
      versionState: "published",
    });

    const refreshSection = getAutomaticSnapshotRefreshSection();
    expect(refreshSection.textContent).toContain(
      "Snapshot refresh will build from the base image with setup script.",
    );
    expect(refreshSection.textContent).toContain(
      "Not configured. Automatic refresh uses setup script.",
    );
    expect(
      within(refreshSection)
        .getAllByText("setup script")
        .some((element) => element.tagName === "STRONG"),
    ).toBe(true);
    expect(screen.queryByRole("switch", { name: "Refresh enabled" })).toBeNull();
    expect(screen.getByText("Refresh enabled")).toBeDefined();
    expect(screen.getByText("Yes")).toBeDefined();
    expect(screen.getByText("Snapshot maintenance script")).toBeDefined();
    expect(screen.getByText("Cron")).toBeDefined();
    expect(screen.queryByLabelText("Cron expression")).toBeNull();
    expect(screen.getByText("Asia/Singapore")).toBeDefined();
    expect(screen.getByText("Apr 30, 2026, 9:00 AM GMT+8")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Cron expression")).toHaveProperty("value", "0 9 * * 1");
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("shows that automatic snapshot refresh uses the saved snapshot maintenance script", () => {
    renderSandboxProfileEditor({
      maintenanceScript: "echo maintain",
      refreshSchedule: {
        scheduleId: "sched_snapshot_refresh",
        name: "Snapshot refresh",
        cronExpression: "0 9 * * 1",
        timezone: "Asia/Singapore",
        enabled: true,
        nextScheduledAt: "2026-04-30T01:00:00.000Z",
      },
      routeSection: "snapshot",
      versionState: "published",
    });

    const refreshSection = getAutomaticSnapshotRefreshSection();
    expect(refreshSection.textContent).toContain(
      "Snapshot refresh will build from the current snapshot with maintenance script.",
    );
    expect(
      within(refreshSection)
        .getAllByText("maintenance script")
        .some((element) => element.tagName === "STRONG"),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Refresh snapshot (maintenance)" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Snapshot refresh actions" }));
    expect(screen.getByRole("menuitem", { name: "Refresh snapshot (setup script)" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.getByText("echo maintain")).toBeDefined();
  });

  it("marks an existing automatic snapshot refresh schedule for removal when disabled", () => {
    renderSandboxProfileEditor({
      refreshSchedule: {
        scheduleId: "sched_snapshot_refresh",
        name: "Snapshot refresh",
        cronExpression: "0 9 * * 1",
        timezone: "Asia/Singapore",
        enabled: true,
        nextScheduledAt: "2026-04-30T01:00:00.000Z",
      },
      routeSection: "snapshot",
      versionState: "published",
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("switch", { name: "Refresh enabled" }));

    expect(
      screen.getByText("Automatic snapshot refresh will stop after changes are saved."),
    ).toBeDefined();
    expect(document.body.textContent).not.toContain(
      "Snapshot refresh will build from the base image with setup script.",
    );
    expect(screen.queryByLabelText("Cron expression")).toBeNull();
    expect(screen.queryByText("Snapshot maintenance script")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(getAutomaticSnapshotRefreshSection().textContent).toContain(
      "Snapshot refresh will build from the base image with setup script.",
    );
    expect(screen.queryByRole("switch", { name: "Refresh enabled" })).toBeNull();
    expect(screen.getByText("Yes")).toBeDefined();
  });

  it("updates the automatic snapshot refresh behavior description while editing", async () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published",
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("switch", { name: "Refresh enabled" }));
    const cronExpressionInput = screen.getByLabelText("Cron expression");
    const timezoneInput = screen.getByLabelText("Timezone");
    fireEvent.change(cronExpressionInput, { target: { value: "0 9 * * *" } });
    fireEvent.focus(timezoneInput);
    const timezoneListbox = await screen.findByRole("listbox");
    fireEvent.click(within(timezoneListbox).getByText("Asia/Singapore"));

    const cronBreakdown = screen.getByLabelText("Cron breakdown");
    expect(cronBreakdown.textContent).toContain("0 9 * * *");
    expect(cronBreakdown.textContent).toContain("| | | | day of week: Every day");
    expect(cronBreakdown.textContent).toContain("| | | month: every month");
    expect(screen.queryByText(/^Next refresh: .+ Asia\/Singapore\.$/u)).toBeNull();

    fireEvent.change(cronExpressionInput, { target: { value: "not a cron expression" } });

    expect(
      screen.getByText("Enter a valid cron expression and timezone to preview the schedule."),
    ).toBeDefined();
    expect(screen.getByLabelText("Cron breakdown").textContent).toContain(
      "Enter a valid cron expression and timezone to preview the schedule.",
    );
  });

  it("resolves automatic snapshot refresh cron field breakdowns", () => {
    expect(resolveCronExpressionBreakdown("0 9 * * 1,3,5")).toEqual({
      minute: "0",
      hour: "9",
      dayOfMonthExpression: "*",
      dayOfMonth: "Every day",
      monthExpression: "*",
      month: "Every month",
      dayOfWeekExpression: "1,3,5",
      dayOfWeek: "Monday, Wednesday, Friday",
    });

    const hourlyBreakdown = resolveCronExpressionBreakdown("15 * * * *");
    expect(hourlyBreakdown).not.toBeNull();
    if (hourlyBreakdown === null) {
      throw new Error("Expected hourly cron breakdown to resolve.");
    }
    const hourlyDiagram = formatCronExpressionBreakdownDiagram(hourlyBreakdown);
    expect(hourlyDiagram).toContain("| hour: every hour");
    expect(hourlyDiagram).toContain("minute: at minute 15");

    const intervalBreakdown = resolveCronExpressionBreakdown("*/30 9-17 * * 1-5");
    if (intervalBreakdown === null) {
      throw new Error("Expected interval cron breakdown to resolve.");
    }
    expect(intervalBreakdown.dayOfWeek).toBe("Monday-Friday");
    const intervalDiagram = formatCronExpressionBreakdownDiagram(intervalBreakdown);
    expect(intervalDiagram).toContain("minute: every 30 minutes");

    expect(resolveCronExpressionBreakdown("not a cron expression")).toBeNull();
  });

  it("resolves automatic snapshot refresh behavior descriptions", () => {
    expect(
      resolveSnapshotRefreshScheduleBehaviorDescription({
        after: new Date("2026-04-28T00:00:00.000Z"),
        cronExpression: "0 9 * * *",
        timezone: "Asia/Singapore",
      }),
    ).toBe("Next refresh: 2026-04-28 09:00 Asia/Singapore.");

    expect(
      resolveSnapshotRefreshScheduleBehaviorDescription({
        after: new Date("2026-04-28T00:00:00.000Z"),
        cronExpression: "*/15 9 * * *",
        timezone: "Asia/Singapore",
      }),
    ).toBe("Next refresh: 2026-04-28 09:00 Asia/Singapore.");
  });

  it("keeps persisted timezone values selectable when the browser list does not include them", () => {
    expect(createTimezoneOptions("Custom/Zone")[0]).toEqual({
      label: "Custom/Zone",
      value: "Custom/Zone",
    });
  });

  it("shows schedule validation errors in the snapshot schedule section", async () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published",
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("switch", { name: "Refresh enabled" }));
    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Schedule update failed")).toBeDefined();
    });
    expect(screen.getByText("Enter a cron expression and timezone.")).toBeDefined();
  });

  it("asks users to publish before managing snapshots when no published version exists", () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "draft",
    });

    expect(
      screen.getByText(
        "A snapshot is the prepared sandbox image for this published profile version. New sessions can only start after a snapshot is ready.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText("Publish this sandbox profile before managing snapshots."),
    ).toBeDefined();
    expect(
      screen.getByRole("tabpanel", { name: "Snapshots" }).querySelector(".max-w-5xl"),
    ).not.toBeNull();
    expect(screen.queryByText("Automatic snapshot refresh")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("does not show a refresh snapshot action in the published version menu", () => {
    renderSandboxProfileEditor({
      versionState: "published-with-draft",
    });

    fireEvent.click(screen.getByRole("button", { name: "Sandbox profile actions" }));

    expect(screen.queryByRole("menuitem", { name: "Refresh snapshot" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Discard draft" })).toBeDefined();
  });

  it("returns to the published sandbox profile tab when a published profile has an existing draft", () => {
    const { profileId, router } = renderSandboxProfileEditor({
      versionState: "published-with-draft",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));
    expect(screen.getByRole("tab", { name: "Snapshots" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/snapshots`);

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    expect(screen.getByRole("tab", { name: "Sandbox Profile" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/sandbox-profile`);
    expect(screen.getByText("Viewing: Published (v3)")).toBeDefined();
    expect(screen.getByRole("button", { name: "Resume editing" })).toBeDefined();
  });

  it("does not show the publish success notice again after it is dismissed and the panel remounts", () => {
    const { router } = renderSandboxProfileEditor({
      routeSearch: "?from=publish",
      routeState: {
        notice: "publish-success",
      },
      routeSection: "snapshot",
      versionState: "published-pending",
    });

    expect(screen.getByText("Publish successful, creating a snapshot")).toBeDefined();
    expect(router.state.location.search).toBe("?from=publish");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));
    expect(screen.getByRole("tab", { name: "Sandbox Profile" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.queryByText("Publish successful, creating a snapshot")).toBeNull();
  });

  it("opens the snapshot tab from the section route segment", () => {
    const { profileId, router } = renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published-pending",
    });

    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/snapshots`);
    expect(screen.getByRole("tab", { name: "Snapshots" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Creating snapshot" })).toBeDefined();
  });

  it("pushes a history entry when changing editor sections", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      versionState: "published-pending",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));
    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/snapshots`);

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));
    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/sandbox-profile`);

    await router.navigate(-1);
    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/snapshots`);
  });

  it("opens the triggers tab from the section route segment", () => {
    const { profileId, router } = renderSandboxProfileEditor({
      triggerConnections: [createSlackTriggerConnection()],
      triggerTargets: [createSlackTriggerTarget()],
      triggerWebhookSources: [createSlackTriggerWebhookSource()],
      bindings: [
        {
          id: "binding-slack",
          connectionId: SlackTriggerConnectionId,
          kind: "connector",
          config: {},
        },
      ],
      routeSection: "triggers",
      versionState: "published",
    });

    expect(screen.getByRole("tab", { name: "Triggers" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/triggers`);
    expect(screen.getByRole("heading", { name: "Create from template" })).toBeDefined();
    expect(screen.getByText("Slack Mention")).toBeDefined();
  });

  it("shows unavailable trigger templates with a reason when the required connection is missing", () => {
    renderSandboxProfileEditor({
      triggerTargets: [createSlackTriggerTarget()],
      routeSection: "triggers",
      versionState: "published",
    });

    expect(screen.getByRole("heading", { name: "Create from template" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Available" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Unavailable" })).toBeNull();
    expect(screen.getByText("Slack Mention")).toBeDefined();
    expect(screen.getByText("Slack connection required.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Unavailable" })).toBeNull();
  });

  it("shows the GitHub PR review template when the profile can receive pull request events", () => {
    renderSandboxProfileEditor({
      triggerConnections: [createGitHubTriggerConnection()],
      triggerTargets: [createGitHubTriggerTarget()],
      triggerWebhookSources: [createGitHubTriggerWebhookSource()],
      bindings: [
        {
          id: "binding-github",
          connectionId: GitHubTriggerConnectionId,
          kind: "git",
          config: {},
        },
      ],
      routeSection: "triggers",
      versionState: "published",
    });

    expect(screen.getByRole("heading", { name: "Create from template" })).toBeDefined();
    expect(screen.getByText("GitHub PR Review")).toBeDefined();
    expect(
      screen.getByText("Review a pull request when it is opened or requested with pr-review."),
    ).toBeDefined();
    expect(screen.queryByText("GitHub connection required.")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Select" }).length).toBeGreaterThan(0);
  });

  it("does not make the GitHub PR review template selectable when required events are split across webhook sources", () => {
    const pullRequestConnectionId = "icn_github_pull_request_test";
    const issueCommentConnectionId = "icn_github_issue_comment_test";

    renderSandboxProfileEditor({
      triggerConnections: [
        createGitHubTriggerConnection({ id: pullRequestConnectionId }),
        createGitHubTriggerConnection({ id: issueCommentConnectionId }),
      ],
      triggerTargets: [createGitHubTriggerTarget()],
      triggerWebhookSources: [
        createGitHubTriggerWebhookSource({
          id: "iws_github_pull_request_test",
          connectionId: pullRequestConnectionId,
          events: ["pull_request"],
          permissions: [{ permission: "pull_requests", access: "read" }],
        }),
        createGitHubTriggerWebhookSource({
          id: "iws_github_issue_comment_test",
          connectionId: issueCommentConnectionId,
          events: ["issue_comment"],
          permissions: [{ permission: "issues", access: "read" }],
        }),
      ],
      bindings: [
        {
          id: "binding-github-pull-request",
          connectionId: pullRequestConnectionId,
          kind: "git",
          config: {},
        },
        {
          id: "binding-github-issue-comment",
          connectionId: issueCommentConnectionId,
          kind: "git",
          config: {},
        },
      ],
      routeSection: "triggers",
      versionState: "published",
    });

    expect(screen.getByRole("heading", { name: "Create from template" })).toBeDefined();
    expect(screen.getByText("GitHub PR Review")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(
      screen.getByText("The GitHub connection has not synced the required event capability."),
    ).toBeDefined();
  });

  it("preserves the profile trigger page cursor when selecting a trigger", () => {
    const { profileId, router } = renderSandboxProfileEditor({
      routeSection: "triggers",
      routeSearch: "?after=cursor_after",
      versionState: "published",
      profileTriggersListResult: {
        items: [
          {
            id: "atm_profile_page_2",
            kind: "webhook",
            name: "Page two webhook",
            enabled: true,
            target: {
              sandboxProfileId: "sbp_test",
              sandboxProfileName: "Prototype Profile",
              sandboxProfileVersion: 3,
              primaryRepositoryId: null,
              primaryRepositoryName: null,
            },
            source: {
              kind: "webhook",
              events: [
                {
                  label: "Issue comment created",
                },
              ],
            },
            updatedAt: "2026-04-23T00:00:00.000Z",
          },
        ],
        nextPage: null,
        previousPage: {
          before: "cursor_before",
          limit: 25,
        },
        totalResults: 26,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Page two webhook/ }));

    expect(router.state.location.pathname).toBe(
      `/sandbox-profiles/${profileId}/triggers/atm_profile_page_2`,
    );
    expect(router.state.location.search).toBe("?after=cursor_after");
  });

  it("keeps draft setup script edits across section route changes", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      routeSection: "sandbox-profile",
      versionState: "draft",
    });
    const nextSetupScript = "pnpm install\npnpm test";

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Sandbox Profile",
      hidden: false,
    });
    const editor = within(configurationsPanel).getByRole("textbox", {
      name: "Setup script",
    });
    updateSetupScriptEditor({ editor, value: nextSetupScript });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    await waitFor(() => {
      expect(screen.queryByText("Leave before draft changes are saved?")).toBeNull();
      expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/snapshots`);
    });

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/sandbox-profile`);
    });

    const restoredPanel = screen.getByRole("tabpanel", {
      name: "Sandbox Profile",
      hidden: false,
    });
    const restoredEditorText =
      within(restoredPanel).getByRole("textbox", { name: "Setup script" }).textContent ?? "";
    expect(restoredEditorText).toContain("pnpm install");
    expect(restoredEditorText).toContain("pnpm test");
    expect(restoredEditorText).not.toContain("pnpm dev:bootstrap");
  });

  it("applies externally updated setup scripts while the editor is clean", async () => {
    const { profileId, queryClient } = renderSandboxProfileEditor({
      routeSection: "sandbox-profile",
      setupScript: "pnpm install",
      versionState: "draft",
    });
    const editor = screen.getByRole("textbox", { name: "Setup script" });

    act(() => {
      queryClient.setQueryData(
        sandboxProfileVersionSetupScriptQueryKey({
          profileId,
          version: 3,
        }),
        {
          sandboxProfileId: profileId,
          version: 3,
          setupScript: "pnpm install\npnpm test",
        },
      );
    });

    await waitFor(() => {
      expect(readSetupScriptEditorValue(editor)).toBe("pnpm install\npnpm test");
    });
    expect(screen.queryByText("Setup script updated")).toBeNull();
  });

  it("keeps local setup script edits when the assistant saves a newer version", async () => {
    const { profileId, queryClient } = renderSandboxProfileEditor({
      routeSection: "sandbox-profile",
      setupScript: "pnpm install",
      versionState: "draft",
    });
    const editor = screen.getByRole("textbox", { name: "Setup script" });
    updateSetupScriptEditor({
      editor,
      value: "pnpm install\npnpm dev",
    });

    act(() => {
      queryClient.setQueryData(
        sandboxProfileVersionSetupScriptQueryKey({
          profileId,
          version: 3,
        }),
        {
          sandboxProfileId: profileId,
          version: 3,
          setupScript: "pnpm install\npnpm test",
        },
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Setup script updated")).toBeDefined();
    });
    expect(readSetupScriptEditorValue(editor)).toBe("pnpm install\npnpm dev");

    fireEvent.click(screen.getByRole("button", { name: "Apply assistant version" }));

    await waitFor(() => {
      expect(readSetupScriptEditorValue(editor)).toBe("pnpm install\npnpm test");
    });
    expect(screen.queryByText("Setup script updated")).toBeNull();
  });

  it("blocks true page exits while draft setup script edits are unpersisted", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      routeSection: "sandbox-profile",
      versionState: "draft",
    });

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Sandbox Profile",
      hidden: false,
    });
    updateSetupScriptEditor({
      editor: within(configurationsPanel).getByRole("textbox", {
        name: "Setup script",
      }),
      value: "pnpm install\npnpm test",
    });
    await waitFor(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    void router.navigate("/outside");

    expect(await screen.findByText("Leave before draft changes are saved?")).toBeDefined();
    expect(router.state.location.pathname).toBe(
      `/sandbox-profiles/${profileId}/sandbox-profile/draft`,
    );
  });

  it("opens the snapshot tab when publish success navigation changes an already mounted editor", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      versionState: "published-pending",
    });

    expect(screen.getByRole("tab", { name: "Sandbox Profile" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    await router.navigate(`/sandbox-profiles/${profileId}/snapshots`, {
      state: {
        notice: "publish-success",
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Snapshots" }).getAttribute("aria-selected")).toBe(
        "true",
      );
    });
    const snapshotsPanel = screen.getByRole("tabpanel", {
      name: "Snapshots",
      hidden: false,
    });
    expect(snapshotsPanel.textContent).not.toContain("Viewing: Published");
    expect(screen.getByText("Publish successful, creating a snapshot")).toBeDefined();
    expect(screen.getByRole("button", { name: "Creating snapshot" })).toBeDefined();
  });

  it("polls while a published version is waiting on initial snapshot materialization", () => {
    expect(
      shouldPollSandboxProfileSnapshotJobs([
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "published",
          isActive: false,
          usable: false,
          latestSnapshotJob: createRunningSnapshotJobFixture({
            id: "ssj_pending_initial_materialization",
            trigger: "publish",
          }),
        }),
      ]),
    ).toBe(true);
  });

  it("does not poll once a published version has become active", () => {
    expect(
      shouldPollSandboxProfileSnapshotJobs([
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "published",
          isActive: true,
        }),
      ]),
    ).toBe(false);
  });

  it("polls while a published version has an in-progress snapshot job", () => {
    expect(
      shouldPollSandboxProfileSnapshotJobs([
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_test",
          version: 1,
          state: "published",
          isActive: true,
          usable: true,
          latestSnapshotJob: createRunningSnapshotJobFixture({
            id: "ssj_refresh_materialization",
            trigger: "manual_refresh",
          }),
        }),
      ]),
    ).toBe(true);
  });

  it("redirects the draft route to published when the draft is gone but a published version exists", () => {
    expect(
      shouldRedirectDraftSandboxProfileViewToPublished({
        versions: [
          createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_test",
            version: 1,
            state: "published",
            isActive: false,
            usable: false,
            latestSnapshotJob: {
              id: "ssj_pending_initial_materialization",
              sandboxInstanceId: "sbi_pending_initial_materialization",
              trigger: "publish",
              state: "queued",
              errorCode: null,
              errorMessage: null,
              createdAt: "2026-04-23T00:01:00.000Z",
              startedAt: null,
              finishedAt: null,
            },
          }),
        ],
      }),
    ).toBe(true);
  });

  it("applies the publish response to the cached profile detail immediately", () => {
    expect(
      applyPublishedSandboxProfileVersionToProfile({
        profile: {
          id: "sbp_test",
          organizationId: "org_test",
          displayName: "Prototype Profile",
          activeVersion: null,
          status: "active",
          createdAt: "2026-04-23T00:00:00.000Z",
          updatedAt: "2026-04-23T00:00:00.000Z",
        },
        result: {
          activeVersion: null,
          snapshotJob: {
            id: "ssj_pending_initial_materialization",
            sandboxInstanceId: "sbi_pending_initial_materialization",
            trigger: "publish",
            state: "queued",
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-04-23T00:01:00.000Z",
            startedAt: null,
            finishedAt: null,
          },
          version: createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_test",
            version: 2,
            state: "published",
            isActive: false,
            usable: false,
            latestSnapshotJob: {
              id: "ssj_pending_initial_materialization",
              sandboxInstanceId: "sbi_pending_initial_materialization",
              trigger: "publish",
              state: "queued",
              errorCode: null,
              errorMessage: null,
              createdAt: "2026-04-23T00:01:00.000Z",
              startedAt: null,
              finishedAt: null,
            },
          }),
        },
      }),
    ).toEqual({
      id: "sbp_test",
      organizationId: "org_test",
      displayName: "Prototype Profile",
      activeVersion: null,
      status: "active",
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:00.000Z",
    });
  });

  it("applies the publish response to the cached versions immediately", () => {
    const publishedVersion = createSandboxProfileVersionFixture({
      sandboxProfileId: "sbp_test",
      version: 2,
      state: "published",
      isActive: false,
      usable: false,
      latestSnapshotJob: {
        id: "ssj_pending_initial_materialization",
        sandboxInstanceId: "sbi_pending_initial_materialization",
        trigger: "publish",
        state: "queued",
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-04-23T00:01:00.000Z",
        startedAt: null,
        finishedAt: null,
      },
    });

    expect(
      applyPublishedSandboxProfileVersionToVersions({
        versions: [
          createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_test",
            version: 1,
            state: "draft",
            isActive: false,
          }),
          createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_test",
            version: 2,
            state: "draft",
            isActive: false,
          }),
        ],
        result: {
          activeVersion: null,
          snapshotJob: {
            id: "ssj_pending_initial_materialization",
            sandboxInstanceId: "sbi_pending_initial_materialization",
            trigger: "publish",
            state: "queued",
            errorCode: null,
            errorMessage: null,
            createdAt: "2026-04-23T00:01:00.000Z",
            startedAt: null,
            finishedAt: null,
          },
          version: publishedVersion,
        },
      }),
    ).toEqual([
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_test",
        version: 1,
        state: "draft",
        isActive: false,
      }),
      publishedVersion,
    ]);
  });

  it("applies the created draft response to the cached versions before navigation", () => {
    const draftVersion = createSandboxProfileVersionFixture({
      sandboxProfileId: "sbp_test",
      version: 2,
      state: "draft",
      isActive: false,
    });

    expect(
      applyCreatedSandboxProfileVersionDraftToVersions({
        versions: [
          createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_test",
            version: 1,
            state: "published",
            isActive: true,
          }),
        ],
        draftVersion,
      }),
    ).toEqual([
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_test",
        version: 1,
        state: "published",
        isActive: true,
      }),
      draftVersion,
    ]);
  });

  it("replaces stale cached drafts with the created draft response", () => {
    const draftVersion = createSandboxProfileVersionFixture({
      sandboxProfileId: "sbp_test",
      version: 3,
      state: "draft",
      isActive: false,
    });

    expect(
      applyCreatedSandboxProfileVersionDraftToVersions({
        versions: [
          createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_test",
            version: 1,
            state: "published",
            isActive: true,
          }),
          createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_test",
            version: 2,
            state: "draft",
            isActive: false,
          }),
        ],
        draftVersion,
      }),
    ).toEqual([
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_test",
        version: 1,
        state: "published",
        isActive: true,
      }),
      draftVersion,
    ]);
  });

  it("applies the discarded draft response to the cached versions before navigation", () => {
    expect(
      applyDiscardedSandboxProfileVersionDraftToVersions({
        versions: [
          createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_test",
            version: 1,
            state: "published",
            isActive: true,
          }),
          createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_test",
            version: 2,
            state: "draft",
            isActive: false,
          }),
        ],
        discardedVersion: 2,
      }),
    ).toEqual([
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_test",
        version: 1,
        state: "published",
        isActive: true,
      }),
    ]);
  });

  it("keeps git resources inline with runtime selections", () => {
    renderSandboxProfileEditor();

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    expect(screen.getByText("Git Connection")).toBeDefined();
  });

  it("keeps git connection separate from the combined integration table", () => {
    renderSandboxProfileEditor();

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    const runtimeHeading = screen.getByRole("heading", { name: "Runtime" });
    const agentLabel = screen.getAllByText("Agent")[0];
    if (agentLabel === undefined) {
      throw new Error("Expected runtime Agent label to render.");
    }
    const sandboxRuntimeLabel = screen.getByText("Sandbox Runtime");
    const gitConnectionLabel = screen.getByText("Git Connection");
    const integrationColumnLabel = screen.getAllByText("Integration")[0];
    if (integrationColumnLabel === undefined) {
      throw new Error("Expected combined integration column label to render.");
    }
    const proxiedConnectionColumnLabel = screen.getAllByText("Proxied Connection")[0];
    if (proxiedConnectionColumnLabel === undefined) {
      throw new Error("Expected proxied connection column label to render.");
    }
    const resourcesAndToolsColumnLabel = screen.getAllByText("Resources & Tools")[0];
    if (resourcesAndToolsColumnLabel === undefined) {
      throw new Error("Expected resources and tools column label to render.");
    }

    expectElementToFollow(runtimeHeading, agentLabel);
    expectElementToFollow(agentLabel, sandboxRuntimeLabel);
    expectElementToFollow(sandboxRuntimeLabel, gitConnectionLabel);
    expectElementToFollow(gitConnectionLabel, integrationColumnLabel);
    expect(proxiedConnectionColumnLabel).toBeDefined();
    expect(resourcesAndToolsColumnLabel).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Proxied Connections" })).toBeNull();
    expect(screen.queryByText("Integrations & Tools")).toBeNull();
  });

  it("shows stale git connection errors when a persisted git binding cannot be resolved", () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-git",
          connectionId: "missing-git-connection",
          kind: "git",
          config: {},
        },
      ],
    });

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    expect(screen.getAllByText("Connection cannot be found.").length).toBeGreaterThan(0);
  });

  it("shows no loading placeholder in resources and tools while integrations are loading", () => {
    renderSandboxProfileEditor({
      integrationsLoading: true,
    });

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    expect(screen.getByRole("heading", { name: "Runtime" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Sandbox Runtime" })).toBeDefined();
    expect(screen.queryByText("Loading integrations and resources...")).toBeNull();
    expect(screen.queryByText("Loading integrations...")).toBeNull();
  });

  it("keeps the runtime section quiet while sandbox providers are loading", () => {
    renderSandboxProfileEditor({
      sandboxProvidersLoading: true,
    });

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    expect(screen.getByRole("heading", { name: "Runtime" })).toBeDefined();
    expect(screen.queryByText("Loading sandbox providers...")).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading sandbox providers..." })).toBeNull();
  });

  it("shows integration binding load failures without a loading placeholder", async () => {
    renderSandboxProfileEditor({
      integrationBindingsError: "Bindings failed to load.",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    expect(await screen.findByText("Could not load integration bindings")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Runtime" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Sandbox Runtime" })).toBeDefined();
    expect(screen.queryByText("Loading integrations...")).toBeNull();
  });

  it("shows the setup script editor in the sandbox profile section", () => {
    renderSandboxProfileEditor();

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Sandbox Profile",
      hidden: false,
    });
    const editor = within(configurationsPanel).getByRole("textbox", {
      name: "Setup script",
    });

    expect(editor.textContent).toContain("pnpm install");
    expect(editor.textContent).toContain("pnpm dev:bootstrap");
    const setupScriptBehaviorTrigger = within(configurationsPanel).getByRole("button", {
      name: "Setup script behavior",
    });
    const environmentAndToolsTrigger = within(configurationsPanel).getByRole("button", {
      name: "Environment and installed tools",
    });

    expect(setupScriptBehaviorTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(environmentAndToolsTrigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(setupScriptBehaviorTrigger);
    fireEvent.click(environmentAndToolsTrigger);

    expect(configurationsPanel.textContent).toContain(
      "Repositories are cloned under the working directory",
    );
    expect(configurationsPanel.textContent).toContain("For example, acme/web is available at");
    expect(configurationsPanel.textContent).toContain("Execution environment");
    expect(configurationsPanel.textContent).toContain("Package manager");
  });

  it("shows the latest published setup script when an older active version still exists", () => {
    renderSandboxProfileEditor({
      routeSection: "sandbox-profile",
      versionState: "published-pending-with-older-active",
      setupScriptsByVersion: {
        2: null,
        3: "pnpm install\npnpm test:setup",
      },
    });

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Sandbox Profile",
      hidden: false,
    });
    const editor = within(configurationsPanel).getByRole("textbox", {
      name: "Setup script",
    });

    expect(screen.getByText("Viewing: Published (v3)")).toBeDefined();
    expect(editor.textContent).toContain("pnpm install");
    expect(editor.textContent).toContain("pnpm test:setup");
  });

  it("shows selected repository locations in the setup script context", () => {
    renderSandboxProfileEditor({
      routeSection: "sandbox-profile",
      bindings: [
        {
          id: "binding-git",
          connectionId: "connection-github",
          kind: "git",
          config: {
            repositories: ["mistlehq/mistle"],
          },
        },
      ],
    });

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Sandbox Profile",
      hidden: false,
    });

    fireEvent.click(
      within(configurationsPanel).getByRole("button", {
        name: "Setup script behavior",
      }),
    );

    expect(configurationsPanel.textContent).toContain("Repository locations");
    expect(configurationsPanel.textContent).toContain("mistlehq/mistle");
    expect(configurationsPanel.textContent).not.toContain("For example");
  });

  it("uses draft integration rows for setup script repository context", () => {
    const initialRows: SandboxProfileBindingEditorRow[] = [
      {
        clientId: "initial-git-row",
        connectionId: "connection-github",
        kind: "git",
        config: {
          repositories: ["mistlehq/mistle"],
        },
      },
    ];
    const draftRows: SandboxProfileBindingEditorRow[] = [
      {
        clientId: "draft-git-row",
        connectionId: "connection-github",
        kind: "git",
        config: {
          repositories: ["mistlehq/dashboard"],
        },
      },
    ];

    expect(resolveSandboxProfileSetupScriptIntegrationRows(initialRows, draftRows)).toBe(draftRows);
  });

  it("renders an empty setup script editor when no script is configured", () => {
    renderSandboxProfileEditor({ setupScript: null });

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Sandbox Profile",
      hidden: false,
    });
    const editor = within(configurationsPanel).getByRole("textbox", {
      name: "Setup script",
    });
    const editorRoot = editor.closest('[data-slot="sandbox-setup-script-editor"]');

    expect(editorRoot?.getAttribute("data-editor-state")).toBe("empty");
  });

  it("allows setup script testing for draft scripts with content", () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-agent",
          connectionId: "connection-agent",
          kind: "agent",
          config: {},
        },
      ],
      routeSection: "sandbox-profile",
      setupScript: "pnpm install\npnpm dev:bootstrap",
      versionState: "draft",
    });

    const testButton = screen.getByRole("button", {
      name: "Test",
    });
    const setupAssistantButton = screen.getByRole("button", {
      name: "Setup Assistant",
    });
    expect(testButton.hasAttribute("disabled")).toBe(false);
    expect(testButton.getAttribute("title")).toBe("Test setup script");
    expect(setupAssistantButton.hasAttribute("disabled")).toBe(false);
  });

  it("opens the Setup Assistant panel from the setup script action", async () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-agent",
          connectionId: "connection-agent",
          kind: "agent",
          config: {},
        },
      ],
      routeSection: "sandbox-profile",
      setupScript: "pnpm install\npnpm dev:bootstrap",
      versionState: "draft",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Setup Assistant",
      }),
    );

    expect(
      await screen.findByRole("button", {
        name: "Close Setup Assistant panel",
      }),
    ).toBeTruthy();
  });

  it("asks whether to save before opening Setup Assistant when the saved draft is startable", () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-agent",
          connectionId: "connection-agent",
          kind: "agent",
          config: {},
        },
      ],
      routeSection: "sandbox-profile",
      setupScript: "pnpm install\npnpm dev:bootstrap",
      versionState: "draft",
    });

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Sandbox Profile",
      hidden: false,
    });
    updateSetupScriptEditor({
      editor: within(configurationsPanel).getByRole("textbox", {
        name: "Setup script",
      }),
      value: "pnpm install\npnpm test\npnpm dev:bootstrap",
    });

    const setupAssistantButton = screen.getByRole("button", {
      name: "Setup Assistant",
    });
    expect(setupAssistantButton.getAttribute("title")).toBe(
      "Choose whether to save changes before opening Setup Assistant.",
    );

    fireEvent.click(setupAssistantButton);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(
      screen.getByText(
        "Setup Assistant uses the latest saved draft. Save your current changes before opening it, or open it with the latest saved draft instead. Your unsaved editor changes will stay in the editor.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save and open" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use latest saved draft" })).toBeTruthy();
  });

  it("resolves the save-required Setup Assistant dialog when only local changes add an agent", () => {
    expect(
      resolveSetupAssistantStartDialogVariant({
        latestSavedDraftHasAgentRuntime: false,
        localDraftHasAgentRuntime: true,
      }),
    ).toBe("save-required");
  });

  it("uses the latest saved draft when local changes remove the saved agent", () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-agent",
          connectionId: "missing-agent-connection",
          kind: "agent",
          config: {},
        },
      ],
      routeSection: "sandbox-profile",
      setupScript: "pnpm install\npnpm dev:bootstrap",
      versionState: "draft",
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove agent provider" }));

    const setupAssistantButton = screen.getByRole("button", {
      name: "Setup Assistant",
    });
    expect(setupAssistantButton.getAttribute("title")).toBe(
      "Choose whether to save changes before opening Setup Assistant.",
    );

    fireEvent.click(setupAssistantButton);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use latest saved draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save and open" })).toBeNull();
  });

  it("renders the save-required Setup Assistant dialog without the saved-draft action", () => {
    let saved = false;
    let usedLatestSavedDraft = false;

    render(
      <SetupAssistantStartDialog
        isOpen
        isPending={false}
        onOpenChange={() => {}}
        onSaveAndOpen={() => {
          saved = true;
        }}
        onUseLatestSavedDraft={() => {
          usedLatestSavedDraft = true;
        }}
        variant="save-required"
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Save draft to use Setup Assistant")).toBeTruthy();
    expect(
      screen.getByText(
        "Setup Assistant needs a saved draft with an agent integration. Save your current changes before opening it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use latest saved draft" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save and open" }));

    expect(saved).toBe(true);
    expect(usedLatestSavedDraft).toBe(false);
  });

  it("renders the latest-saved-draft-only Setup Assistant dialog without the save action", () => {
    let saved = false;
    let usedLatestSavedDraft = false;

    render(
      <SetupAssistantStartDialog
        isOpen
        isPending={false}
        onOpenChange={() => {}}
        onSaveAndOpen={() => {
          saved = true;
        }}
        onUseLatestSavedDraft={() => {
          usedLatestSavedDraft = true;
        }}
        variant="use-saved-required"
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(
      screen.getByText(
        "Setup Assistant needs a saved draft with an agent integration. Your current changes remove the saved agent integration, so open it with the latest saved draft instead. Your unsaved editor changes will stay in the editor.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save and open" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use latest saved draft" }));

    expect(saved).toBe(false);
    expect(usedLatestSavedDraft).toBe(true);
  });

  it("shows operation timeline progress while Setup Assistant startup is active", () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <SetupAssistantStartupProgress
          sandboxInstanceId={null}
          startupOperation={null}
          startupOperationId={null}
          startupState="preparing_sandbox"
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Preparing sandbox")).toBeTruthy();
    expect(screen.getByText("No lifecycle events yet.")).toBeTruthy();
  });

  it("confirms before closing an active Setup Assistant sandbox", () => {
    let confirmed = false;
    let canceled = false;

    render(
      <SetupAssistantCloseDialog
        errorMessage={null}
        isOpen
        isPending={false}
        onCancel={() => {
          canceled = true;
        }}
        onConfirm={() => {
          confirmed = true;
        }}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Stop Setup Assistant?")).toBeTruthy();
    expect(
      screen.getByText(
        "Closing the Setup Assistant stops its temporary sandbox. The setup script draft stays in the editor.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(canceled).toBe(true);
    expect(confirmed).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Stop and close" }));
    expect(confirmed).toBe(true);
  });

  it("blocks duplicate Setup Assistant stop confirmations while stopping", () => {
    let canceled = false;
    let confirmed = false;

    render(
      <SetupAssistantCloseDialog
        errorMessage="Stop request timed out."
        isOpen
        isPending
        onCancel={() => {
          canceled = true;
        }}
        onConfirm={() => {
          confirmed = true;
        }}
      />,
    );

    expect(screen.getByText("Stop request timed out.")).toBeTruthy();

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const confirmButton = screen.getByRole("button", { name: "Stopping..." });
    expect(cancelButton.hasAttribute("disabled")).toBe(true);
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    fireEvent.click(cancelButton);
    fireEvent.click(confirmButton);

    expect(canceled).toBe(false);
    expect(confirmed).toBe(false);
  });

  it("disables setup script testing for empty and published scripts", () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-agent",
          connectionId: "connection-agent",
          kind: "agent",
          config: {},
        },
      ],
      routeSection: "sandbox-profile",
      setupScript: null,
      versionState: "draft",
    });

    const emptyDraftTestButton = screen.getByRole("button", {
      name: "Test",
    });
    const emptyDraftWriteButton = screen.getByRole("button", {
      name: "Setup Assistant",
    });
    expect(emptyDraftTestButton.hasAttribute("disabled")).toBe(true);
    expect(emptyDraftTestButton.getAttribute("title")).toBe("Add a setup script before testing.");
    expect(emptyDraftWriteButton.hasAttribute("disabled")).toBe(false);

    cleanup();

    renderSandboxProfileEditor({
      routeSection: "sandbox-profile",
      setupScript: "pnpm install",
      versionState: "published",
    });

    const publishedTestButton = screen.getByRole("button", {
      name: "Test",
    });
    const publishedWriteButton = screen.getByRole("button", {
      name: "Setup Assistant",
    });
    expect(publishedTestButton.hasAttribute("disabled")).toBe(true);
    expect(publishedTestButton.getAttribute("title")).toBe(
      "Setup script testing is only available while editing a draft.",
    );
    expect(publishedWriteButton.hasAttribute("disabled")).toBe(true);
  });

  it("disables Setup Assistant when no agent runtime is configured", () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-git",
          connectionId: "connection-git",
          kind: "git",
          config: {},
        },
      ],
      routeSection: "sandbox-profile",
      setupScript: "pnpm install",
      versionState: "draft",
    });

    const setupAssistantButton = screen.getByRole("button", {
      name: "Setup Assistant",
    });

    expect(setupAssistantButton.hasAttribute("disabled")).toBe(true);
    expect(setupAssistantButton.getAttribute("title")).toBe(
      "Add an agent integration before using Setup Assistant.",
    );
  });

  it("renders published profiles as read-only", () => {
    renderSandboxProfileEditor({
      versionState: "published",
      bindings: [
        {
          id: "binding-agent",
          connectionId: "connection-agent",
          kind: "agent",
          config: {},
        },
      ],
      connections: [
        {
          id: "connection-agent",
          displayName: "Codex connection",
          targetKey: "openai-default",
          status: "active",
        },
      ],
      targets: [
        {
          targetKey: "openai-default",
          displayName: "OpenAI",
          familyId: "openai",
          variantId: "openai-default",
          config: {
            api_base_url: "https://api.openai.com",
          },
          targetHealth: {
            configStatus: "valid",
          },
        },
      ],
    });

    expect(screen.getByText("Viewing: Published (v3)")).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "OpenAI connection" })).toBeNull();
    expect(screen.getByText("Codex connection")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Setup script behavior" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Environment and installed tools" })).toBeNull();
  });

  it("renders published profiles with existing drafts as resumable", () => {
    renderSandboxProfileEditor({
      versionState: "published-with-draft",
    });

    expect(screen.getByText("Viewing: Published (v3)")).toBeDefined();
    expect(screen.getByRole("button", { name: "Resume editing" })).toBeDefined();
  });

  it("shows discard draft in the published actions menu when a draft exists", () => {
    renderSandboxProfileEditor({
      versionState: "published-with-draft",
    });

    fireEvent.click(screen.getByRole("button", { name: "Sandbox profile actions" }));

    expect(screen.getByRole("menuitem", { name: "Discard draft" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "Delete profile" })).toBeNull();
  });

  it("keeps delete profile in the top-level actions menu when a draft exists", () => {
    renderSandboxProfileEditor({
      versionState: "published-with-draft",
    });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(screen.getByRole("menuitem", { name: "Delete profile" })).toBeDefined();
    expect(screen.queryByRole("menuitem", { name: "Discard draft" })).toBeNull();
  });

  it("renders draft profiles with publish action", () => {
    renderSandboxProfileEditor();

    expect(screen.getByText("Viewing: Draft")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save draft" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDefined();
  });

  it("enables explicit draft saving after setup script edits", async () => {
    renderSandboxProfileEditor({
      versionState: "draft",
    });

    const configurationsPanel = screen.getByRole("tabpanel", {
      name: "Sandbox Profile",
      hidden: false,
    });
    updateSetupScriptEditor({
      editor: within(configurationsPanel).getByRole("textbox", {
        name: "Setup script",
      }),
      value: "pnpm install\npnpm test",
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save draft" })).toHaveProperty("disabled", false);
    });
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", false);
  });

  it("shows the editable draft persistence mode", () => {
    renderSandboxProfileEditor({
      defaultPersistenceMode: "persistent",
      versionState: "draft",
    });

    const persistenceSwitch = screen.getByRole("switch", {
      name: "Use persistent sandboxes",
    });

    expect(persistenceSwitch.getAttribute("aria-checked")).toBe("true");
    expect(persistenceSwitch.hasAttribute("disabled")).toBe(false);
  });

  it("marks the draft unsaved when persistence mode changes", async () => {
    renderSandboxProfileEditor({
      defaultPersistenceMode: "ephemeral",
      versionState: "draft",
    });

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Use persistent sandboxes",
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save draft" })).toHaveProperty("disabled", false);
    });
  });

  it("renders published profile persistence mode as read-only", () => {
    renderSandboxProfileEditor({
      defaultPersistenceMode: "persistent",
      versionState: "published",
    });

    expect(
      screen.queryByRole("switch", {
        name: "Use persistent sandboxes",
      }),
    ).toBeNull();
    expect(screen.getByText("Use persistent sandboxes:")).toBeDefined();
    expect(screen.getByText("Yes")).toBeDefined();
  });

  it("hides profile persistence when organization persistence is disabled", () => {
    renderSandboxProfileEditor({
      defaultPersistenceMode: "persistent",
      persistentSandboxesEnabled: false,
      versionState: "draft",
    });

    expect(
      screen.queryByRole("switch", {
        name: "Use persistent sandboxes",
      }),
    ).toBeNull();
    expect(screen.queryByText("Use persistent sandboxes:")).toBeNull();
  });

  it("does not offer discard for draft-only profiles", () => {
    renderSandboxProfileEditor();

    expect(screen.queryByRole("button", { name: "Sandbox profile actions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(screen.getAllByRole("menuitem").map((menuItem) => menuItem.textContent)).toEqual([
      "Delete profile",
    ]);
  });

  it("keeps draft publish action enabled", () => {
    renderSandboxProfileEditor({
      view: "draft",
      versionState: "draft-with-published",
    });

    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Sandbox profile actions" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("surfaces draft save failures inside the sandbox profile tab", () => {
    renderDraftActionsHarness({
      draftSaveError: "Saving draft failed. Please try again later.",
    });

    expect(screen.queryByText("Profile version action failed")).toBeNull();
    expect(screen.getByText("Saving draft failed. Please try again later.")).toBeDefined();
  });

  it("surfaces saved draft trigger impact warnings", () => {
    renderDraftActionsHarness({
      draftTriggerImpactAffectedTriggers: [
        {
          enabled: true,
          id: "webhook_repository_triage",
          issues: [
            {
              code: "WEBHOOK_SOURCE_CONNECTION_NOT_BOUND",
              message: "Webhook source connection is not bound.",
            },
          ],
          kind: "webhook",
          name: "Repository triage",
        },
        {
          enabled: true,
          id: "sch_release_notes",
          issues: [
            {
              code: "PRIMARY_REPOSITORY_UNAVAILABLE",
              message: "Primary repository is unavailable.",
            },
          ],
          kind: "schedule",
          name: "Release notes",
        },
      ],
    });

    const noticeTitle = screen.getByText("Publishing this draft will break the following triggers");
    expect(noticeTitle).toBeDefined();
    expect(noticeTitle.closest('[role="tabpanel"]')).not.toBeNull();
    const webhookTriggerLink = screen.getByRole("link", { name: "Repository triage" });
    expect(webhookTriggerLink.getAttribute("href")).toBe("/triggers/webhook_repository_triage");
    expect(webhookTriggerLink.getAttribute("target")).toBe("_blank");
    expect(webhookTriggerLink.getAttribute("rel")).toBe("noreferrer");

    const scheduledTriggerLink = screen.getByRole("link", { name: "Release notes" });
    expect(scheduledTriggerLink.getAttribute("href")).toBe("/triggers/sch_release_notes");
    expect(scheduledTriggerLink.getAttribute("target")).toBe("_blank");
    expect(scheduledTriggerLink.getAttribute("rel")).toBe("noreferrer");
    expect(
      screen.getByText("This trigger's webhook source connection is not bound in the draft."),
    ).toBeDefined();
    expect(
      screen.getByText("This trigger's primary repository is not available in the draft."),
    ).toBeDefined();
  });

  it("shows failed draft trigger checks as a dismissible notice", () => {
    renderDraftActionsHarness({
      draftTriggerImpactError: "Couldn't check whether this draft affects related triggers.",
    });

    expect(screen.getByText("Trigger checks failed")).toBeDefined();
    expect(
      screen.getByText("Couldn't check whether this draft affects related triggers."),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText("Trigger checks failed")).toBeNull();
  });

  it("shows draft actions for draft profiles with a published version", () => {
    renderSandboxProfileEditor({
      view: "draft",
      versionState: "draft-with-published",
    });

    fireEvent.click(screen.getByRole("button", { name: "Sandbox profile actions" }));

    expect(screen.getAllByRole("menuitem").map((menuItem) => menuItem.textContent)).toEqual([
      "View published",
      "Discard draft",
    ]);
  });

  it("discards a draft with unsaved local changes", () => {
    renderDraftActionsHarness({
      hasUnpersistedIntegrationChanges: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Sandbox profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Discard draft" }));

    expect(screen.getByText("Discarded")).toBeDefined();
  });

  it("opens the sandbox profile tab from the profile default route when a published version exists", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      view: "default",
      versionState: "published",
    });

    expect(await screen.findByText("Viewing: Published (v3)")).toBeDefined();
    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/sandbox-profile`);
  });

  it("opens the published sandbox profile tab from the profile default route when a draft also exists", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      view: "default",
      versionState: "draft-with-published",
    });

    expect(await screen.findByText("Viewing: Published (v2)")).toBeDefined();
    expect(screen.getByRole("button", { name: "Resume editing" })).toBeDefined();
    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/sandbox-profile`);
  });

  it("opens the sandbox profile tab from the profile default route when only a draft exists", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      view: "default",
      versionState: "draft",
    });

    expect(await screen.findByText("Viewing: Draft")).toBeDefined();
    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/sandbox-profile`);
  });

  it("redirects the published route to draft when the profile has no published version", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      view: "published",
      versionState: "draft",
    });

    expect(await screen.findByText("Viewing: Draft")).toBeDefined();
    expect(router.state.location.pathname).toBe(
      `/sandbox-profiles/${profileId}/sandbox-profile/draft`,
    );
  });

  it("keeps the published route when a published version is materializing and a draft exists", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      view: "published",
      versionState: "published-pending-with-draft",
    });

    expect(await screen.findByText("Viewing: Published (v3)")).toBeDefined();
    expect(screen.getByRole("button", { name: "Resume editing" })).toBeDefined();
    expect(router.state.location.pathname).toBe(
      `/sandbox-profiles/${profileId}/sandbox-profile/published`,
    );
  });

  it("redirects the draft route to published when the profile has no draft but does have a published version", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      view: "draft",
      versionState: "published",
    });

    expect(await screen.findByText("Viewing: Published (v3)")).toBeDefined();
    expect(router.state.location.pathname).toBe(
      `/sandbox-profiles/${profileId}/sandbox-profile/published`,
    );
  });

  it("shows the snapshots publish-first state on the snapshots route", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      routeSection: "snapshot",
      view: "draft",
      versionState: "draft",
    });

    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/snapshots`);
    expect(
      screen.getByText("Publish this sandbox profile before managing snapshots."),
    ).toBeDefined();
  });

  it("shows published snapshots without draft route coupling when a draft exists", async () => {
    const { profileId, router } = renderSandboxProfileEditor({
      routeSection: "snapshot",
      view: "draft",
      versionState: "draft-with-published",
    });

    expect(router.state.location.pathname).toBe(`/sandbox-profiles/${profileId}/snapshots`);
    expect(screen.getByRole("tab", { name: "Snapshots" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("confirms profile deletion with trigger usage context", () => {
    renderDeleteProfileDialogHarness({
      triggerUsages: [
        {
          id: "atm_triage",
          name: "Repository triage",
        },
        {
          id: "atm_release",
          name: "Release notes",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));

    expect(screen.getByRole("heading", { name: "Delete profile?" })).toBeDefined();
    expect(screen.getByText("Repository triage")).toBeDefined();
    expect(screen.getByText("Release notes")).toBeDefined();
    expect(screen.getByText("These triggers use this profile and will break:")).toBeDefined();
    expect(
      screen.getByText("They will stop working until you delete or retarget them."),
    ).toBeDefined();
  });

  it("blocks profile deletion while trigger usage context is loading", () => {
    renderDeleteProfileDialogHarness({
      triggerUsagesIsPending: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));

    expect(screen.getByText("Loading triggers...")).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete profile" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
