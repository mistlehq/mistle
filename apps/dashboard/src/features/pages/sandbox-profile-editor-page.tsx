import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  InlineCode,
  Input,
  Label,
  MoreActionsMenu,
  Notice,
  NoticeAutoHideDurationsMs,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SectionBlock,
  TextLink,
} from "@mistle/ui";
import { SidebarSimpleIcon, SpinnerGapIcon, TerminalIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Key,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  type BlockerFunction,
} from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { listWebhookAutomationsForSandboxProfile } from "../automations/webhook-automations-service.js";
import type { WebhookAutomationSandboxProfileUsage } from "../automations/webhook-automations-types.js";
import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { NavigationBlockerDialog } from "../navigation/navigation-blocker-dialog.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileAutomationUsagesQueryKey,
  sandboxProfileDetailQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionSetupScriptQueryKey,
  sandboxProfileVersionsQueryKey,
  sandboxProvidersQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  createSandboxProfileVersionDraft,
  deleteSandboxProfile,
  discardSandboxProfileVersionDraft,
  getSandboxProfile,
  getSandboxProfileVersionDraftAutomationImpact,
  getSandboxProfileVersionPublishability,
  listSandboxProviders,
  listSandboxProfileVersions,
  publishSandboxProfileVersion,
  putSandboxProfileVersionDraft,
  refreshSandboxProfileVersion,
  retrySandboxProfileVersionPublishSnapshot,
  startSandboxProfileSetupAssistant,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type {
  SandboxIntegrationBindingKind,
  SandboxProfile,
  SandboxProfileVersionDraftAutomationImpactAutomation,
  SandboxProfileVersionDraftAutomationImpactIssue,
  SandboxProfileVersionDraftAutomationImpact,
  SandboxProfileVersion,
  SandboxProfileVersionIntegrationBinding,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  getOrganizationSandboxStorageSettings,
  organizationSandboxStorageSettingsQueryKey,
} from "../settings/organization/sandbox-storage-service.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { NoLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { SettingsSwitchField } from "../shared/settings-switch-field.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import {
  createSandboxBaseSetupScriptContextFromGeneratedInventory,
  resolveSandboxBaseRepositoryHandles,
  SetupScriptTimingDescription,
} from "./sandbox-base-inventory-copy.js";
import { SandboxProfileAutomationsSection } from "./sandbox-profile-automations-section.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  applyCreatedSandboxProfileVersionDraftToVersions,
  applyDiscardedSandboxProfileVersionDraftToVersions,
  applyPublishedSandboxProfileVersionToProfile,
  applyPublishedSandboxProfileVersionToVersions,
  resolveSandboxProfileEditorVersionMode,
  resolveSandboxProfileSetupScriptIntegrationRows,
  shouldPollSandboxProfileSnapshotJobs,
  shouldRedirectDraftSandboxProfileViewToPublished,
  type SandboxProfileEditorVersionMode,
  type SandboxProfileRouteView,
} from "./sandbox-profile-editor-page-model.js";
import {
  SandboxProfileEditorHorizontalTabContent,
  SandboxProfileEditorSections,
  type SandboxProfileEditorSection,
} from "./sandbox-profile-editor-sections.js";
import {
  SandboxProfileIntegrationsSetupSection,
  SandboxProfileIntegrationsSetupUnavailableState,
} from "./sandbox-profile-integrations-setup-section.js";
import {
  useLoadedSandboxProfileIntegrationsState,
  useSandboxProfileIntegrationsLoader,
} from "./sandbox-profile-integrations-state.js";
import {
  useCreateSandboxProfileMetaState,
  useEditSandboxProfileMetaState,
} from "./sandbox-profile-meta-state.js";
import {
  SandboxProfileRuntimeSection,
  type SandboxProfileRuntimeDraftChanges,
  type SandboxProfileRuntimeDraftState,
} from "./sandbox-profile-runtime-section.js";
import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";
import {
  useLoadedSandboxProfileSetupScriptState,
  useSandboxProfileSetupScriptLoader,
} from "./sandbox-profile-setup-script-state.js";
import {
  SandboxProfileSetupScriptTestButton,
  SandboxProfileSetupScriptTestPanel,
  useSandboxProfileSetupScriptTestRun,
} from "./sandbox-profile-setup-script-test.js";
import {
  SandboxProfileSnapshotPanel,
  resolveSnapshotPanelState,
  type SnapshotPanelState,
} from "./sandbox-profile-snapshot-panel.js";
import { SandboxSetupScriptEditor } from "./sandbox-setup-script-editor.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  SessionConversationBottomPanelController,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import type { PendingSessionDiffComment } from "./session-diff-comment.js";
import { SessionStartupStatus } from "./session-startup-status.js";
import {
  SessionTerminalWorkspace,
  type SessionTerminalWorkspaceHandle,
} from "./session-terminal-workspace.js";
import {
  buildSetupAssistantCollaborationModeSettings,
  buildSetupAssistantInitialComposerText,
} from "./setup-assistant-instructions.js";
import { useSessionWorkbenchController } from "./use-session-workbench-controller.js";

type SandboxProfileEditorPageProps =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
    };

type SandboxProfileEditorSectionId = "sandbox-profile" | "automations" | "snapshot";
type SandboxProfileEditorNavigationState = {
  notice: "publish-success" | null;
};
type SandboxProfileDraftSectionState = {
  hasUnpersistedChanges: boolean;
  applyDraftSaveError?: (error: unknown) => void;
  applySavedBindings?: (bindings: readonly SandboxProfileVersionIntegrationBinding[]) => void;
  applySavedSetupScript?: (setupScript: string | null) => void;
  buildDraftChanges?: () => string | null;
  buildIntegrationBindingChanges?: () => Array<{
    id?: string;
    clientRef?: string;
    connectionId: string;
    kind: SandboxIntegrationBindingKind;
    config: Record<string, unknown>;
  }> | null;
  integrationRows?: readonly SandboxProfileBindingEditorRow[] | null;
};
type SandboxProfilePersistenceDraftState = {
  hasUnpersistedChanges: boolean;
  applyDraftSaveError?: (error: unknown) => void;
  applySavedPersistenceMode?: (
    defaultPersistenceMode: SandboxProfileVersion["defaultPersistenceMode"],
  ) => void;
  buildDraftChanges?: () => SandboxProfileVersion["defaultPersistenceMode"];
};
type SandboxProfileRuntimeSettingsDraftState = SandboxProfileRuntimeDraftState;
type SetupScriptAssistantControl = {
  disabled: boolean;
  errorMessage: string | null;
  isStarting: boolean;
  onToggle: (input: { setupScript: string }) => void;
  title: string;
};
type SetupScriptAssistantPanelState = {
  initialComposerText: string;
  isOpen: boolean;
  sandboxInstanceId: string | null;
};

function createIdleSandboxProfileDraftSectionState(): SandboxProfileDraftSectionState {
  return {
    hasUnpersistedChanges: false,
  };
}

function createIdleSandboxProfilePersistenceDraftState(): SandboxProfilePersistenceDraftState {
  return {
    hasUnpersistedChanges: false,
  };
}

function createIdleSandboxProfileRuntimeDraftState(): SandboxProfileRuntimeSettingsDraftState {
  return {
    hasUnpersistedChanges: false,
  };
}

const AgentRuntimeRequiredErrorCode = "AGENT_RUNTIME_REQUIRED";
const SetupAssistantAgentRuntimeRequiredMessage =
  "Add an agent integration before using Setup Assistant.";

function hasConfiguredAgentRuntime(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  if (!("runtimeId" in value)) {
    return false;
  }

  return typeof value.runtimeId === "string" && value.runtimeId.trim().length > 0;
}

function hasSetupAssistantAgentRuntime(
  integrationRows: readonly SandboxProfileBindingEditorRow[] | null,
): boolean {
  if (integrationRows === null) {
    return false;
  }

  return integrationRows.some(
    (row) => row.kind === "agent" && hasConfiguredAgentRuntime(row.config["runtime"]),
  );
}

const SetupScriptPlaceholder = `#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap`;

const SandboxProfileEditorSectionIds = {
  SANDBOX_PROFILE: "sandbox-profile",
  AUTOMATIONS: "automations",
  SNAPSHOT: "snapshot",
} satisfies Record<string, SandboxProfileEditorSectionId>;
const PublishSuccessNavigationState: SandboxProfileEditorNavigationState = {
  notice: "publish-success",
};

function createSandboxProfileDefaultPath(profileId: string): string {
  return `/sandbox-profiles/${profileId}/sandbox-profile`;
}

function createSandboxProfileEditorPath(input: {
  profileId: string;
  view?: SandboxProfileRouteView;
}): string {
  return input.view === undefined
    ? createSandboxProfileDefaultPath(input.profileId)
    : `/sandbox-profiles/${input.profileId}/sandbox-profile/${input.view}`;
}

function createSandboxProfileSnapshotsPath(profileId: string): string {
  return `/sandbox-profiles/${profileId}/snapshots`;
}

function createSandboxProfileAutomationsPath(profileId: string): string {
  return `/sandbox-profiles/${profileId}/automations`;
}

function pathnameMatchesPathOrChild(input: { basePath: string; pathname: string }): boolean {
  return input.pathname === input.basePath || input.pathname.startsWith(`${input.basePath}/`);
}

function createSandboxProfileTabPath(input: {
  profileId: string;
  sectionId: SandboxProfileEditorSectionId;
  view?: SandboxProfileRouteView;
}): string {
  if (input.sectionId === SandboxProfileEditorSectionIds.SNAPSHOT) {
    return createSandboxProfileSnapshotsPath(input.profileId);
  }

  if (input.sectionId === SandboxProfileEditorSectionIds.AUTOMATIONS) {
    return createSandboxProfileAutomationsPath(input.profileId);
  }

  return createSandboxProfileEditorPath({
    profileId: input.profileId,
    ...(input.view === undefined ? {} : { view: input.view }),
  });
}

function resolveLatestPublishedSandboxProfileVersion(
  versions: readonly SandboxProfileVersion[],
): SandboxProfileVersion | null {
  const publishedVersions = versions.filter((version) => version.state === "published");

  return publishedVersions.length === 0
    ? null
    : publishedVersions.reduce((latestVersion, currentVersion) =>
        currentVersion.version > latestVersion.version ? currentVersion : latestVersion,
      );
}

function readSandboxProfileEditorNavigationState(
  value: unknown,
): SandboxProfileEditorNavigationState {
  if (typeof value !== "object" || value === null) {
    return {
      notice: null,
    };
  }

  const notice = Reflect.get(value, "notice");

  return {
    notice: notice === "publish-success" ? notice : null,
  };
}

function readSandboxProfileEditorSectionPathSegment(input: {
  pathname: string;
  profileId: string;
}): SandboxProfileEditorSectionId | null {
  if (
    pathnameMatchesPathOrChild({
      basePath: createSandboxProfileDefaultPath(input.profileId),
      pathname: input.pathname,
    })
  ) {
    return SandboxProfileEditorSectionIds.SANDBOX_PROFILE;
  }

  if (input.pathname === createSandboxProfileSnapshotsPath(input.profileId)) {
    return SandboxProfileEditorSectionIds.SNAPSHOT;
  }

  if (
    pathnameMatchesPathOrChild({
      basePath: createSandboxProfileAutomationsPath(input.profileId),
      pathname: input.pathname,
    })
  ) {
    return SandboxProfileEditorSectionIds.AUTOMATIONS;
  }

  return null;
}

function readSandboxProfileEditorRoute(input: {
  pathname: string;
  profileId: string;
}): { sectionId: SandboxProfileEditorSectionId; view?: SandboxProfileRouteView } | null {
  const sandboxProfilePath = createSandboxProfileDefaultPath(input.profileId);
  if (input.pathname === sandboxProfilePath) {
    return {
      sectionId: SandboxProfileEditorSectionIds.SANDBOX_PROFILE,
    };
  }

  if (input.pathname === `${sandboxProfilePath}/draft`) {
    return {
      sectionId: SandboxProfileEditorSectionIds.SANDBOX_PROFILE,
      view: "draft",
    };
  }

  if (input.pathname === `${sandboxProfilePath}/published`) {
    return {
      sectionId: SandboxProfileEditorSectionIds.SANDBOX_PROFILE,
      view: "published",
    };
  }

  if (input.pathname === createSandboxProfileSnapshotsPath(input.profileId)) {
    return {
      sectionId: SandboxProfileEditorSectionIds.SNAPSHOT,
    };
  }

  if (
    pathnameMatchesPathOrChild({
      basePath: createSandboxProfileAutomationsPath(input.profileId),
      pathname: input.pathname,
    })
  ) {
    return {
      sectionId: SandboxProfileEditorSectionIds.AUTOMATIONS,
    };
  }

  return null;
}

function shouldBlockSandboxProfileEditorUnpersistedChangesNavigation(input: {
  profileId: string;
  currentPathname: string;
  nextPathname: string;
}): boolean {
  const currentSectionId = readSandboxProfileEditorSectionPathSegment({
    pathname: input.currentPathname,
    profileId: input.profileId,
  });
  const nextSectionId = readSandboxProfileEditorSectionPathSegment({
    pathname: input.nextPathname,
    profileId: input.profileId,
  });

  return currentSectionId === null || nextSectionId === null;
}

function resolveDefaultSandboxProfileEditorView(
  versions: readonly SandboxProfileVersion[],
): SandboxProfileRouteView {
  return versions.some((version) => version.state === "published") ? "published" : "draft";
}

function shouldRedirectPublishedSandboxProfileViewToDraft(input: {
  versions: readonly SandboxProfileVersion[];
}): boolean {
  const hasDraftVersion = input.versions.some((version) => version.state === "draft");
  const hasPublishedVersion = input.versions.some((version) => version.state === "published");

  return hasDraftVersion && !hasPublishedVersion;
}

export function SandboxProfileEditorPage(props: SandboxProfileEditorPageProps): React.JSX.Element {
  if (props.mode === "create") {
    return <CreateSandboxProfileEditorPage />;
  }

  return <EditSandboxProfileEditorPage />;
}

function CreateSandboxProfileEditorPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const breadcrumbs = useAppPageBreadcrumbs();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { title, description } = resolvePageFrameText(pageMeta, "Create");
  const metaState = useCreateSandboxProfileMetaState({
    navigate,
    invalidateSandboxProfiles: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["sandbox-profiles"],
      });
    },
  });

  function handleCreateProfileSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    metaState.onCreate();
  }

  return (
    <PageFrame breadcrumbs={breadcrumbs} description={description} title={title} width="form">
      <div className="gap-4 flex flex-col">
        {metaState.saveError ? (
          <Notice title="Create failed" variant="alert">
            {metaState.saveError}
          </Notice>
        ) : null}

        <Card>
          <CardContent className="pt-4">
            <form className="gap-4 flex flex-col" onSubmit={handleCreateProfileSubmit}>
              <Field>
                <FieldLabel htmlFor="sandbox-profile-display-name">
                  <span className="inline-flex items-center gap-0.5">
                    Profile Name
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </span>
                </FieldLabel>
                <FieldContent>
                  <Input
                    className="w-full max-w-2xl"
                    id="sandbox-profile-display-name"
                    onChange={(event) => {
                      metaState.onDisplayNameChange(event.currentTarget.value);
                    }}
                    value={metaState.formState.displayName}
                  />
                </FieldContent>
              </Field>

              <div className="gap-2 flex">
                <Button
                  disabled={metaState.isDisplayNameInvalid || metaState.isCreating}
                  type="submit"
                >
                  {metaState.isCreating ? "Creating..." : "Create profile"}
                </Button>
                <Button onClick={metaState.onCancelCreate} type="button" variant="outline">
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageFrame>
  );
}

type SandboxProfileEditorShellContext = {
  profileId: string;
  profile: SandboxProfile;
  versions: readonly SandboxProfileVersion[];
  navigate: ReturnType<typeof useNavigate>;
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
};

export function SandboxProfileEditorShell(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const profileId = params["profileId"];

  if (profileId === undefined) {
    throw new Error("profileId is required.");
  }

  const profileDetailKey = sandboxProfileDetailQueryKey(profileId);
  const profileVersionsKey = sandboxProfileVersionsQueryKey(profileId);
  const shouldPollCachedSnapshotJobs = (): false | number =>
    shouldPollSandboxProfileSnapshotJobs(
      queryClient.getQueryData<{ versions: readonly SandboxProfileVersion[] }>(profileVersionsKey)
        ?.versions,
    )
      ? 3_000
      : false;

  const profileQuery = useQuery({
    queryKey: profileDetailKey,
    queryFn: async ({ signal }) => getSandboxProfile({ profileId, signal }),
    refetchInterval: shouldPollCachedSnapshotJobs,
    retry: false,
  });
  const profileVersionsQuery = useQuery({
    queryKey: profileVersionsKey,
    queryFn: async ({ signal }) =>
      listSandboxProfileVersions({
        profileId,
        signal,
      }),
    refetchInterval: shouldPollCachedSnapshotJobs,
    retry: false,
  });

  if (profileQuery.isPending || profileVersionsQuery.isPending) {
    return <PageFrame width="normal">{null}</PageFrame>;
  }

  if (profileQuery.isError || profileQuery.data === undefined) {
    const isNotFoundError =
      profileQuery.error instanceof SandboxProfilesApiError && profileQuery.error.status === 404;

    return (
      <PageFrame width="normal" title="Edit profile">
        <Card>
          <CardContent className="gap-3 flex flex-col pt-4">
            <Notice
              title={isNotFoundError ? "Sandbox profile not found" : "Could not load profile"}
              variant="alert"
            >
              {resolveApiErrorMessage({
                error: profileQuery.error,
                fallbackMessage: isNotFoundError
                  ? "The sandbox profile was not found."
                  : "Could not load sandbox profile.",
              })}
            </Notice>
            <div>
              <Button
                onClick={() => {
                  void navigate("/sandbox-profiles");
                }}
                type="button"
                variant="outline"
              >
                Back to profiles
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageFrame>
    );
  }

  if (profileVersionsQuery.isError || profileVersionsQuery.data === undefined) {
    return (
      <PageFrame width="normal" title="Edit profile">
        <Notice title="Could not load profile versions" variant="alert">
          {resolveApiErrorMessage({
            error: profileVersionsQuery.error,
            fallbackMessage: "Could not load sandbox profile versions.",
          })}
        </Notice>
      </PageFrame>
    );
  }

  return (
    <Outlet
      context={
        {
          profileId,
          profile: profileQuery.data,
          versions: profileVersionsQuery.data.versions,
          navigate,
          invalidateSandboxProfiles: async () => {
            await queryClient.invalidateQueries({
              queryKey: ["sandbox-profiles"],
            });
          },
          invalidateProfileDetail: async (invalidateProfileId) => {
            await queryClient.invalidateQueries({
              queryKey: sandboxProfileDetailQueryKey(invalidateProfileId),
            });
          },
          invalidateProfileVersions: async (invalidateProfileId) => {
            await queryClient.invalidateQueries({
              queryKey: sandboxProfileVersionsQueryKey(invalidateProfileId),
            });
          },
          invalidateVersionBindings: async ({ profileId: invalidateProfileId, version }) => {
            await queryClient.invalidateQueries({
              queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
                profileId: invalidateProfileId,
                version,
              }),
            });
          },
          invalidateVersionSetupScript: async ({ profileId: invalidateProfileId, version }) => {
            await queryClient.invalidateQueries({
              queryKey: sandboxProfileVersionSetupScriptQueryKey({
                profileId: invalidateProfileId,
                version,
              }),
            });
          },
        } satisfies SandboxProfileEditorShellContext
      }
    />
  );
}

export function SandboxProfileDefaultRedirect(): React.JSX.Element {
  const shellContext = useSandboxProfileEditorShellContext();

  return <Navigate replace to={createSandboxProfileDefaultPath(shellContext.profileId)} />;
}

function useSandboxProfileEditorShellContext(): SandboxProfileEditorShellContext {
  return useOutletContext<SandboxProfileEditorShellContext>();
}

function EditSandboxProfileEditorPage(): React.JSX.Element {
  const shellContext = useSandboxProfileEditorShellContext();
  const location = useLocation();
  const navigationState = readSandboxProfileEditorNavigationState(location.state);
  const route = readSandboxProfileEditorRoute({
    pathname: location.pathname,
    profileId: shellContext.profileId,
  });
  const publishSuccessMessage = navigationState.notice === "publish-success";
  const navigate = shellContext.navigate;
  const routeView = route?.view ?? resolveDefaultSandboxProfileEditorView(shellContext.versions);
  const onPublishSuccessNavigationConsumed = useCallback(() => {
    void navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
  }, [location.pathname, location.search, navigate]);

  if (route === null) {
    return <Navigate replace to={createSandboxProfileDefaultPath(shellContext.profileId)} />;
  }

  return (
    <LoadedSandboxProfileEditorPage
      routeSectionId={route.sectionId}
      publishSuccessNavigationKey={publishSuccessMessage ? location.key : null}
      onPublishSuccessNavigationConsumed={onPublishSuccessNavigationConsumed}
      publishSuccessMessage={publishSuccessMessage}
      explicitView={route.view}
      view={routeView}
      navigate={shellContext.navigate}
      profileId={shellContext.profileId}
      profile={shellContext.profile}
      versions={shellContext.versions}
      invalidateSandboxProfiles={shellContext.invalidateSandboxProfiles}
      invalidateProfileDetail={shellContext.invalidateProfileDetail}
      invalidateProfileVersions={shellContext.invalidateProfileVersions}
      invalidateVersionBindings={shellContext.invalidateVersionBindings}
      invalidateVersionSetupScript={shellContext.invalidateVersionSetupScript}
    />
  );
}

type LoadedSandboxProfileEditorPageInput = {
  navigate: ReturnType<typeof useNavigate>;
  routeSectionId: SandboxProfileEditorSectionId;
  publishSuccessNavigationKey: string | null;
  onPublishSuccessNavigationConsumed: () => void;
  publishSuccessMessage: boolean;
  explicitView: SandboxProfileRouteView | undefined;
  profileId: string;
  profile: SandboxProfile;
  versions: readonly SandboxProfileVersion[];
  view: SandboxProfileRouteView;
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
};

async function clearSandboxProfileVersionDraftQueryState(input: {
  queryClient: QueryClient;
  profileId: string;
  version: number;
}): Promise<void> {
  const queryKeys = [
    sandboxProfileVersionIntegrationBindingsQueryKey({
      profileId: input.profileId,
      version: input.version,
    }),
    sandboxProfileVersionSetupScriptQueryKey({
      profileId: input.profileId,
      version: input.version,
    }),
  ];

  await Promise.all(
    queryKeys.map((queryKey) =>
      input.queryClient.cancelQueries({
        exact: true,
        queryKey,
      }),
    ),
  );

  for (const queryKey of queryKeys) {
    input.queryClient.removeQueries({
      exact: true,
      queryKey,
    });
  }
}

function LoadedSandboxProfileEditorPage(
  input: LoadedSandboxProfileEditorPageInput,
): React.JSX.Element {
  const queryClient = useQueryClient();
  const [versionActionError, setVersionActionError] = useState<string | null>(null);
  const [isDeleteProfileDialogOpen, setIsDeleteProfileDialogOpen] = useState(false);
  const [deleteProfileError, setDeleteProfileError] = useState<string | null>(null);
  const [draftEditorResetKey, setDraftEditorResetKey] = useState(0);
  const automationUsagesQuery = useQuery({
    queryKey: sandboxProfileAutomationUsagesQueryKey(input.profileId),
    queryFn: async ({ signal }) =>
      listWebhookAutomationsForSandboxProfile({
        sandboxProfileId: input.profileId,
        signal,
      }),
    enabled: isDeleteProfileDialogOpen,
    retry: false,
  });
  const createDraftMutation = useMutation({
    mutationFn: async () =>
      createSandboxProfileVersionDraft({
        profileId: input.profileId,
      }),
    onSuccess: async (draftVersion) => {
      setVersionActionError(null);
      await clearSandboxProfileVersionDraftQueryState({
        queryClient,
        profileId: input.profileId,
        version: draftVersion.version,
      });
      queryClient.setQueryData<{ versions: readonly SandboxProfileVersion[] } | undefined>(
        sandboxProfileVersionsQueryKey(input.profileId),
        (currentVersions) => ({
          versions: applyCreatedSandboxProfileVersionDraftToVersions({
            versions: currentVersions?.versions,
            draftVersion,
          }),
        }),
      );
      void input.navigate(
        createSandboxProfileEditorPath({
          profileId: input.profileId,
          view: "draft",
        }),
      );
      void Promise.all([
        input.invalidateProfileVersions(input.profileId),
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
      ]);
    },
    onError: (error: unknown) => {
      setVersionActionError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create sandbox profile draft.",
        }),
      );
    },
  });
  const publishMutation = useMutation({
    mutationFn: async (version: number) => {
      const publishability = await getSandboxProfileVersionPublishability({
        profileId: input.profileId,
        version,
      });

      if (!publishability.publishable) {
        const firstIssue = publishability.issues[0];
        throw new Error(firstIssue?.message ?? "Sandbox profile draft cannot be published.");
      }

      return publishSandboxProfileVersion({
        profileId: input.profileId,
        version,
      });
    },
    onSuccess: async (result) => {
      setVersionActionError(null);
      queryClient.setQueryData<SandboxProfile | undefined>(
        sandboxProfileDetailQueryKey(input.profileId),
        (currentProfile) =>
          applyPublishedSandboxProfileVersionToProfile({
            profile: currentProfile,
            result,
          }),
      );
      queryClient.setQueryData<{ versions: readonly SandboxProfileVersion[] } | undefined>(
        sandboxProfileVersionsQueryKey(input.profileId),
        (currentVersions) => {
          const nextVersions = applyPublishedSandboxProfileVersionToVersions({
            versions: currentVersions?.versions,
            result,
          });

          return nextVersions === undefined ? currentVersions : { versions: nextVersions };
        },
      );
      void input.navigate(createSandboxProfileSnapshotsPath(input.profileId), {
        state: PublishSuccessNavigationState,
      });

      void Promise.all([
        input.invalidateProfileVersions(input.profileId),
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
        input.invalidateVersionBindings({
          profileId: input.profileId,
          version: result.version.version,
        }),
        input.invalidateVersionSetupScript({
          profileId: input.profileId,
          version: result.version.version,
        }),
      ]);
    },
    onError: (error: unknown) => {
      setVersionActionError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not publish sandbox profile draft.",
        }),
      );
    },
  });
  const discardDraftMutation = useMutation({
    mutationFn: async (inputValue: { draftVersion: number }) =>
      discardSandboxProfileVersionDraft({
        profileId: input.profileId,
        version: inputValue.draftVersion,
      }),
    onSuccess: async (result, inputValue) => {
      setVersionActionError(null);
      await clearSandboxProfileVersionDraftQueryState({
        queryClient,
        profileId: input.profileId,
        version: result.discardedVersion,
      });
      if (inputValue.draftVersion !== result.discardedVersion) {
        await clearSandboxProfileVersionDraftQueryState({
          queryClient,
          profileId: input.profileId,
          version: inputValue.draftVersion,
        });
      }
      setDraftEditorResetKey((currentKey) => currentKey + 1);
      queryClient.setQueryData<{ versions: readonly SandboxProfileVersion[] } | undefined>(
        sandboxProfileVersionsQueryKey(input.profileId),
        (currentVersions) => {
          const nextVersions = applyDiscardedSandboxProfileVersionDraftToVersions({
            versions: currentVersions?.versions,
            discardedVersion: result.discardedVersion,
          });

          return nextVersions === undefined ? currentVersions : { versions: nextVersions };
        },
      );
      void input.navigate(
        createSandboxProfileEditorPath({
          profileId: input.profileId,
          view: "published",
        }),
      );
      void Promise.all([
        input.invalidateProfileVersions(input.profileId),
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
      ]);
    },
    onError: (error: unknown) => {
      setVersionActionError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not discard draft changes.",
        }),
      );
    },
  });
  const refreshSnapshotMutation = useMutation({
    mutationFn: async (version: number) =>
      refreshSandboxProfileVersion({
        profileId: input.profileId,
        version,
      }),
    onSuccess: async (result) => {
      setVersionActionError(null);
      queryClient.setQueryData<SandboxProfile | undefined>(
        sandboxProfileDetailQueryKey(input.profileId),
        (currentProfile) =>
          applyPublishedSandboxProfileVersionToProfile({
            profile: currentProfile,
            result,
          }),
      );
      queryClient.setQueryData<{ versions: readonly SandboxProfileVersion[] } | undefined>(
        sandboxProfileVersionsQueryKey(input.profileId),
        (currentVersions) => {
          const nextVersions = applyPublishedSandboxProfileVersionToVersions({
            versions: currentVersions?.versions,
            result,
          });

          return nextVersions === undefined ? currentVersions : { versions: nextVersions };
        },
      );
      void Promise.all([
        input.invalidateProfileVersions(input.profileId),
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
      ]);
    },
    onError: (error: unknown) => {
      setVersionActionError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not refresh sandbox profile snapshot.",
        }),
      );
    },
  });
  const retryPublishSnapshotMutation = useMutation({
    mutationFn: async (version: number) =>
      retrySandboxProfileVersionPublishSnapshot({
        profileId: input.profileId,
        version,
      }),
    onSuccess: async (result) => {
      setVersionActionError(null);
      queryClient.setQueryData<SandboxProfile | undefined>(
        sandboxProfileDetailQueryKey(input.profileId),
        (currentProfile) =>
          applyPublishedSandboxProfileVersionToProfile({
            profile: currentProfile,
            result,
          }),
      );
      queryClient.setQueryData<{ versions: readonly SandboxProfileVersion[] } | undefined>(
        sandboxProfileVersionsQueryKey(input.profileId),
        (currentVersions) => {
          const nextVersions = applyPublishedSandboxProfileVersionToVersions({
            versions: currentVersions?.versions,
            result,
          });

          return nextVersions === undefined ? currentVersions : { versions: nextVersions };
        },
      );
      void Promise.all([
        input.invalidateProfileVersions(input.profileId),
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
      ]);
    },
    onError: (error: unknown) => {
      setVersionActionError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not retry sandbox profile snapshot creation.",
        }),
      );
    },
  });
  const deleteProfileMutation = useMutation({
    mutationFn: async () =>
      deleteSandboxProfile({
        profileId: input.profileId,
      }),
    onSuccess: async () => {
      setDeleteProfileError(null);
      setIsDeleteProfileDialogOpen(false);
      await Promise.all([
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
      ]);
      void input.navigate("/sandbox-profiles");
    },
    onError: (error: unknown) => {
      setDeleteProfileError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not delete sandbox profile.",
        }),
      );
    },
  });
  const onPublishSuccessNavigationConsumed = useCallback(() => {
    input.onPublishSuccessNavigationConsumed();
  }, [input.onPublishSuccessNavigationConsumed]);

  if (
    input.view === "published" &&
    shouldRedirectPublishedSandboxProfileViewToDraft({
      versions: input.versions,
    })
  ) {
    return (
      <Navigate
        replace
        to={createSandboxProfileEditorPath({
          profileId: input.profileId,
          view: "draft",
        })}
      />
    );
  }

  if (
    input.view === "draft" &&
    shouldRedirectDraftSandboxProfileViewToPublished({
      versions: input.versions,
    })
  ) {
    return (
      <Navigate
        replace
        to={createSandboxProfileEditorPath({
          profileId: input.profileId,
          view: "published",
        })}
      />
    );
  }

  const resolvedMode = resolveSandboxProfileEditorVersionMode({
    activeVersion: input.profile.activeVersion,
    versions: input.versions,
    view: input.view,
  });

  if (!resolvedMode.ok) {
    return (
      <PageFrame title="Edit profile" width="normal">
        <Notice title="Could not load profile version" variant="alert">
          {resolvedMode.message}
        </Notice>
      </PageFrame>
    );
  }

  return (
    <ReadySandboxProfileEditorPage
      currentVersion={
        input.versions.find((version) => version.version === resolvedMode.mode.version) ?? null
      }
      draftEditorResetKey={draftEditorResetKey}
      mode={resolvedMode.mode}
      navigate={input.navigate}
      onMakeChanges={() => {
        createDraftMutation.mutate();
      }}
      onDiscardChangesAndLeaveDraft={(inputValue) => {
        discardDraftMutation.mutate(inputValue);
      }}
      onPublish={async (version) => {
        await publishMutation.mutateAsync(version);
      }}
      onRefreshSnapshot={(version) => {
        refreshSnapshotMutation.mutate(version);
      }}
      onRetryPublishSnapshot={(version) => {
        retryPublishSnapshotMutation.mutate(version);
      }}
      routeSectionId={input.routeSectionId}
      publishSuccessNavigationKey={input.publishSuccessNavigationKey}
      onPublishSuccessNavigationConsumed={onPublishSuccessNavigationConsumed}
      publishSuccessMessage={input.publishSuccessMessage}
      explicitRouteView={input.explicitView}
      routeView={input.view}
      onViewActive={() => {
        setVersionActionError(null);
        void input.navigate(
          createSandboxProfileEditorPath({
            profileId: input.profileId,
            view: "published",
          }),
        );
      }}
      onViewDraft={() => {
        setVersionActionError(null);
        void input.navigate(
          createSandboxProfileEditorPath({
            profileId: input.profileId,
            view: "draft",
          }),
        );
      }}
      profile={input.profile}
      profileId={input.profileId}
      versions={input.versions}
      deleteProfileAutomationUsages={automationUsagesQuery.data ?? []}
      deleteProfileAutomationUsagesError={
        automationUsagesQuery.isError
          ? resolveApiErrorMessage({
              error: automationUsagesQuery.error,
              fallbackMessage: "Could not load automations.",
            })
          : null
      }
      deleteProfileAutomationUsagesIsPending={
        isDeleteProfileDialogOpen && automationUsagesQuery.isPending
      }
      deleteProfileError={deleteProfileError}
      deleteProfileIsPending={deleteProfileMutation.isPending}
      isDeleteProfileDialogOpen={isDeleteProfileDialogOpen}
      onConfirmDeleteProfile={() => {
        if (automationUsagesQuery.isPending || automationUsagesQuery.isError) {
          return;
        }
        deleteProfileMutation.mutate();
      }}
      onDeleteProfileDialogOpenChange={(open) => {
        if (deleteProfileMutation.isPending) {
          return;
        }
        setDeleteProfileError(null);
        setIsDeleteProfileDialogOpen(open);
      }}
      versionActionError={versionActionError}
      versionActionIsPending={
        publishMutation.isPending ||
        createDraftMutation.isPending ||
        discardDraftMutation.isPending ||
        refreshSnapshotMutation.isPending ||
        retryPublishSnapshotMutation.isPending
      }
      invalidateSandboxProfiles={input.invalidateSandboxProfiles}
      invalidateProfileDetail={input.invalidateProfileDetail}
      invalidateProfileVersions={input.invalidateProfileVersions}
      invalidateVersionBindings={input.invalidateVersionBindings}
      invalidateVersionSetupScript={input.invalidateVersionSetupScript}
    />
  );
}

function ReadySandboxProfileEditorPage(input: {
  navigate: ReturnType<typeof useNavigate>;
  profileId: string;
  profile: SandboxProfile;
  mode: SandboxProfileEditorVersionMode;
  currentVersion: SandboxProfileVersion | null;
  draftEditorResetKey: number;
  versions: readonly SandboxProfileVersion[];
  routeSectionId: SandboxProfileEditorSectionId;
  publishSuccessNavigationKey: string | null;
  onPublishSuccessNavigationConsumed: () => void;
  publishSuccessMessage: boolean;
  explicitRouteView: SandboxProfileRouteView | undefined;
  routeView: SandboxProfileRouteView;
  versionActionError: string | null;
  versionActionIsPending: boolean;
  deleteProfileAutomationUsages: readonly WebhookAutomationSandboxProfileUsage[];
  deleteProfileAutomationUsagesError: string | null;
  deleteProfileAutomationUsagesIsPending: boolean;
  deleteProfileError: string | null;
  deleteProfileIsPending: boolean;
  isDeleteProfileDialogOpen: boolean;
  onPublish: (version: number) => Promise<void>;
  onRefreshSnapshot: (version: number) => void;
  onRetryPublishSnapshot: (version: number) => void;
  onDiscardChangesAndLeaveDraft: (input: { draftVersion: number }) => void;
  onConfirmDeleteProfile: () => void;
  onDeleteProfileDialogOpenChange: (open: boolean) => void;
  onMakeChanges: () => void;
  onViewActive: () => void;
  onViewDraft: () => void;
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
}): React.JSX.Element {
  const integrationsLoader = useSandboxProfileIntegrationsLoader({
    profileId: input.profileId,
    version: input.mode.version,
  });
  const setupScriptLoader = useSandboxProfileSetupScriptLoader({
    profileId: input.profileId,
    version: input.mode.version,
  });
  const [integrationDraftState, setIntegrationDraftState] = useState(
    createIdleSandboxProfileDraftSectionState,
  );
  const [setupScriptDraftState, setSetupScriptDraftState] = useState(
    createIdleSandboxProfileDraftSectionState,
  );
  const [persistenceDraftState, setPersistenceDraftState] = useState(
    createIdleSandboxProfilePersistenceDraftState,
  );
  const [runtimeDraftState, setRuntimeDraftState] = useState(
    createIdleSandboxProfileRuntimeDraftState,
  );
  const [publishRequestIsPending, setPublishRequestIsPending] = useState(false);
  const [saveDraftRequestIsPending, setSaveDraftRequestIsPending] = useState(false);
  const [publishFlushError, setPublishFlushError] = useState<string | null>(null);
  const [draftAutomationImpactAffectedAutomations, setDraftAutomationImpactAffectedAutomations] =
    useState<readonly SandboxProfileVersionDraftAutomationImpactAutomation[] | null>(null);
  const [draftAutomationImpactError, setDraftAutomationImpactError] = useState<string | null>(null);
  const [setupAssistantError, setSetupAssistantError] = useState<string | null>(null);
  const [publishSuccessNoticeKey, setPublishSuccessNoticeKey] = useState(0);
  const [showPublishSuccessMessage, setShowPublishSuccessMessage] = useState(
    input.publishSuccessMessage,
  );
  const [setupAssistantPanelState, setSetupAssistantPanelState] =
    useState<SetupScriptAssistantPanelState | null>(null);
  const activeSectionId = input.routeSectionId;
  const draftFieldsAreReadOnly =
    input.mode.kind !== "draft" || publishRequestIsPending || saveDraftRequestIsPending;
  const snapshotVersion = resolveLatestPublishedSandboxProfileVersion(input.versions);
  const snapshotPanelState = resolveSnapshotPanelState(
    snapshotVersion,
    input.profile.activeVersion,
  );
  const editorSections = SandboxProfileEditorTabs;
  const setupAssistantIntegrationRows = resolveSandboxProfileSetupScriptIntegrationRows(
    integrationsLoader.initialRows,
    integrationDraftState.integrationRows,
  );
  const setupAssistantHasAgentRuntime =
    input.mode.kind === "draft" && hasSetupAssistantAgentRuntime(setupAssistantIntegrationRows);
  const metaState = useEditSandboxProfileMetaState({
    profileId: input.profileId,
    loadedProfile: input.profile,
    navigate: input.navigate,
    invalidateSandboxProfiles: input.invalidateSandboxProfiles,
    invalidateProfileDetail: input.invalidateProfileDetail,
  });
  const shouldBlockUnpersistedChangesNavigation = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      shouldBlockSandboxProfileEditorUnpersistedChangesNavigation({
        profileId: input.profileId,
        currentPathname: currentLocation.pathname,
        nextPathname: nextLocation.pathname,
      }),
    [input.profileId],
  );
  const startSetupAssistantMutation = useMutation({
    meta: NoLoadingIndicatorMeta,
    mutationFn: async () =>
      startSandboxProfileSetupAssistant({
        idempotencyKey: crypto.randomUUID(),
        profileId: input.profileId,
        version: input.mode.version,
      }),
    onSuccess: (result) => {
      setSetupAssistantError(null);
      setSetupAssistantPanelState((currentState) => {
        if (currentState === null) {
          return currentState;
        }

        return {
          ...currentState,
          sandboxInstanceId: result.sandboxInstanceId,
        };
      });
    },
    onError: (error: unknown) => {
      setSetupAssistantPanelState((currentState) =>
        currentState === null
          ? currentState
          : {
              ...currentState,
              isOpen: false,
            },
      );
      setSetupAssistantError(
        error instanceof SandboxProfilesApiError && error.code === AgentRuntimeRequiredErrorCode
          ? SetupAssistantAgentRuntimeRequiredMessage
          : resolveApiErrorMessage({
              error,
              fallbackMessage: "Could not start Setup Assistant.",
            }),
      );
    },
  });
  const setupAssistantDisabledReason =
    input.mode.kind !== "draft"
      ? "Setup Assistant is only available while editing a draft."
      : setupAssistantIntegrationRows === null
        ? "Integration bindings are still loading."
        : !setupAssistantHasAgentRuntime
          ? SetupAssistantAgentRuntimeRequiredMessage
          : draftFieldsAreReadOnly
            ? "Setup Assistant is unavailable while draft changes are saving."
            : startSetupAssistantMutation.isPending
              ? "Setup Assistant is starting."
              : null;
  const setupAssistantPanelIsOpen = setupAssistantPanelState?.isOpen === true;
  const setupAssistantControl: SetupScriptAssistantControl = {
    disabled: !setupAssistantPanelIsOpen && setupAssistantDisabledReason !== null,
    errorMessage: setupAssistantError,
    isStarting: !setupAssistantPanelIsOpen && startSetupAssistantMutation.isPending,
    onToggle: ({ setupScript }) => {
      if (setupAssistantPanelState?.isOpen === true) {
        setSetupAssistantPanelState((currentState) =>
          currentState === null
            ? currentState
            : {
                ...currentState,
                isOpen: false,
              },
        );
        return;
      }

      setSetupAssistantError(null);
      const initialComposerText = buildSetupAssistantInitialComposerText(setupScript);

      setSetupAssistantPanelState((currentState) => ({
        initialComposerText,
        isOpen: true,
        sandboxInstanceId: currentState?.sandboxInstanceId ?? null,
      }));

      if (
        (setupAssistantPanelState !== null &&
          setupAssistantPanelState.sandboxInstanceId !== null) ||
        startSetupAssistantMutation.isPending
      ) {
        return;
      }

      startSetupAssistantMutation.mutate();
    },
    title: setupAssistantPanelIsOpen
      ? "Close the Setup Assistant panel."
      : (setupAssistantDisabledReason ?? "Open the right panel to write this setup script."),
  };

  useEffect(() => {
    if (input.publishSuccessNavigationKey !== null) {
      input.onPublishSuccessNavigationConsumed();
    }
  }, [input.publishSuccessNavigationKey, input.onPublishSuccessNavigationConsumed]);

  useEffect(() => {
    if (!input.publishSuccessMessage) {
      return;
    }

    setPublishSuccessNoticeKey((currentKey) => currentKey + 1);
    setShowPublishSuccessMessage(true);
  }, [input.publishSuccessMessage]);

  async function saveDraftChanges(): Promise<boolean> {
    setPublishFlushError(null);
    const shouldSavePersistence = persistenceDraftState.hasUnpersistedChanges;
    const shouldSaveRuntime = runtimeDraftState.hasUnpersistedChanges;
    const shouldSaveIntegrations = integrationDraftState.hasUnpersistedChanges;
    const shouldSaveSetupScript = setupScriptDraftState.hasUnpersistedChanges;

    if (
      !shouldSavePersistence &&
      !shouldSaveRuntime &&
      !shouldSaveIntegrations &&
      !shouldSaveSetupScript
    ) {
      return true;
    }

    try {
      const integrationBindings = shouldSaveIntegrations
        ? integrationDraftState.buildIntegrationBindingChanges?.()
        : undefined;
      if (integrationBindings === null) {
        setPublishFlushError(DraftSaveErrorMessage);
        return false;
      }
      const setupScript = shouldSaveSetupScript
        ? (setupScriptDraftState.buildDraftChanges?.() ?? null)
        : undefined;
      const defaultPersistenceMode = shouldSavePersistence
        ? persistenceDraftState.buildDraftChanges?.()
        : undefined;
      const runtimeChanges: SandboxProfileRuntimeDraftChanges | undefined = shouldSaveRuntime
        ? runtimeDraftState.buildDraftChanges?.()
        : undefined;

      const savedDraft = await putSandboxProfileVersionDraft({
        profileId: input.profileId,
        version: input.mode.version,
        ...(setupScript === undefined ? {} : { setupScript }),
        ...(defaultPersistenceMode === undefined ? {} : { defaultPersistenceMode }),
        ...(runtimeChanges === undefined
          ? {}
          : {
              agentRuntimeId: runtimeChanges.agentRuntimeId,
              sandboxProvider: runtimeChanges.sandboxProvider,
              sandboxConnectionId: runtimeChanges.sandboxConnectionId,
              sandboxResources: runtimeChanges.sandboxResources,
            }),
        ...(shouldSaveIntegrations && integrationBindings !== undefined
          ? { integrationBindings: { bindings: integrationBindings } }
          : {}),
      });

      if (shouldSaveIntegrations) {
        integrationDraftState.applySavedBindings?.(savedDraft.integrationBindings.bindings);
        await input.invalidateVersionBindings({
          profileId: input.profileId,
          version: input.mode.version,
        });
      }
      if (shouldSaveSetupScript) {
        setupScriptDraftState.applySavedSetupScript?.(savedDraft.setupScript);
        await input.invalidateVersionSetupScript({
          profileId: input.profileId,
          version: input.mode.version,
        });
      }
      if (shouldSavePersistence) {
        persistenceDraftState.applySavedPersistenceMode?.(savedDraft.defaultPersistenceMode);
        await input.invalidateProfileVersions(input.profileId);
      }
      if (shouldSaveRuntime) {
        if (savedDraft.sandboxProvider === null) {
          throw new Error("Saved sandbox runtime provider is missing.");
        }

        runtimeDraftState.applySavedRuntimeConfig?.({
          agentRuntimeId: savedDraft.agentRuntimeId,
          sandboxProvider: savedDraft.sandboxProvider,
          sandboxConnectionId: savedDraft.sandboxConnectionId,
          sandboxResources: savedDraft.sandboxResources,
        });
        await input.invalidateProfileVersions(input.profileId);
      }

      return true;
    } catch (error: unknown) {
      integrationDraftState.applyDraftSaveError?.(error);
      setupScriptDraftState.applyDraftSaveError?.(error);
      persistenceDraftState.applyDraftSaveError?.(error);
      runtimeDraftState.applyDraftSaveError?.(error);
      setPublishFlushError(DraftSaveErrorMessage);
      return false;
    }
  }

  async function handleSaveDraft(): Promise<void> {
    setSaveDraftRequestIsPending(true);
    setDraftAutomationImpactAffectedAutomations(null);
    setDraftAutomationImpactError(null);
    try {
      const draftSaved = await saveDraftChanges();
      if (!draftSaved) {
        return;
      }

      try {
        const impact = await getSandboxProfileVersionDraftAutomationImpact({
          profileId: input.profileId,
          version: input.mode.version,
        });
        setDraftAutomationImpactAffectedAutomations(
          getDraftAutomationImpactAffectedAutomations(impact),
        );
      } catch {
        setDraftAutomationImpactError(DraftAutomationImpactCheckFailedMessage);
      }
    } finally {
      setSaveDraftRequestIsPending(false);
    }
  }

  async function handlePublish(version: number): Promise<void> {
    setPublishRequestIsPending(true);
    try {
      const draftSaved = await saveDraftChanges();
      if (!draftSaved) {
        return;
      }

      await input.onPublish(version);
      setPublishSuccessNoticeKey((currentKey) => currentKey + 1);
      setShowPublishSuccessMessage(true);
    } catch {
      return;
    } finally {
      setPublishRequestIsPending(false);
    }
  }

  const editorView = (
    <SandboxProfileEditorView
      activeSectionId={activeSectionId}
      hasUnpersistedPersistenceChanges={persistenceDraftState.hasUnpersistedChanges}
      hasUnpersistedRuntimeChanges={runtimeDraftState.hasUnpersistedChanges}
      hasUnpersistedIntegrationChanges={integrationDraftState.hasUnpersistedChanges}
      hasUnpersistedSetupScriptChanges={setupScriptDraftState.hasUnpersistedChanges}
      isSavingProfileName={metaState.isUpdating}
      mode={input.mode}
      shouldBlockUnpersistedChangesNavigation={shouldBlockUnpersistedChangesNavigation}
      deleteProfileAutomationUsages={input.deleteProfileAutomationUsages}
      deleteProfileAutomationUsagesError={input.deleteProfileAutomationUsagesError}
      deleteProfileAutomationUsagesIsPending={input.deleteProfileAutomationUsagesIsPending}
      deleteProfileError={input.deleteProfileError}
      deleteProfileIsPending={input.deleteProfileIsPending}
      onMakeChanges={input.onMakeChanges}
      onConfirmDeleteProfile={input.onConfirmDeleteProfile}
      onDeleteProfileDialogOpenChange={input.onDeleteProfileDialogOpenChange}
      onDiscardChangesAndLeaveDraft={input.onDiscardChangesAndLeaveDraft}
      onPublish={(version) => {
        void handlePublish(version);
      }}
      onSaveDraft={() => {
        void handleSaveDraft();
      }}
      onActiveSectionIdChange={(sectionId) => {
        if (
          sectionId === SandboxProfileEditorSectionIds.SANDBOX_PROFILE &&
          input.explicitRouteView === undefined
        ) {
          void input.navigate(createSandboxProfileEditorPath({ profileId: input.profileId }));
          return;
        }

        const view =
          sectionId === SandboxProfileEditorSectionIds.SANDBOX_PROFILE
            ? input.explicitRouteView
            : input.routeView;

        if (view === undefined) {
          throw new Error("Sandbox profile tab navigation view could not be resolved.");
        }

        void input.navigate(
          createSandboxProfileTabPath({
            profileId: input.profileId,
            sectionId,
            view,
          }),
        );
      }}
      onSaveProfileName={metaState.onProfileNameSave}
      onViewActive={input.onViewActive}
      onViewDraft={input.onViewDraft}
      profileName={metaState.formState.displayName}
      profileNameFallback={metaState.pageTitle}
      publishRequestIsPending={publishRequestIsPending}
      saveDraftRequestIsPending={saveDraftRequestIsPending}
      draftSaveError={publishFlushError}
      draftAutomationImpactError={draftAutomationImpactError}
      draftAutomationImpactAffectedAutomations={draftAutomationImpactAffectedAutomations}
      onDraftAutomationImpactErrorDismiss={() => {
        setDraftAutomationImpactError(null);
      }}
      versionActionError={input.versionActionError}
      versionActionIsPending={input.versionActionIsPending}
      isDeleteProfileDialogOpen={input.isDeleteProfileDialogOpen}
      renderSectionPanel={(sectionId) => (
        <SandboxProfileEditorSectionPanels
          activeSectionId={sectionId}
          currentVersion={input.currentVersion}
          draftFieldsAreReadOnly={draftFieldsAreReadOnly}
          draftEditorResetKey={input.draftEditorResetKey}
          integrationDraftState={integrationDraftState}
          integrationsLoader={integrationsLoader}
          invalidateProfileVersions={input.invalidateProfileVersions}
          mode={input.mode}
          onPersistenceDraftStateChange={setPersistenceDraftState}
          onRuntimeDraftStateChange={setRuntimeDraftState}
          onIntegrationDraftStateChange={setIntegrationDraftState}
          onPublishSuccessMessageDismiss={() => {
            setShowPublishSuccessMessage(false);
          }}
          onRefreshSnapshot={input.onRefreshSnapshot}
          onRetryPublishSnapshot={input.onRetryPublishSnapshot}
          onSetupScriptDraftStateChange={setSetupScriptDraftState}
          setupAssistantControl={setupAssistantControl}
          profileId={input.profileId}
          publishSuccessMessage={showPublishSuccessMessage}
          publishSuccessMessageKey={publishSuccessNoticeKey}
          setupScriptLoader={setupScriptLoader}
          snapshotPanelState={snapshotPanelState}
          snapshotVersion={snapshotVersion}
          versionActionIsPending={input.versionActionIsPending}
        />
      )}
      sections={editorSections}
    />
  );

  if (setupAssistantPanelState === null || !setupAssistantPanelState.isOpen) {
    return editorView;
  }

  return (
    <div className="sticky top-0 h-svh overflow-hidden">
      <ResizablePanelGroup
        className="h-full min-h-0 overflow-hidden"
        id="sandbox-profile-setup-assistant-panel-group"
        orientation="horizontal"
      >
        <ResizablePanel defaultSize="72%" id="sandbox-profile-editor-main-panel" minSize="45%">
          <div className="h-full min-h-0 overflow-y-auto overscroll-contain">{editorView}</div>
        </ResizablePanel>
        <ResizableHandle id="sandbox-profile-setup-assistant-resize-handle" />
        <ResizablePanel
          defaultSize="28%"
          id="sandbox-profile-setup-assistant-panel"
          minSize="360px"
        >
          <SetupScriptAssistantPanel
            onClose={() => {
              setSetupAssistantPanelState((currentState) =>
                currentState === null
                  ? currentState
                  : {
                      ...currentState,
                      isOpen: false,
                    },
              );
            }}
            sandboxInstanceId={setupAssistantPanelState.sandboxInstanceId}
            initialComposerText={setupAssistantPanelState.initialComposerText}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function SetupScriptAssistantPanel(input: {
  onClose: () => void;
  sandboxInstanceId: string | null;
  initialComposerText: string;
}): React.JSX.Element {
  const { conversationPane, workbench } = useSessionWorkbenchController({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const [composerText, setComposerText] = useState(input.initialComposerText);
  const [pendingDiffComments, setPendingDiffComments] = useState<
    readonly PendingSessionDiffComment[]
  >([]);
  const conversationScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalWorkspaceRef = useRef<SessionTerminalWorkspaceHandle | null>(null);
  const terminalPanelKey = input.sandboxInstanceId ?? "setup-assistant-missing-sandbox";
  const isTerminalOpenDisabled =
    !workbench.terminalPanelState.isVisible && !workbench.connectionReadiness.canConnect;
  const cliButtonTitle = workbench.primaryPanelState.isCliToggleActive
    ? "Return to chat"
    : (workbench.primaryPanelState.disabledReason ?? "Open Setup Assistant TUI");
  const terminalButtonTitle = isTerminalOpenDisabled
    ? (workbench.stoppedSessionMessage ?? "Terminal is available after the Setup Assistant starts.")
    : workbench.terminalPanelState.isVisible
      ? "Terminal"
      : "Open terminal";
  const headerStatusKind = workbench.workbenchStatus.kind;
  const headerStatusLabel =
    headerStatusKind === "error" ? "Error" : (workbench.sandboxLifecycleStatus ?? "Starting");
  const unmatchedServerRequests = conversationPane.serverRequestsState.pendingServerRequests.filter(
    (entry) => {
      if (entry.kind !== "command-approval" && entry.kind !== "file-change-approval") {
        return true;
      }

      return !conversationPane.chatState.entries.some((chatEntry) => {
        if (chatEntry.kind !== "semantic-group") {
          return false;
        }

        return chatEntry.items.some((item) => item.id === entry.requestId);
      });
    },
  );

  useEffect(() => {
    setComposerText(input.initialComposerText);
  }, [input.initialComposerText]);

  function handleClearPendingDiffComments(): void {
    setPendingDiffComments([]);
  }

  return (
    <aside className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden overscroll-contain">
      <Button
        aria-label="Close Setup Assistant panel"
        className="absolute top-3 left-1 size-8 px-0"
        onClick={input.onClose}
        title="Close right panel"
        type="button"
        variant="ghost"
      >
        <SidebarSimpleIcon aria-hidden className="size-4 -scale-x-100" />
      </Button>
      <div className="flex min-h-14 items-center justify-between gap-3 border-b pr-5 pl-9">
        <h2 className="truncate text-sm font-semibold tracking-normal">Setup Assistant</h2>
        <div className="flex shrink-0 items-center gap-2">
          <span
            aria-label={headerStatusLabel}
            className={[
              "inline-block size-2.5 rounded-full border",
              headerStatusKind === "connected"
                ? "border-emerald-700 bg-emerald-600"
                : "border-stone-300 bg-stone-300",
            ].join(" ")}
            role="status"
            title={headerStatusLabel}
          />
          <span aria-hidden className="h-5 w-px bg-stone-200" />
          <Button
            aria-label="TUI"
            aria-pressed={workbench.primaryPanelState.isCliToggleActive}
            className={
              workbench.primaryPanelState.isCliToggleActive
                ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
                : "bg-transparent text-foreground shadow-none hover:bg-stone-100"
            }
            disabled={
              !workbench.primaryPanelState.canEnterCli &&
              !workbench.primaryPanelState.isCliToggleActive
            }
            onClick={() => {
              if (workbench.primaryPanelState.isCliToggleActive) {
                void workbench.primaryPanelState.exitCliMode();
                return;
              }

              void workbench.primaryPanelState.enterCliMode();
            }}
            size="sm"
            title={cliButtonTitle}
            type="button"
            variant="ghost"
          >
            TUI
          </Button>
          <Button
            aria-label={workbench.terminalPanelState.isVisible ? "Terminal" : "Open terminal"}
            aria-pressed={workbench.terminalPanelState.isVisible}
            className={
              workbench.terminalPanelState.isVisible
                ? "bg-stone-200 text-stone-950 shadow-none hover:bg-stone-300"
                : "bg-transparent text-foreground shadow-none hover:bg-stone-100"
            }
            disabled={isTerminalOpenDisabled}
            onClick={() => {
              if (workbench.terminalPanelState.isVisible) {
                workbench.terminalPanelState.closePanel();
                return;
              }

              workbench.terminalPanelState.openPanel();
              terminalWorkspaceRef.current?.ensureTerminalWorkspace();
            }}
            size="icon-sm"
            title={terminalButtonTitle}
            type="button"
            variant="ghost"
          >
            <TerminalIcon aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
      <ResizablePanelGroup
        className="min-h-0 flex-1"
        id="setup-assistant-body-panel-group"
        orientation="vertical"
      >
        <ResizablePanel id="setup-assistant-conversation-panel" minSize="40%">
          <div className="flex h-full min-h-0 flex-col">
            <div
              aria-label="Setup Assistant conversation"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5"
              ref={conversationScrollContainerRef}
              role="region"
            >
              {renderSetupAssistantMainContent({
                conversation: {
                  activeTurnId: conversationPane.chatState.activeTurnId,
                  isTurnInProgress: conversationPane.chatState.status === "inProgress",
                  pendingTurnId: conversationPane.chatState.pendingTurnId,
                  scrollBehavior: "follow-streaming-at-bottom",
                  chatEntries: conversationPane.chatState.entries,
                  onUserMessageAction: conversationPane.dismissUserMessageAction,
                  isRespondingToServerRequest:
                    conversationPane.serverRequestsState.isRespondingToServerRequest,
                  onRespondToServerRequest:
                    conversationPane.serverRequestsState.respondToServerRequest,
                  scrollContainerRef: conversationScrollContainerRef,
                  serverRequestPanelEntries: unmatchedServerRequests,
                },
                cli: {
                  ptyState: workbench.cliPtyState,
                  refitKey: workbench.terminalPanelState.isVisible
                    ? "setup-assistant-cli:terminal-open"
                    : "setup-assistant-cli:terminal-closed",
                },
                initialEntryStartupState: workbench.initialEntryStartupState,
                transitionState: workbench.primaryPanelState.transitionState,
              })}
            </div>
            {workbench.primaryPanelState.showsChatComposer &&
            workbench.initialEntryStartupState === null ? (
              <div className="shrink-0 bg-background px-5 py-4">
                <SessionConversationBottomPanelController
                  chatEntries={conversationPane.chatState.entries}
                  composerStateInput={{
                    ...conversationPane.composerStateInput,
                    collaborationModeSettings: buildSetupAssistantCollaborationModeSettings(
                      conversationPane.composerStateInput.collaborationModeSettings,
                    ),
                  }}
                  draftState={{
                    composerText,
                    pendingDiffComments,
                    clearPendingDiffComments: handleClearPendingDiffComments,
                    setComposerText,
                  }}
                  isRespondingToServerRequest={
                    conversationPane.serverRequestsState.isRespondingToServerRequest
                  }
                  onRespondToServerRequest={
                    conversationPane.serverRequestsState.respondToServerRequest
                  }
                  key={input.sandboxInstanceId ?? "missing-setup-assistant"}
                  serverRequestPanelEntries={unmatchedServerRequests}
                  showWorkingIndicator={
                    conversationPane.chatState.activeTurnId !== null &&
                    conversationPane.chatState.status === "inProgress"
                  }
                />
              </div>
            ) : null}
          </div>
        </ResizablePanel>
        {!workbench.terminalPanelState.isVisible || input.sandboxInstanceId === null ? null : (
          <>
            <ResizableHandle id="setup-assistant-terminal-resize-handle" />
            <ResizablePanel id="setup-assistant-terminal-panel" minSize="180px">
              <SessionTerminalWorkspace
                key={terminalPanelKey}
                cwd={workbench.terminalCwd}
                ensureTransportConnected={workbench.ensureTransportConnected}
                isConnectionReady={workbench.connectionReadiness.canConnect}
                isVisible={workbench.terminalPanelState.isVisible}
                onTerminalReset={workbench.handleTerminalWorkspaceReset}
                onWorkspaceEmpty={() => {
                  workbench.terminalPanelState.closePanel();
                }}
                ref={terminalWorkspaceRef}
                sandboxStatus={workbench.sandboxLifecycleStatus}
                sandboxInstanceId={input.sandboxInstanceId}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </aside>
  );
}

type SetupAssistantConversationContent = React.ComponentProps<
  typeof SessionConversationMainContent
>;

function renderSetupAssistantMainContent(input: {
  cli: React.ComponentProps<typeof SessionCliPanel>;
  conversation: SetupAssistantConversationContent;
  initialEntryStartupState: ReturnType<
    typeof useSessionWorkbenchController
  >["workbench"]["initialEntryStartupState"];
  transitionState: ReturnType<
    typeof useSessionWorkbenchController
  >["workbench"]["primaryPanelState"]["transitionState"];
}): React.JSX.Element {
  if (input.initialEntryStartupState !== null) {
    return (
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center px-4 py-6">
        <SessionStartupStatus state={input.initialEntryStartupState} />
      </div>
    );
  }

  switch (input.transitionState) {
    case "switching_to_cli":
    case "restoring_chat":
      return <></>;
    case "stable_cli":
      return <SessionCliPanel {...input.cli} />;
    case "stable_chat":
      return <SessionConversationMainContent {...input.conversation} />;
  }
}

function SandboxProfileEditorSectionPanels(input: {
  activeSectionId: SandboxProfileEditorSectionId;
  currentVersion: SandboxProfileVersion | null;
  draftFieldsAreReadOnly: boolean;
  draftEditorResetKey: number;
  integrationDraftState: SandboxProfileDraftSectionState;
  integrationsLoader: ReturnType<typeof useSandboxProfileIntegrationsLoader>;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  mode: SandboxProfileEditorVersionMode;
  onPersistenceDraftStateChange: (state: SandboxProfilePersistenceDraftState) => void;
  onRuntimeDraftStateChange: (state: SandboxProfileRuntimeSettingsDraftState) => void;
  onIntegrationDraftStateChange: (state: SandboxProfileDraftSectionState) => void;
  onPublishSuccessMessageDismiss: () => void;
  onRefreshSnapshot: (version: number) => void;
  onRetryPublishSnapshot: (version: number) => void;
  onSetupScriptDraftStateChange: (state: SandboxProfileDraftSectionState) => void;
  setupAssistantControl: SetupScriptAssistantControl;
  profileId: string;
  publishSuccessMessage: boolean;
  publishSuccessMessageKey: Key;
  setupScriptLoader: ReturnType<typeof useSandboxProfileSetupScriptLoader>;
  snapshotPanelState: SnapshotPanelState;
  snapshotVersion: SandboxProfileVersion | null;
  versionActionIsPending: boolean;
}): React.JSX.Element {
  if (input.activeSectionId === SandboxProfileEditorSectionIds.AUTOMATIONS) {
    return <SandboxProfileAutomationsSection profileId={input.profileId} />;
  }

  if (input.activeSectionId === SandboxProfileEditorSectionIds.SNAPSHOT) {
    return (
      <SandboxProfileSnapshotPanel
        isActionPending={input.versionActionIsPending}
        invalidateProfileVersions={input.invalidateProfileVersions}
        onRefreshSnapshot={() => {
          if (input.snapshotVersion !== null) {
            input.onRefreshSnapshot(input.snapshotVersion.version);
          }
        }}
        onRetryPublishSnapshot={() => {
          if (input.snapshotVersion !== null) {
            input.onRetryPublishSnapshot(input.snapshotVersion.version);
          }
        }}
        onPublishSuccessMessageDismiss={input.onPublishSuccessMessageDismiss}
        publishSuccessMessageKey={input.publishSuccessMessageKey}
        publishSuccessMessage={input.publishSuccessMessage}
        profileId={input.profileId}
        refreshSchedule={input.snapshotVersion?.refreshSchedule ?? null}
        state={input.snapshotPanelState}
        version={input.snapshotVersion?.version ?? null}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <LoadedSandboxProfileIntegrationSetupSection
        key={`${input.profileId}:${String(input.mode.version)}:${String(input.draftEditorResetKey)}:integration-setup`}
        loader={input.integrationsLoader}
        onDraftStateChange={input.onIntegrationDraftStateChange}
        profileId={input.profileId}
        runtimeSettings={
          input.currentVersion === null ? null : (
            <LoadedSandboxProfileRuntimeSection
              availableConnections={input.integrationsLoader.availableConnections}
              availableTargets={input.integrationsLoader.availableTargets}
              disabled={input.draftFieldsAreReadOnly}
              isDraft={input.mode.kind === "draft"}
              onDraftStateChange={input.onRuntimeDraftStateChange}
              sectionChrome={false}
              version={input.currentVersion}
            />
          )
        }
        disabled={input.draftFieldsAreReadOnly}
        readOnly={input.draftFieldsAreReadOnly}
        version={input.mode.version}
      />
      <SandboxProfilePanelSection>
        <LoadedSandboxProfileSetupScriptSection
          disabled={input.draftFieldsAreReadOnly}
          key={`${input.profileId}:${String(input.mode.version)}:${String(input.draftEditorResetKey)}:setup-script`}
          integrationRows={resolveSandboxProfileSetupScriptIntegrationRows(
            input.integrationsLoader.initialRows,
            input.integrationDraftState.integrationRows,
          )}
          loader={input.setupScriptLoader}
          profileId={input.profileId}
          onDraftStateChange={input.onSetupScriptDraftStateChange}
          setupAssistantControl={input.setupAssistantControl}
          isDraft={input.mode.kind === "draft"}
          version={input.mode.version}
        />
      </SandboxProfilePanelSection>
      {input.currentVersion === null ? null : (
        <SandboxProfilePanelSection>
          <SandboxProfilePersistenceModeSection
            disabled={input.draftFieldsAreReadOnly}
            invalidateProfileVersions={input.invalidateProfileVersions}
            isDraft={input.mode.kind === "draft"}
            key={`${input.profileId}:${String(input.mode.version)}:${String(input.draftEditorResetKey)}:persistence-mode`}
            onDraftStateChange={input.onPersistenceDraftStateChange}
            profileId={input.profileId}
            version={input.currentVersion}
          />
        </SandboxProfilePanelSection>
      )}
    </div>
  );
}

export function SandboxProfilePanelSection(input: { children: ReactNode }): React.JSX.Element {
  return <section className="flex flex-col gap-4">{input.children}</section>;
}

function LoadedSandboxProfileRuntimeSection(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  disabled: boolean;
  isDraft: boolean;
  onDraftStateChange: (state: SandboxProfileRuntimeSettingsDraftState) => void;
  sectionChrome?: boolean;
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const sandboxProvidersQuery = useQuery({
    queryKey: sandboxProvidersQueryKey(),
    queryFn: async ({ signal }) => listSandboxProviders({ signal }),
    retry: false,
  });

  if (sandboxProvidersQuery.isPending) {
    return (
      <div
        aria-live="polite"
        className="text-muted-foreground flex items-center gap-2 text-sm"
        role="status"
      >
        <SpinnerGapIcon aria-hidden className="size-4 animate-spin" />
        <span>Loading sandbox providers...</span>
      </div>
    );
  }

  if (sandboxProvidersQuery.isError) {
    return (
      <Notice title="Could not load sandbox providers" variant="alert">
        {resolveApiErrorMessage({
          error: sandboxProvidersQuery.error,
          fallbackMessage: "Could not load sandbox providers.",
        })}
      </Notice>
    );
  }

  return (
    <SandboxProfileRuntimeSection
      availableConnections={input.availableConnections}
      availableTargets={input.availableTargets}
      disabled={input.disabled}
      isDraft={input.isDraft}
      onDraftStateChange={input.onDraftStateChange}
      providers={sandboxProvidersQuery.data.items}
      version={input.version}
      {...(input.sectionChrome === undefined ? {} : { sectionChrome: input.sectionChrome })}
    />
  );
}

function SandboxProfilePersistenceModeSection(input: {
  disabled: boolean;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  isDraft: boolean;
  onDraftStateChange: (state: SandboxProfilePersistenceDraftState) => void;
  profileId: string;
  version: SandboxProfileVersion;
}): React.JSX.Element | null {
  const activeOrganizationId = useRequiredOrganizationId();
  const { disabled, isDraft, onDraftStateChange, version } = input;
  const [draftPersistenceMode, setDraftPersistenceMode] = useState(version.defaultPersistenceMode);
  const [persistedPersistenceMode, setPersistedPersistenceMode] = useState(
    version.defaultPersistenceMode,
  );
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const draftPersistenceModeRef = useRef(draftPersistenceMode);
  const persistedPersistenceModeRef = useRef(persistedPersistenceMode);
  draftPersistenceModeRef.current = draftPersistenceMode;
  persistedPersistenceModeRef.current = persistedPersistenceMode;
  const organizationSandboxStorageSettingsQuery = useQuery({
    queryKey: organizationSandboxStorageSettingsQueryKey(activeOrganizationId),
    queryFn: async () => getOrganizationSandboxStorageSettings(),
  });
  const buildDraftChanges = useCallback(
    (): SandboxProfileVersion["defaultPersistenceMode"] => draftPersistenceModeRef.current,
    [],
  );
  const applySavedPersistenceMode = useCallback(
    (defaultPersistenceMode: SandboxProfileVersion["defaultPersistenceMode"]): void => {
      setDraftPersistenceMode(defaultPersistenceMode);
      setPersistedPersistenceMode(defaultPersistenceMode);
      setSaveErrorMessage(null);
    },
    [],
  );
  const applyDraftSaveError = useCallback((error: unknown): void => {
    setSaveErrorMessage(
      resolveApiErrorMessage({
        error,
        fallbackMessage: "Could not save sandbox profile persistence mode.",
      }),
    );
  }, []);

  useEffect(() => {
    setDraftPersistenceMode(version.defaultPersistenceMode);
    setPersistedPersistenceMode(version.defaultPersistenceMode);
    setSaveErrorMessage(null);
  }, [version.defaultPersistenceMode, version.version]);

  useEffect(() => {
    onDraftStateChange({
      applyDraftSaveError,
      applySavedPersistenceMode,
      buildDraftChanges,
      hasUnpersistedChanges: draftPersistenceMode !== persistedPersistenceMode,
    });
  }, [
    applyDraftSaveError,
    applySavedPersistenceMode,
    buildDraftChanges,
    draftPersistenceMode,
    onDraftStateChange,
    persistedPersistenceMode,
  ]);

  const persistentModeIsEnabled = draftPersistenceMode === "persistent";
  const fieldIsReadOnly = disabled || !isDraft;

  if (organizationSandboxStorageSettingsQuery.data?.persistentSandboxesEnabled !== true) {
    return null;
  }

  return (
    <div className="space-y-2">
      {saveErrorMessage === null ? null : <Notice variant="alert">{saveErrorMessage}</Notice>}
      {fieldIsReadOnly ? (
        <div className="flex w-fit items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Use persistent sandboxes:
          </span>
          <span className="text-sm font-medium">{persistentModeIsEnabled ? "Yes" : "No"}</span>
        </div>
      ) : (
        <div className="flex max-w-5xl flex-col gap-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Experimental
          </h2>
          <div className="rounded-md border bg-background p-4">
            <SettingsSwitchField
              checked={persistentModeIsEnabled}
              id="sandbox-profile-persistent-mode"
              label="Use persistent sandboxes"
              onCheckedChange={(checked) => {
                setDraftPersistenceMode(checked ? "persistent" : "ephemeral");
                setSaveErrorMessage(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const SandboxProfileEditorTabs = [
  {
    id: SandboxProfileEditorSectionIds.SANDBOX_PROFILE,
    label: "Sandbox Profile",
  },
  {
    id: SandboxProfileEditorSectionIds.SNAPSHOT,
    label: "Snapshots",
  },
  {
    id: SandboxProfileEditorSectionIds.AUTOMATIONS,
    label: "Automations",
  },
] as const satisfies readonly SandboxProfileEditorSection<SandboxProfileEditorSectionId>[];

const DraftSaveErrorMessage = "Saving draft failed. Please try again later.";
const DraftAutomationImpactCheckFailedMessage =
  "Couldn't check whether this draft affects related automations.";

function getDraftAutomationImpactAffectedAutomations(
  impact: SandboxProfileVersionDraftAutomationImpact,
): readonly SandboxProfileVersionDraftAutomationImpactAutomation[] | null {
  if (!impact.hasBreakingChanges || impact.affectedAutomations.length === 0) {
    return null;
  }

  return impact.affectedAutomations;
}

function getAutomationDetailPath(
  automation: SandboxProfileVersionDraftAutomationImpactAutomation,
): string {
  if (automation.kind === "schedule") {
    return `/automations/schedules/${automation.id}`;
  }

  return `/automations/${automation.id}`;
}

function DraftAutomationImpactAutomationList(input: {
  automations: readonly SandboxProfileVersionDraftAutomationImpactAutomation[];
}): ReactNode {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {input.automations.map((automation) => (
        <li key={automation.id}>
          <TextLink href={getAutomationDetailPath(automation)} opensInNewWindow>
            {automation.name}
          </TextLink>
          <div className="mt-0.5 space-y-0.5">
            {automation.issues.map((issue) => (
              <div key={`${automation.id}:${issue.code}`}>
                {formatDraftAutomationImpactIssueMessage(issue)}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatDraftAutomationImpactIssueMessage(
  issue: SandboxProfileVersionDraftAutomationImpactIssue,
): string {
  switch (issue.code) {
    case "AGENT_BINDING_REQUIRED":
      return "This draft does not have an agent binding.";
    case "AGENT_BINDING_AMBIGUOUS":
      return "This draft has multiple agent bindings, but automations require exactly one.";
    case "AGENT_BINDING_RUNTIME_INVALID":
      return "The draft agent binding does not define a runtime.";
    case "INVALID_BINDING_CONNECTION_REFERENCE":
      return "The draft agent binding references a missing or inaccessible connection.";
    case "CONNECTION_NOT_ACTIVE":
      return "The draft agent connection is not active.";
    case "TARGET_DISABLED":
      return "The draft agent connection uses a disabled integration target.";
    case "TARGET_MISSING":
      return "The draft agent connection references an unavailable integration target.";
    case "WEBHOOK_SOURCE_CONNECTION_NOT_BOUND":
      return "This automation's webhook source connection is not bound in the draft.";
    case "PRIMARY_REPOSITORY_UNAVAILABLE":
      return "This automation's primary repository is not available in the draft.";
  }
}

function DeleteSandboxProfileDialog(input: {
  automationUsages: readonly WebhookAutomationSandboxProfileUsage[];
  automationUsagesError: string | null;
  automationUsagesIsPending: boolean;
  deleteError: string | null;
  isOpen: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  profileName: string;
}): React.JSX.Element {
  const isBlocked =
    input.isPending || input.automationUsagesIsPending || input.automationUsagesError !== null;

  return (
    <Dialog
      isBusy={input.isPending}
      isDismissible={!input.isPending}
      onOpenChange={input.onOpenChange}
      open={input.isOpen}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete profile?</DialogTitle>
          <DialogDescription>This removes {input.profileName}.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {input.automationUsagesIsPending ? (
            <p className="text-muted-foreground text-sm">Loading automations...</p>
          ) : null}

          {input.automationUsagesError === null ? null : (
            <Notice title="Could not load automations" variant="alert">
              {input.automationUsagesError}
            </Notice>
          )}

          {input.automationUsages.length === 0 ||
          input.automationUsagesIsPending ||
          input.automationUsagesError !== null ? null : (
            <div className="space-y-2">
              <p className="text-sm">These automations use this profile and will break:</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {input.automationUsages.map((automation) => (
                  <li key={automation.id}>{automation.name}</li>
                ))}
              </ul>
              <p className="text-sm">They will stop working until you delete or retarget them.</p>
            </div>
          )}

          {input.deleteError === null ? null : (
            <Notice title="Delete failed" variant="alert">
              {input.deleteError}
            </Notice>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={input.isPending}
            onClick={() => {
              input.onOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={isBlocked} onClick={input.onConfirm} type="button">
            {input.isPending ? "Deleting..." : "Delete profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SandboxProfileEditorView(input: {
  profileName: string | null;
  profileNameFallback: string;
  onSaveProfileName: (nextValue: string) => Promise<void>;
  mode: SandboxProfileEditorVersionMode;
  deleteProfileAutomationUsages: readonly WebhookAutomationSandboxProfileUsage[];
  deleteProfileAutomationUsagesError: string | null;
  deleteProfileAutomationUsagesIsPending: boolean;
  deleteProfileError: string | null;
  deleteProfileIsPending: boolean;
  draftSaveError?: string | null;
  versionActionError: string | null;
  versionActionIsPending: boolean;
  draftAutomationImpactAffectedAutomations:
    | readonly SandboxProfileVersionDraftAutomationImpactAutomation[]
    | null;
  draftAutomationImpactError: string | null;
  onDraftAutomationImpactErrorDismiss: () => void;
  publishRequestIsPending?: boolean;
  saveDraftRequestIsPending?: boolean;
  isDeleteProfileDialogOpen: boolean;
  shouldBlockUnpersistedChangesNavigation?: BlockerFunction;
  onPublish: (version: number) => void;
  onSaveDraft: () => void;
  onConfirmDeleteProfile: () => void;
  onDiscardChangesAndLeaveDraft: (input: { draftVersion: number }) => void;
  onDeleteProfileDialogOpenChange: (open: boolean) => void;
  onMakeChanges: () => void;
  onViewActive: () => void;
  onViewDraft: () => void;
  sections: readonly SandboxProfileEditorSection<SandboxProfileEditorSectionId>[];
  activeSectionId: SandboxProfileEditorSectionId;
  onActiveSectionIdChange: (sectionId: SandboxProfileEditorSectionId) => void;
  renderSectionPanel: (sectionId: SandboxProfileEditorSectionId) => React.JSX.Element;
  versionActions?: React.JSX.Element;
  hasUnpersistedPersistenceChanges?: boolean;
  hasUnpersistedRuntimeChanges?: boolean;
  hasUnpersistedIntegrationChanges?: boolean;
  hasUnpersistedSetupScriptChanges?: boolean;
  isSavingProfileName?: boolean;
}): React.JSX.Element {
  const hasUnpersistedDraftChanges =
    input.mode.kind === "draft" &&
    ((input.hasUnpersistedPersistenceChanges ?? false) ||
      (input.hasUnpersistedRuntimeChanges ?? false) ||
      (input.hasUnpersistedIntegrationChanges ?? false) ||
      (input.hasUnpersistedSetupScriptChanges ?? false));
  const deleteProfileMenuItem = (
    <DropdownMenuItem
      onClick={() => {
        input.onDeleteProfileDialogOpenChange(true);
      }}
      variant="destructive"
    >
      Delete profile
    </DropdownMenuItem>
  );
  const profileActions =
    input.versionActions ??
    (input.deleteProfileIsPending ? null : (
      <MoreActionsMenu triggerLabel="More actions">{deleteProfileMenuItem}</MoreActionsMenu>
    ));

  return (
    <>
      <NavigationBlockerDialog
        title="Leave before draft changes are saved?"
        description="Some draft changes have not been saved yet. If you leave this page, those changes will be discarded."
        {...(input.shouldBlockUnpersistedChangesNavigation === undefined
          ? {}
          : { shouldBlockNavigation: input.shouldBlockUnpersistedChangesNavigation })}
        enabled={hasUnpersistedDraftChanges}
      />

      <DeleteSandboxProfileDialog
        automationUsages={input.deleteProfileAutomationUsages}
        automationUsagesError={input.deleteProfileAutomationUsagesError}
        automationUsagesIsPending={input.deleteProfileAutomationUsagesIsPending}
        deleteError={input.deleteProfileError}
        isOpen={input.isDeleteProfileDialogOpen}
        isPending={input.deleteProfileIsPending}
        onConfirm={input.onConfirmDeleteProfile}
        onOpenChange={input.onDeleteProfileDialogOpenChange}
        profileName={input.profileName ?? input.profileNameFallback}
      />

      <PageFrame
        headerActions={profileActions}
        titleSlot={
          <div className="min-w-0">
            <AutoSaveTitleHeading
              ariaLabel="Profile name"
              emptyDisplayText={input.profileNameFallback}
              onSave={input.onSaveProfileName}
              requiredLabel="Profile name"
              value={input.profileName}
              disabled={input.isSavingProfileName === true}
            />
          </div>
        }
        variant="tabbed"
        width="normal"
      >
        {input.versionActionError === null ? null : (
          <div className="px-4 pb-4">
            <div className="mx-auto w-full max-w-5xl">
              <Notice title="Profile version action failed" variant="alert">
                {input.versionActionError}
              </Notice>
            </div>
          </div>
        )}

        <SandboxProfileEditorSections<SandboxProfileEditorSectionId>
          activeSectionId={input.activeSectionId}
          onActiveSectionIdChange={input.onActiveSectionIdChange}
          renderPanel={(sectionId) =>
            sectionId === SandboxProfileEditorSectionIds.SANDBOX_PROFILE ? (
              <SandboxProfileEditorHorizontalTabContent>
                <SandboxProfileLifecycleActions
                  hasUnpersistedDraftChanges={hasUnpersistedDraftChanges}
                  mode={input.mode}
                  onDiscardChangesAndLeaveDraft={input.onDiscardChangesAndLeaveDraft}
                  onMakeChanges={input.onMakeChanges}
                  onPublish={input.onPublish}
                  onSaveDraft={input.onSaveDraft}
                  onViewActive={input.onViewActive}
                  onViewDraft={input.onViewDraft}
                  publishRequestIsPending={input.publishRequestIsPending === true}
                  saveDraftRequestIsPending={input.saveDraftRequestIsPending === true}
                  versionActionIsPending={input.versionActionIsPending}
                />
                {input.draftSaveError === undefined || input.draftSaveError === null ? null : (
                  <Notice variant="alert">{input.draftSaveError}</Notice>
                )}
                {input.draftAutomationImpactAffectedAutomations === null ? null : (
                  <Notice
                    title="Publishing this draft will break the following automations"
                    variant="warning"
                  >
                    <DraftAutomationImpactAutomationList
                      automations={input.draftAutomationImpactAffectedAutomations}
                    />
                  </Notice>
                )}
                {input.draftAutomationImpactError === null ? null : (
                  <Notice
                    autoHideAfterMs={NoticeAutoHideDurationsMs.LONG}
                    dismissible
                    onDismiss={input.onDraftAutomationImpactErrorDismiss}
                    title="Automation checks failed"
                    variant="alert"
                  >
                    {input.draftAutomationImpactError}
                  </Notice>
                )}
                {input.renderSectionPanel(sectionId)}
              </SandboxProfileEditorHorizontalTabContent>
            ) : (
              input.renderSectionPanel(sectionId)
            )
          }
          sections={input.sections}
        />
      </PageFrame>
    </>
  );
}

function SandboxProfileVersionStatusBadge(input: {
  mode: SandboxProfileEditorVersionMode;
}): React.JSX.Element {
  return (
    <span
      className={
        input.mode.kind === "draft"
          ? "inline-flex h-6 items-center rounded-sm border border-amber-200 bg-amber-50 px-2 text-xs font-medium text-amber-700"
          : "inline-flex h-6 items-center rounded-sm border border-blue-200 bg-blue-50 px-2 text-xs font-medium text-blue-700"
      }
    >
      {input.mode.kind === "draft"
        ? "Viewing: Draft"
        : `Viewing: Published (v${String(input.mode.version)})`}
    </span>
  );
}

function SandboxProfileLifecycleActions(input: {
  mode: SandboxProfileEditorVersionMode;
  hasUnpersistedDraftChanges: boolean;
  publishRequestIsPending: boolean;
  saveDraftRequestIsPending: boolean;
  versionActionIsPending: boolean;
  onPublish: (version: number) => void;
  onSaveDraft: () => void;
  onDiscardChangesAndLeaveDraft: (input: { draftVersion: number }) => void;
  onMakeChanges: () => void;
  onViewActive: () => void;
  onViewDraft: () => void;
}): React.JSX.Element {
  const versionActionIsDisabled =
    input.versionActionIsPending ||
    input.publishRequestIsPending ||
    input.saveDraftRequestIsPending;
  const discardChangesInput = resolveDiscardDraftInput(input.mode);
  const discardChangesMenuItem =
    discardChangesInput === null ? null : (
      <DropdownMenuItem
        disabled={versionActionIsDisabled}
        onClick={() => {
          input.onDiscardChangesAndLeaveDraft(discardChangesInput);
        }}
      >
        Discard draft
      </DropdownMenuItem>
    );
  const viewPublishedMenuItem =
    input.mode.kind !== "draft" || input.mode.activeVersion === null ? null : (
      <DropdownMenuItem onClick={input.onViewActive}>View published</DropdownMenuItem>
    );
  const hasDraftMenuItems = viewPublishedMenuItem !== null || discardChangesMenuItem !== null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SandboxProfileVersionStatusBadge mode={input.mode} />
      {input.mode.kind === "draft" ? (
        <div className="flex items-center gap-2">
          <Button
            disabled={!input.hasUnpersistedDraftChanges || versionActionIsDisabled}
            onClick={input.onSaveDraft}
            type="button"
            variant="outline"
          >
            {input.saveDraftRequestIsPending ? "Saving..." : "Save draft"}
          </Button>
          <ButtonGroup>
            <Button
              disabled={versionActionIsDisabled}
              onClick={() => {
                input.onPublish(input.mode.version);
              }}
              type="button"
            >
              {input.publishRequestIsPending ? "Publishing..." : "Publish"}
            </Button>
            {hasDraftMenuItems ? (
              <MoreActionsMenu
                disabled={versionActionIsDisabled}
                triggerIconVariant="chevron-down"
                triggerLabel="Sandbox profile actions"
                triggerVariant="default"
              >
                {viewPublishedMenuItem}
                {discardChangesMenuItem}
              </MoreActionsMenu>
            ) : null}
          </ButtonGroup>
        </div>
      ) : (
        <ButtonGroup>
          <Button
            disabled={input.versionActionIsPending}
            onClick={input.mode.hasDraft ? input.onViewDraft : input.onMakeChanges}
            type="button"
          >
            {input.mode.hasDraft ? "Resume editing" : "Edit"}
          </Button>
          {discardChangesMenuItem === null ? null : (
            <MoreActionsMenu
              disabled={input.versionActionIsPending}
              triggerIconVariant="chevron-down"
              triggerLabel="Sandbox profile actions"
              triggerVariant="default"
            >
              {discardChangesMenuItem}
            </MoreActionsMenu>
          )}
        </ButtonGroup>
      )}
    </div>
  );
}

function resolveDiscardDraftInput(
  mode: SandboxProfileEditorVersionMode,
): { draftVersion: number } | null {
  if (mode.kind === "draft" && mode.activeVersion !== null) {
    return {
      draftVersion: mode.version,
    };
  }

  if (mode.kind === "active" && mode.draftVersion !== null) {
    return {
      draftVersion: mode.draftVersion,
    };
  }

  return null;
}

function LoadedSandboxProfileIntegrationSetupSection(input: {
  profileId: string;
  version: number;
  disabled: boolean;
  readOnly: boolean;
  loader: ReturnType<typeof useSandboxProfileIntegrationsLoader>;
  runtimeSettings: ReactNode | null;
  onDraftStateChange?: (state: SandboxProfileDraftSectionState) => void;
}): React.JSX.Element | null {
  const showBindingsUnavailableNotice = input.loader.integrationBindingsQuery.isError;
  const showDirectoryUnavailableNotice = input.loader.integrationDirectoryQuery.isError;

  if (showBindingsUnavailableNotice || showDirectoryUnavailableNotice) {
    return (
      <SandboxProfilePanelSection>
        <div className="flex flex-col gap-4">
          <RuntimeSettingsSection>{input.runtimeSettings}</RuntimeSettingsSection>
          <SandboxProfileIntegrationsSetupUnavailableState
            integrationBindingsError={
              showBindingsUnavailableNotice ? input.loader.integrationBindingsQuery.error : null
            }
            integrationDirectoryError={
              showDirectoryUnavailableNotice ? input.loader.integrationDirectoryQuery.error : null
            }
          />
        </div>
      </SandboxProfilePanelSection>
    );
  }

  if (
    input.loader.integrationBindingsQuery.isPending ||
    input.loader.integrationDirectoryQuery.isPending ||
    input.loader.initialRows === null
  ) {
    if (input.runtimeSettings === null) {
      return null;
    }

    return (
      <SandboxProfilePanelSection>
        <RuntimeSettingsSection>{input.runtimeSettings}</RuntimeSettingsSection>
      </SandboxProfilePanelSection>
    );
  }

  return (
    <ReadySandboxProfileIntegrationSetupSection
      key={`${input.profileId}:${String(input.version)}`}
      profileId={input.profileId}
      version={input.version}
      initialRows={input.loader.initialRows}
      availableConnections={input.loader.availableConnections}
      availableTargets={input.loader.availableTargets}
      disabled={input.disabled}
      readOnly={input.readOnly}
      integrationDirectoryQuery={input.loader.integrationDirectoryQuery}
      runtimeSettings={input.runtimeSettings}
      {...(input.onDraftStateChange === undefined
        ? {}
        : { onDraftStateChange: input.onDraftStateChange })}
    />
  );
}

function RuntimeSettingsSection(input: { children: ReactNode | null }): React.JSX.Element | null {
  if (input.children === null) {
    return null;
  }

  return (
    <SectionBlock title="Runtime">
      <div className="grid gap-4">{input.children}</div>
    </SectionBlock>
  );
}

function ReadySandboxProfileIntegrationSetupSection(input: {
  profileId: string;
  version: number;
  initialRows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  disabled: boolean;
  readOnly: boolean;
  runtimeSettings: ReactNode | null;
  integrationDirectoryQuery: ReturnType<
    typeof useSandboxProfileIntegrationsLoader
  >["integrationDirectoryQuery"];
  onDraftStateChange?: (state: SandboxProfileDraftSectionState) => void;
}): React.JSX.Element {
  const integrationsState = useLoadedSandboxProfileIntegrationsState({
    profileId: input.profileId,
    version: input.version,
    initialRows: input.initialRows,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const onDraftStateChange = input.onDraftStateChange;

  useEffect(() => {
    onDraftStateChange?.({
      applyDraftSaveError: integrationsState.applyDraftSaveError,
      applySavedBindings: integrationsState.applySavedBindings,
      buildIntegrationBindingChanges: integrationsState.buildDraftChanges,
      hasUnpersistedChanges: integrationsState.hasUnsavedChanges,
      integrationRows: integrationsState.integrationRows,
    });
  }, [onDraftStateChange, integrationsState.hasUnsavedChanges, integrationsState.integrationRows]);

  return (
    <SandboxProfilePanelSection>
      <SandboxProfileIntegrationsSetupSection
        availableConnections={integrationsState.availableConnections}
        availableTargets={integrationsState.availableTargets}
        integrationBindingsQuery={{
          isError: false,
          error: null,
          isPending: false,
        }}
        integrationDirectoryQuery={input.integrationDirectoryQuery}
        integrationRows={integrationsState.integrationRows}
        integrationSaveError={integrationsState.integrationSaveError}
        runtimeSettings={input.runtimeSettings}
        disabled={input.disabled}
        readOnly={input.readOnly}
        onAddIntegrationBindingRow={integrationsState.onAddIntegrationBindingRow}
        onIntegrationBindingRowChange={integrationsState.onIntegrationBindingRowChange}
        onRemoveIntegrationBindingRow={integrationsState.onRemoveIntegrationBindingRow}
        onIntegrationSaveErrorDismiss={integrationsState.onIntegrationSaveErrorDismiss}
      />
    </SandboxProfilePanelSection>
  );
}

function LoadedSandboxProfileSetupScriptSection(input: {
  profileId: string;
  version: number;
  disabled: boolean;
  integrationRows: readonly SandboxProfileBindingEditorRow[] | null;
  loader: ReturnType<typeof useSandboxProfileSetupScriptLoader>;
  isDraft: boolean;
  setupAssistantControl: SetupScriptAssistantControl;
  onDraftStateChange?: (state: SandboxProfileDraftSectionState) => void;
}): React.JSX.Element | null {
  if (input.loader.setupScriptQuery.isPending) {
    return null;
  }

  if (input.loader.setupScriptQuery.isError) {
    return (
      <div className="gap-4 flex flex-col">
        <Notice title="Could not load setup script" variant="alert">
          {resolveApiErrorMessage({
            error: input.loader.setupScriptQuery.error,
            fallbackMessage: "Could not load sandbox profile setup script.",
          })}
        </Notice>
        <SandboxProfileSetupScriptPanel disabled={true} value="" />
      </div>
    );
  }

  return (
    <ReadySandboxProfileSetupScriptSection
      isDraft={input.isDraft}
      profileId={input.profileId}
      disabled={input.disabled}
      integrationRows={input.integrationRows}
      setupScript={input.loader.setupScript}
      version={input.version}
      setupAssistantControl={input.setupAssistantControl}
      {...(input.onDraftStateChange === undefined
        ? {}
        : { onDraftStateChange: input.onDraftStateChange })}
    />
  );
}

function ReadySandboxProfileSetupScriptSection(input: {
  profileId: string;
  version: number;
  disabled: boolean;
  integrationRows: readonly SandboxProfileBindingEditorRow[] | null;
  setupScript: string | null;
  isDraft: boolean;
  setupAssistantControl: SetupScriptAssistantControl;
  onDraftStateChange?: (state: SandboxProfileDraftSectionState) => void;
}): React.JSX.Element {
  const setupScriptState = useLoadedSandboxProfileSetupScriptState({
    profileId: input.profileId,
    version: input.version,
    setupScript: input.setupScript,
  });
  const setupScriptTest = useSandboxProfileSetupScriptTestRun({
    disabled: input.disabled,
    isDraft: input.isDraft,
    profileId: input.profileId,
    setupScript: setupScriptState.draftValue,
    version: input.version,
  });
  const onDraftStateChange = input.onDraftStateChange;

  useEffect(() => {
    onDraftStateChange?.({
      applyDraftSaveError: setupScriptState.applyDraftSaveError,
      applySavedSetupScript: setupScriptState.applySavedSetupScript,
      buildDraftChanges: setupScriptState.buildDraftChanges,
      hasUnpersistedChanges: setupScriptState.hasUnsavedChanges,
    });
  }, [onDraftStateChange, setupScriptState.hasUnsavedChanges]);

  return (
    <div className="flex flex-col gap-4">
      {input.setupAssistantControl.errorMessage === null ? null : (
        <Notice variant="alert">{input.setupAssistantControl.errorMessage}</Notice>
      )}
      <SandboxProfileSetupScriptPanel
        errorMessage={setupScriptState.errorMessage}
        onChange={setupScriptState.onChange}
        testControl={
          <SandboxProfileSetupScriptTestButton
            {...setupScriptTest.buttonProps}
            setupAssistant={{
              disabled: input.setupAssistantControl.disabled,
              isStarting: input.setupAssistantControl.isStarting,
              onClick: () => {
                input.setupAssistantControl.onToggle({
                  setupScript: setupScriptState.draftValue,
                });
              },
              title: input.setupAssistantControl.title,
            }}
          />
        }
        testPanel={<SandboxProfileSetupScriptTestPanel {...setupScriptTest.panelProps} />}
        value={setupScriptState.draftValue}
        disabled={input.disabled}
        repositoryHandles={resolveSandboxBaseRepositoryHandles(input.integrationRows)}
      />
    </div>
  );
}

type SetupScriptContextGroup = ReturnType<
  typeof createSandboxBaseSetupScriptContextFromGeneratedInventory
>["environmentAndToolGroups"][number];

function SetupScriptContextGroupRows(input: { group: SetupScriptContextGroup }): React.JSX.Element {
  return (
    <section className="gap-2 flex flex-col">
      <Label>{input.group.title}</Label>
      <div className="flex flex-col pl-3 text-sm">
        {input.group.rows.map((row) => (
          <div className="grid grid-cols-[12rem_minmax(0,1fr)] gap-x-4 py-0.5" key={row.id}>
            <span className="text-muted-foreground break-words">{row.label}</span>
            <span
              className={`text-muted-foreground text-left ${
                row.valueKind === "version" ? "tabular-nums" : ""
              }`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SandboxProfileSetupScriptPanel(input: {
  value: string;
  disabled?: boolean;
  errorMessage?: string | null;
  onChange?: (nextValue: string) => void;
  repositoryHandles?: readonly string[];
  testControl?: ReactNode;
  testPanel?: ReactNode;
}): React.JSX.Element {
  const setupScriptContext = createSandboxBaseSetupScriptContextFromGeneratedInventory(
    input.repositoryHandles,
  );

  return (
    <SectionBlock title="Setup Script">
      <SandboxProfileSectionCard>
        <Field>
          <FieldHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <FieldLabel id="sandbox-setup-script-label">Setup script</FieldLabel>
              {input.testControl}
            </div>
          </FieldHeader>
          <FieldContent>
            <div className="gap-2 flex flex-col">
              {input.testPanel}
              <SandboxSetupScriptEditor
                ariaLabelledBy="sandbox-setup-script-label"
                disabled={input.disabled === true}
                onChange={(nextValue) => {
                  input.onChange?.(nextValue);
                }}
                placeholderText={SetupScriptPlaceholder}
                value={input.value}
              />
              {input.disabled === true ? null : (
                <div className="flex flex-col pt-1">
                  <Accordion className="border-border/70 w-full border-y" multiple>
                    <AccordionItem className="border-border/70" value="how-setup-script-works">
                      <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 text-sm font-medium hover:no-underline focus-visible:border-transparent focus-visible:ring-1">
                        Setup script behavior
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <div className="gap-3 flex flex-col">
                          <div className="gap-1 flex flex-col">
                            <FieldDescription>{SetupScriptTimingDescription}</FieldDescription>
                            <FieldDescription>
                              Repositories are cloned under the working directory, using their
                              <InlineCode variant="muted">owner/repository</InlineCode> path.
                            </FieldDescription>
                            {setupScriptContext.repositoryLocationGroup === null ? (
                              <FieldDescription>
                                For example,{" "}
                                <InlineCode variant="muted">
                                  {setupScriptContext.repositoryLocationExample.handle}
                                </InlineCode>{" "}
                                is available at{" "}
                                <InlineCode variant="muted">
                                  {setupScriptContext.repositoryLocationExample.path}
                                </InlineCode>
                                .
                              </FieldDescription>
                            ) : null}
                          </div>

                          {setupScriptContext.repositoryLocationGroup === null ? null : (
                            <SetupScriptContextGroupRows
                              group={setupScriptContext.repositoryLocationGroup}
                            />
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem className="border-border/70" value="environment-and-tools">
                      <AccordionTrigger className="rounded-none border-0 px-0 py-2.5 text-sm font-medium hover:no-underline focus-visible:border-transparent focus-visible:ring-1">
                        Environment and installed tools
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        <div className="gap-5 flex flex-col">
                          {setupScriptContext.environmentAndToolGroups.map((group) => (
                            <SetupScriptContextGroupRows group={group} key={group.id} />
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              )}

              {input.errorMessage ? (
                <div aria-live="polite" className="text-destructive text-xs" role="status">
                  {input.errorMessage}
                </div>
              ) : null}
            </div>
          </FieldContent>
        </Field>
      </SandboxProfileSectionCard>
    </SectionBlock>
  );
}
