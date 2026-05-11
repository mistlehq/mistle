// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
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
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileIntegrationDirectoryQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionSetupScriptQueryKey,
  sandboxProfileVersionsQueryKey,
  sandboxProvidersQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type {
  SandboxProfileVersion,
  SandboxProfileVersionDraftAutomationImpactAutomation,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { organizationSandboxStorageSettingsQueryKey } from "../settings/organization/sandbox-storage-service.js";
import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";
import {
  applyPublishedSandboxProfileVersionToProfile,
  applyPublishedSandboxProfileVersionToVersions,
  createTimezoneOptions,
  formatCronExpressionBreakdownDiagram,
  resolveCronExpressionBreakdown,
  resolveSandboxProfileEditorVersionMode,
  resolveSandboxProfileSetupScriptIntegrationRows,
  resolveSnapshotRefreshScheduleBehaviorDescription,
  shouldPollSandboxProfileSnapshotJobs,
  shouldRedirectDraftSandboxProfileViewToPublished,
} from "./sandbox-profile-editor-page-model.js";
import {
  SandboxProfileDefaultRedirect,
  SandboxProfileEditorPage,
  SandboxProfileEditorShell,
  SandboxProfileEditorView,
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

afterEach(() => {
  cleanup();
  void cleanupTestQueryClients();
});

function createSandboxProfileVersionFixture(input: {
  sandboxProfileId: string;
  version: number;
  state: SandboxProfileVersion["state"];
  defaultPersistenceMode?: SandboxProfileVersion["defaultPersistenceMode"];
  isActive: boolean;
  usable?: boolean;
  latestSnapshotJob?: SandboxProfileVersion["latestSnapshotJob"];
  refreshSchedule?: SandboxProfileVersion["refreshSchedule"];
}): SandboxProfileVersion {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    state: input.state,
    defaultPersistenceMode: input.defaultPersistenceMode ?? "ephemeral",
    sandboxConnectionId: null,
    sandboxProvider: "docker",
    sandboxResources: null,
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
type SandboxProfileEditorTestRouteSection = "sandbox-profile" | "snapshot" | null;

function createRunningSnapshotJobFixture(input: {
  id: string;
  trigger: "publish" | "manual_refresh";
}): NonNullable<SandboxProfileVersion["latestSnapshotJob"]> {
  return {
    id: input.id,
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
  integrationsLoading?: boolean;
  defaultPersistenceMode?: SandboxProfileVersion["defaultPersistenceMode"];
  persistentSandboxesEnabled?: boolean;
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
            max: 8192,
            step: 1024,
            default: 4096,
          },
        },
      },
    ],
  });
  queryClient.setQueryData(sandboxProfileDetailQueryKey(profileId), {
    id: profileId,
    displayName: "Prototype Profile",
    activeVersion,
    status: "active",
    latestVersion: version,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  });
  if (input?.integrationsLoading === true) {
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
    router,
  };
}

function DeleteProfileDialogHarness(input: {
  automationUsages?: readonly {
    id: string;
    name: string;
  }[];
  automationUsagesError?: string | null;
  automationUsagesIsPending?: boolean;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <SandboxProfileEditorView
      activeSectionId="sandbox-profile"
      deleteProfileAutomationUsages={input.automationUsages ?? []}
      deleteProfileAutomationUsagesError={input.automationUsagesError ?? null}
      deleteProfileAutomationUsagesIsPending={input.automationUsagesIsPending ?? false}
      deleteProfileError={null}
      deleteProfileIsPending={false}
      draftAutomationImpactAffectedAutomations={null}
      draftAutomationImpactError={null}
      onDraftAutomationImpactErrorDismiss={() => {}}
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
  draftAutomationImpactAffectedAutomations?:
    | readonly SandboxProfileVersionDraftAutomationImpactAutomation[]
    | null;
  draftAutomationImpactError?: string | null;
  hasUnpersistedIntegrationChanges?: boolean;
  draftSaveError?: string | null;
}): JSX.Element {
  const [discarded, setDiscarded] = useState(false);
  const [draftAutomationImpactError, setDraftAutomationImpactError] = useState(
    input.draftAutomationImpactError ?? null,
  );

  return (
    <SandboxProfileEditorView
      activeSectionId="sandbox-profile"
      deleteProfileAutomationUsages={[]}
      deleteProfileAutomationUsagesError={null}
      deleteProfileAutomationUsagesIsPending={false}
      deleteProfileError={null}
      deleteProfileIsPending={false}
      draftSaveError={input.draftSaveError ?? null}
      draftAutomationImpactAffectedAutomations={
        input.draftAutomationImpactAffectedAutomations ?? null
      }
      draftAutomationImpactError={draftAutomationImpactError}
      onDraftAutomationImpactErrorDismiss={() => {
        setDraftAutomationImpactError(null);
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
  automationUsages?: readonly {
    id: string;
    name: string;
  }[];
  automationUsagesError?: string | null;
  automationUsagesIsPending?: boolean;
}): void {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<DeleteProfileDialogHarness {...input} />} path="/" />,
    ),
  );

  render(<RouterProvider router={router} />);
}

function renderDraftActionsHarness(input?: {
  draftAutomationImpactAffectedAutomations?:
    | readonly SandboxProfileVersionDraftAutomationImpactAutomation[]
    | null;
  draftAutomationImpactError?: string | null;
  hasUnpersistedIntegrationChanges?: boolean;
  draftSaveError?: string | null;
}): void {
  const router = createMemoryRouter(
    createRoutesFromElements(<Route element={<DraftActionsHarness {...input} />} path="/" />),
  );

  render(<RouterProvider router={router} />);
}

function updateSetupScriptEditor(input: { editor: HTMLElement; value: string }): void {
  const editorElement = input.editor.closest(".cm-editor");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("CodeMirror editor element was not found.");
  }

  const editorView = EditorView.findFromDOM(editorElement);
  if (editorView === null) {
    throw new Error("CodeMirror editor view was not found.");
  }

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

describe("SandboxProfileEditorPage", () => {
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

  it("renders sandbox profile and snapshots tabs", () => {
    renderSandboxProfileEditor();

    expect(screen.getByRole("tab", { name: "Sandbox Profile" })).toBeDefined();
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
    expect(screen.getAllByText("Resources & Tools").length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "Setup script" })).toBeDefined();
  });

  it("shows snapshot creation feedback while initial materialization is running", () => {
    renderSandboxProfileEditor({
      versionState: "published-pending",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByText("Creating snapshot")).toBeDefined();
    expect(screen.getByText("Sandbox Profile v3's snapshot is being created")).toBeDefined();
    expect(
      screen.getByText(
        "New sessions and automations will be available after snapshot creation succeeds.",
      ),
    ).toBeDefined();
    const status = screen.getByRole("status", { name: "Creating snapshot" });
    expect(status.className).toContain("sm:justify-end");
    expect(status.querySelector(".text-right")?.textContent).toContain("Creating snapshot");
  });

  it("shows the interim runnable snapshot while a newer published snapshot is being created", () => {
    renderSandboxProfileEditor({
      versionState: "published-pending-with-older-active",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByText("Sandbox Profile v3's snapshot is being created")).toBeDefined();
    expect(
      screen.getByText("Interim, v2's snapshot will be used for new sessions and automations."),
    ).toBeDefined();
  });

  it("shows creating while the first snapshot is materializing from a manual job", () => {
    renderSandboxProfileEditor({
      versionState: "published-manual-refresh-no-snapshot",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByText("Creating snapshot")).toBeDefined();
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
        "Version v3 was published, but its snapshot could not be created. New sessions and automations will continue using v2 until the snapshot is retried successfully.",
      ),
    ).toBeDefined();
    expect(screen.queryByText("Snapshot materialization failed.")).toBeNull();
    expect(screen.getByText("Sandbox Profile v3's snapshot is unavailable")).toBeDefined();
    expect(
      screen.getByText("v2's snapshot will be used for new sessions and automations."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry snapshot creation" })).toBeDefined();
  });

  it("asks users to retry snapshot creation when a published version has no snapshot", () => {
    renderSandboxProfileEditor({
      versionState: "published-no-snapshot",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Snapshots" }));

    expect(screen.getByText("Sandbox Profile v3's snapshot is unavailable")).toBeDefined();
    expect(
      screen.getByText("Sessions and automations are blocked until snapshot creation succeeds."),
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
  });

  it("shows ready snapshots as the version used for new sessions and automations", () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published",
    });

    expect(screen.getByText("Sandbox Profile v3's snapshot is ready")).toBeDefined();
    expect(
      screen.queryByText("This snapshot will be used for new sessions and automations."),
    ).toBeNull();
    expect(screen.getByText("Latest snapshot: N/A")).toBeDefined();
    expect(screen.getByRole("button", { name: "Refresh snapshot" })).toBeDefined();
  });

  it("shows automatic snapshot refresh as disabled when it is not configured", () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published",
    });

    const refreshSwitch = screen.getByRole("switch", { name: "Automatic refresh" });
    expect(refreshSwitch.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Snapshots will not refresh automatically.")).toBeDefined();
    expect(screen.queryByLabelText("Cron expression")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save schedule" })).toBeNull();
  });

  it("shows schedule fields after automatic snapshot refresh is enabled", () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published",
    });

    fireEvent.click(screen.getByRole("switch", { name: "Automatic refresh" }));

    expect(
      screen.getByText("Automatic refresh will start after a schedule is saved."),
    ).toBeDefined();
    const cronExpressionInput = screen.getByLabelText("Cron expression");
    expect(cronExpressionInput).toBeInstanceOf(HTMLInputElement);
    expect(cronExpressionInput).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Save schedule" })).toBeDefined();
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

    const refreshSwitch = screen.getByRole("switch", { name: "Automatic refresh" });
    expect(refreshSwitch.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText("Automatic refresh is enabled for this published version."),
    ).toBeDefined();
    expect(screen.getByText("Cron")).toBeDefined();
    expect(screen.getAllByDisplayValue("0 9 * * 1")).toHaveLength(1);
    expect(screen.getByText("Asia/Singapore")).toBeDefined();
    expect(screen.getByText("2026-04-30T01:00:00.000Z")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save schedule" })).toBeDefined();
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

    fireEvent.click(screen.getByRole("switch", { name: "Automatic refresh" }));

    expect(screen.getByText("Snapshots will not refresh automatically.")).toBeDefined();
    expect(screen.queryByLabelText("Cron expression")).toBeNull();
    expect(screen.queryByText("2026-04-30T01:00:00.000Z")).toBeNull();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDefined();
  });

  it("updates the automatic snapshot refresh behavior description while editing", async () => {
    renderSandboxProfileEditor({
      routeSection: "snapshot",
      versionState: "published",
    });

    fireEvent.click(screen.getByRole("switch", { name: "Automatic refresh" }));
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

    fireEvent.click(screen.getByRole("switch", { name: "Automatic refresh" }));
    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));

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
        "A snapshot is the prepared sandbox image created from this published profile version and its setup script. New sessions can only start after a snapshot is ready.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText("Publish this sandbox profile before managing snapshots."),
    ).toBeDefined();
    expect(
      screen.getByRole("tabpanel", { name: "Snapshots" }).querySelector(".max-w-5xl"),
    ).not.toBeNull();
    expect(screen.queryByText("Automatic refresh")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save schedule" })).toBeNull();
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
    expect(screen.getByText("Creating snapshot")).toBeDefined();
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
    expect(screen.getByText("Creating snapshot")).toBeDefined();
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

  it("keeps resources and tools inline with the integration rows", () => {
    renderSandboxProfileEditor();

    fireEvent.click(screen.getByRole("tab", { name: "Sandbox Profile" }));

    expect(screen.getAllByText("Resources & Tools").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(
        "Choose a Git provider in Integrations before selecting repository resources.",
      ),
    ).toBeNull();
  });

  it("shows stale git guidance when a persisted git binding cannot be resolved", () => {
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

    expect(screen.queryByText("Loading integrations and resources...")).toBeNull();
    expect(
      screen.queryByText(
        "Choose a Git provider in Integrations before selecting repository resources.",
      ),
    ).toBeNull();
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
          config: {
            runtime: {
              runtimeId: "codex",
            },
          },
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
    const failOnFirstErrorSwitch = screen.getByRole("switch", {
      name: "Fail on error",
    });

    expect(testButton.hasAttribute("disabled")).toBe(false);
    expect(testButton.getAttribute("title")).toBe("Test setup script");
    expect(setupAssistantButton.hasAttribute("disabled")).toBe(false);
    expect(failOnFirstErrorSwitch.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(failOnFirstErrorSwitch);
    expect(failOnFirstErrorSwitch.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles the Setup Assistant panel from the setup script action", async () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-agent",
          connectionId: "connection-agent",
          kind: "agent",
          config: {
            runtime: {
              runtimeId: "codex",
            },
          },
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

    fireEvent.click(
      screen.getByRole("button", {
        name: "Setup Assistant",
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: "Close Setup Assistant panel",
        }),
      ).toBeNull();
    });
  });

  it("disables setup script testing for empty and published scripts", () => {
    renderSandboxProfileEditor({
      bindings: [
        {
          id: "binding-agent",
          connectionId: "connection-agent",
          kind: "agent",
          config: {
            runtime: {
              runtimeId: "codex",
            },
          },
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
          targetKey: "codex",
          status: "active",
        },
      ],
      targets: [
        {
          targetKey: "codex",
          displayName: "Codex",
          familyId: "agent",
          variantId: "default",
          config: {},
          targetHealth: {
            configStatus: "valid",
          },
        },
      ],
    });

    expect(screen.getByText("Viewing: Published (v3)")).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "agent harness connection" })).toBeNull();
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

  it("surfaces saved draft automation impact warnings", () => {
    renderDraftActionsHarness({
      draftAutomationImpactAffectedAutomations: [
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

    const noticeTitle = screen.getByText(
      "Publishing this draft will break the following automations",
    );
    expect(noticeTitle).toBeDefined();
    expect(noticeTitle.closest('[role="tabpanel"]')).not.toBeNull();
    const webhookAutomationLink = screen.getByRole("link", { name: "Repository triage" });
    expect(webhookAutomationLink.getAttribute("href")).toBe(
      "/automations/webhook_repository_triage",
    );
    expect(webhookAutomationLink.getAttribute("target")).toBe("_blank");
    expect(webhookAutomationLink.getAttribute("rel")).toBe("noreferrer");

    const scheduledAutomationLink = screen.getByRole("link", { name: "Release notes" });
    expect(scheduledAutomationLink.getAttribute("href")).toBe(
      "/automations/schedules/sch_release_notes",
    );
    expect(scheduledAutomationLink.getAttribute("target")).toBe("_blank");
    expect(scheduledAutomationLink.getAttribute("rel")).toBe("noreferrer");
    expect(
      screen.getByText("This automation's webhook source connection is not bound in the draft."),
    ).toBeDefined();
    expect(
      screen.getByText("This automation's primary repository is not available in the draft."),
    ).toBeDefined();
  });

  it("shows failed draft automation checks as a dismissible notice", () => {
    renderDraftActionsHarness({
      draftAutomationImpactError: "Couldn't check whether this draft affects related automations.",
    });

    expect(screen.getByText("Automation checks failed")).toBeDefined();
    expect(
      screen.getByText("Couldn't check whether this draft affects related automations."),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText("Automation checks failed")).toBeNull();
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

  it("confirms profile deletion with automation usage context", () => {
    renderDeleteProfileDialogHarness({
      automationUsages: [
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
    expect(screen.getByText("These automations use this profile and will break:")).toBeDefined();
    expect(
      screen.getByText("They will stop working until you delete or retarget them."),
    ).toBeDefined();
  });

  it("blocks profile deletion while automation usage context is loading", () => {
    renderDeleteProfileDialogHarness({
      automationUsagesIsPending: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));

    expect(screen.getByText("Loading automations...")).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete profile" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
