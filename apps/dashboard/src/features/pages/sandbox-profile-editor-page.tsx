import {
  agentDefinitionAllowsRuntime,
  createBrowserDefinitionsBundle,
} from "@mistle/integrations-definitions/browser";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Checkbox,
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
import { SidebarSimpleIcon, TerminalIcon } from "@phosphor-icons/react";
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
import { isUnavailableResourceError } from "../api/http-api-error.js";
import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { NavigationBlockerDialog } from "../navigation/navigation-blocker-dialog.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileDuplicateTriggerUsagesQueryKey,
  sandboxProfileTriggerUsagesQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionSetupScriptQueryKey,
  sandboxProfileVersionsQueryKey,
  sandboxProvidersQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  createSandboxProfileVersionDraft,
  deleteSandboxProfile,
  discardSandboxProfileVersionDraft,
  duplicateSandboxProfile,
  getSandboxProfile,
  getSandboxProfileVersionDraftTriggerImpact,
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
  SandboxProfileVersionDraftTriggerImpactTrigger,
  SandboxProfileVersionDraftTriggerImpactIssue,
  SandboxProfileVersionDraftTriggerImpact,
  SandboxProfileVersion,
  SandboxProfileVersionIntegrationBinding,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { stopSandboxInstance } from "../sessions/sessions-service.js";
import {
  apiKeysQueryKey,
  createApiKey,
  listApiKeys,
  type ApiKeysPage,
} from "../settings/api-keys/api-keys-service.js";
import {
  listOrganizationIdentityLinkProviders,
  organizationIdentityLinkProvidersQueryKey,
} from "../settings/identity-linking/organization-identity-linking-service.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { NoLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { UnavailableResourceState } from "../shared/unavailable-resource-state.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import {
  listCopyableTriggersForSandboxProfile,
  listTriggersForSandboxProfile,
  type TriggerSandboxProfileUsage,
} from "../triggers/triggers-service.js";
import {
  createSandboxBaseSetupScriptContextFromGeneratedInventory,
  resolveSandboxBaseRepositoryHandles,
  SetupScriptTimingDescription,
} from "./sandbox-base-inventory-copy.js";
import { SandboxOperationProgress } from "./sandbox-operation-progress.js";
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
  resolveSetupAssistantCloseSandboxInstanceId,
  resolveSetupAssistantStartDialogVariant,
  shouldPollSandboxProfileSnapshotJobs,
  shouldRedirectDraftSandboxProfileViewToPublished,
  type SandboxProfileEditorVersionMode,
  type SandboxProfileRouteView,
  type SetupAssistantStartDialogVariant,
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
import { createDefaultMistleSandboxRuntimeConfig } from "./sandbox-profile-runtime-defaults.js";
import {
  createRuntimeDraftSourceVersionKey,
  SandboxProfileRuntimeSection,
  type SandboxProfileRuntimeDraftChanges,
  type SandboxProfileRuntimeDraftState,
} from "./sandbox-profile-runtime-section.js";
import { SandboxProfileScriptEditorPanel } from "./sandbox-profile-script-editor-panel.js";
import {
  useLoadedSandboxProfileSetupScriptState,
  useSandboxProfileSetupScriptLoader,
} from "./sandbox-profile-setup-script-state.js";
import {
  SandboxProfileSetupScriptTestPanel,
  useSandboxProfileSetupScriptTestRun,
  type SetupScriptTestButtonProps,
} from "./sandbox-profile-setup-script-test.js";
import {
  SandboxProfileSkillsSection,
  type SandboxProfileSkillsDraftState,
} from "./sandbox-profile-skills-section.js";
import {
  SandboxProfileSnapshotPanel,
  resolveSnapshotPanelState,
  type SnapshotPanelState,
} from "./sandbox-profile-snapshot-panel.js";
import { SandboxProfileTriggersSection } from "./sandbox-profile-triggers-section.js";
import { createComposerDraft } from "./session-composer/session-composer-draft.js";
import {
  SessionConversationBottomPanelController,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import type { PendingSessionDiffComment } from "./session-diff-comment.js";
import { SessionStartupStatus, type SessionStartupState } from "./session-startup-status.js";
import {
  SessionTerminalWorkspace,
  type SessionTerminalWorkspaceHandle,
} from "./session-terminal-workspace.js";
import {
  buildSetupAssistantComposerPlaceholder,
  buildSetupAssistantCollaborationModeSettings,
  type SetupAssistantScriptKind,
} from "./setup-assistant-instructions.js";
import { useSessionWorkbenchController } from "./use-session-workbench-controller.js";

type SandboxProfileEditorPageProps =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
    };

type SandboxProfileEditorSectionId = "sandbox-profile" | "triggers" | "snapshot";
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
type SandboxProfileRuntimeSettingsDraftState = SandboxProfileRuntimeDraftState;
type SandboxProfileSkillsSettingsDraftState = SandboxProfileSkillsDraftState;
type SandboxProfileGitCommitSigningDraftState = {
  gitCommitSigningIntegrationConnectionId: string | null | undefined;
  sourceVersionKey: string | undefined;
  hasUnpersistedChanges: boolean;
};
type SetupScriptAssistantControl = {
  disabled: boolean;
  errorMessage: string | null;
  isStarting: boolean;
  onToggle: () => void;
  title: string;
};
type SetupScriptAssistantPanelState = {
  isOpen: boolean;
  placeholderText: string;
  sandboxInstanceId: string | null;
  scriptKind: SetupAssistantScriptKind;
  startupOperationId: string | null;
};

type SetupAssistantStartupOperation = {
  operationId: string;
} | null;

type SetupAssistantCloseDialogState = {
  navigationSectionId: SandboxProfileEditorSectionId | null;
  sandboxInstanceId: string | null;
} | null;
type SetupAssistantStartDialogState = {
  scriptKind: SetupAssistantScriptKind;
  version: number;
  variant: SetupAssistantStartDialogVariant;
} | null;

function createIdleSandboxProfileDraftSectionState(): SandboxProfileDraftSectionState {
  return {
    hasUnpersistedChanges: false,
  };
}

function createIdleSandboxProfileRuntimeDraftState(): SandboxProfileRuntimeSettingsDraftState {
  return {
    agentRuntimeId: undefined,
    sourceVersionKey: undefined,
    hasUnpersistedChanges: false,
  };
}

function createIdleSandboxProfileSkillsDraftState(): SandboxProfileSkillsSettingsDraftState {
  return {
    skillsConfig: undefined,
    sourceVersionKey: undefined,
    saveBlockedMessage: null,
    hasUnpersistedChanges: false,
  };
}

function createIdleSandboxProfileGitCommitSigningDraftState(): SandboxProfileGitCommitSigningDraftState {
  return {
    gitCommitSigningIntegrationConnectionId: undefined,
    sourceVersionKey: undefined,
    hasUnpersistedChanges: false,
  };
}

export function updateSandboxProfileGitCommitSigningDraftState(input: {
  currentState: SandboxProfileGitCommitSigningDraftState;
  currentVersion: SandboxProfileVersion | null;
  connectionId: string | null;
}): SandboxProfileGitCommitSigningDraftState {
  return {
    ...input.currentState,
    gitCommitSigningIntegrationConnectionId: input.connectionId,
    sourceVersionKey:
      input.currentVersion === null
        ? input.currentState.sourceVersionKey
        : createRuntimeDraftSourceVersionKey(input.currentVersion),
    hasUnpersistedChanges:
      input.currentVersion?.gitCommitSigningIntegrationConnectionId !== input.connectionId,
  };
}

export function resolveSelectedSandboxProfileAgentRuntimeId(input: {
  currentVersion: SandboxProfileVersion | null;
  runtimeDraftState: Pick<
    SandboxProfileRuntimeSettingsDraftState,
    "agentRuntimeId" | "sourceVersionKey"
  >;
}): SandboxProfileVersion["agentRuntimeId"] {
  const currentVersionRuntimeId = input.currentVersion?.agentRuntimeId ?? "codex";
  if (input.currentVersion === null || input.runtimeDraftState.sourceVersionKey === undefined) {
    return currentVersionRuntimeId;
  }

  if (
    input.runtimeDraftState.sourceVersionKey !==
    createRuntimeDraftSourceVersionKey(input.currentVersion)
  ) {
    return currentVersionRuntimeId;
  }

  return input.runtimeDraftState.agentRuntimeId ?? currentVersionRuntimeId;
}

export function resolveSelectedSandboxProfileGitCommitSigningIntegrationConnectionId(input: {
  currentVersion: SandboxProfileVersion | null;
  gitCommitSigningDraftState: Pick<
    SandboxProfileGitCommitSigningDraftState,
    "gitCommitSigningIntegrationConnectionId" | "sourceVersionKey"
  >;
}): string | null {
  const currentVersionConnectionId =
    input.currentVersion?.gitCommitSigningIntegrationConnectionId ?? null;
  if (
    input.currentVersion === null ||
    input.gitCommitSigningDraftState.sourceVersionKey === undefined
  ) {
    return currentVersionConnectionId;
  }

  if (
    input.gitCommitSigningDraftState.sourceVersionKey !==
    createRuntimeDraftSourceVersionKey(input.currentVersion)
  ) {
    return currentVersionConnectionId;
  }

  return input.gitCommitSigningDraftState.gitCommitSigningIntegrationConnectionId === undefined
    ? currentVersionConnectionId
    : input.gitCommitSigningDraftState.gitCommitSigningIntegrationConnectionId;
}

export function buildSandboxProfileRuntimeDraftChanges(input: {
  currentVersion: SandboxProfileVersion | null;
  runtimeDraftState: SandboxProfileRuntimeSettingsDraftState;
}): SandboxProfileRuntimeDraftChanges {
  if (input.runtimeDraftState.buildDraftChanges !== undefined) {
    return input.runtimeDraftState.buildDraftChanges();
  }

  const currentVersion = input.currentVersion;
  if (currentVersion === null) {
    throw new Error("Sandbox profile runtime version is missing.");
  }

  if (currentVersion.sandboxProvider === null) {
    throw new Error("Sandbox runtime provider is missing.");
  }

  return {
    agentRuntimeId: resolveSelectedSandboxProfileAgentRuntimeId({
      currentVersion,
      runtimeDraftState: input.runtimeDraftState,
    }),
    mistleMcpEnabled: currentVersion.mistleMcpEnabled,
    mistleMcpApiKeyId: currentVersion.mistleMcpApiKeyId,
    sandboxProvider: currentVersion.sandboxProvider,
    sandboxConnectionId: currentVersion.sandboxConnectionId,
    sandboxResources: currentVersion.sandboxResources,
  };
}

const AgentRuntimeRequiredErrorCode = "AGENT_RUNTIME_REQUIRED";
const AgentRuntimeConnectionRequiredErrorCode = "AGENT_RUNTIME_CONNECTION_REQUIRED";
const SetupAssistantAgentRuntimeRequiredMessage =
  "Select and save an agent runtime connection before using Setup Assistant.";
const SaveDraftAgentRuntimeConnectionRequiredMessage = "Select an agent runtime connection.";
const DraftSaveWorkflowErrorMessage =
  "Saving draft failed. Fix the highlighted profile settings below and try again.";

const IntegrationDraftSaveErrorCodes = new Set([
  "CONNECTION_MISMATCH",
  "CONNECTION_NOT_ACTIVE",
  "INVALID_BINDING_CONFIG",
  "INVALID_BINDING_CONNECTION_REFERENCE",
  "INVALID_CONNECTION_TARGET_REFERENCE",
  "INVALID_TARGET_CONFIG",
  "INVALID_TARGET_SECRETS",
  "KIND_MISMATCH",
  "TARGET_DISABLED",
]);
const RuntimeDraftSaveErrorCodes = new Set([
  "INVALID_MISTLE_MCP_CONFIG",
  "INVALID_SANDBOX_PROVIDER",
  "INVALID_SANDBOX_RUNTIME_CONFIG",
  "SANDBOX_PROVIDER_REQUIRED",
]);
const SkillsDraftSaveErrorCodes = new Set([
  "SELECTED_SKILLS_NOT_FOUND",
  "SKILLS_SOURCE_NOT_BOUND",
  "SKILLS_SOURCE_NOT_LOADED",
]);
const SetupScriptDraftSaveErrorCodes = new Set(["INVALID_SETUP_SCRIPT"]);

type DraftSaveErrorOwner =
  | "agent-runtime-connection"
  | "generic"
  | "integrations"
  | "runtime"
  | "setup-script"
  | "skills";

const Definitions = createBrowserDefinitionsBundle();
const IntegrationRegistry = Definitions.integrationRegistry;

function hasSetupAssistantAgentRuntimeConnection(input: {
  integrationRows: readonly SandboxProfileBindingEditorRow[] | null;
  agentRuntimeId: SandboxProfileVersion["agentRuntimeId"];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): boolean {
  if (input.integrationRows === null) {
    return false;
  }

  return input.integrationRows.some((row) => {
    if (row.kind !== "agent") {
      return false;
    }

    const connection = input.availableConnections.find(
      (candidate) => candidate.id === row.connectionId,
    );
    if (connection === undefined) {
      return false;
    }

    const target = input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    );
    if (target === undefined) {
      return false;
    }

    return agentDefinitionAllowsRuntime({
      definition: IntegrationRegistry.getDefinition({
        familyId: target.familyId,
        variantId: target.variantId,
      }),
      runtimeId: input.agentRuntimeId,
    });
  });
}

export function resolveDraftSaveErrorOwner(error: unknown): DraftSaveErrorOwner {
  if (!(error instanceof SandboxProfilesApiError) || error.code === null) {
    return "generic";
  }

  if (error.code === AgentRuntimeConnectionRequiredErrorCode) {
    return "agent-runtime-connection";
  }

  if (IntegrationDraftSaveErrorCodes.has(error.code)) {
    return "integrations";
  }

  if (RuntimeDraftSaveErrorCodes.has(error.code)) {
    return "runtime";
  }

  if (SkillsDraftSaveErrorCodes.has(error.code)) {
    return "skills";
  }

  if (SetupScriptDraftSaveErrorCodes.has(error.code)) {
    return "setup-script";
  }

  return "generic";
}

const SetupScriptPlaceholder = `#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap`;

const SandboxProfileEditorSectionIds = {
  SANDBOX_PROFILE: "sandbox-profile",
  TRIGGERS: "triggers",
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

function createSandboxProfileTriggersPath(profileId: string): string {
  return `/sandbox-profiles/${profileId}/triggers`;
}

function resolveSandboxProfileCanDuplicate(input: {
  profile: SandboxProfile;
  versions: readonly SandboxProfileVersion[];
}): boolean {
  if (input.profile.activeVersion === null) {
    return false;
  }

  return (
    input.versions.find((version) => version.version === input.profile.activeVersion)?.usable ===
    true
  );
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

  if (input.sectionId === SandboxProfileEditorSectionIds.TRIGGERS) {
    return createSandboxProfileTriggersPath(input.profileId);
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
      basePath: createSandboxProfileTriggersPath(input.profileId),
      pathname: input.pathname,
    })
  ) {
    return SandboxProfileEditorSectionIds.TRIGGERS;
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
      basePath: createSandboxProfileTriggersPath(input.profileId),
      pathname: input.pathname,
    })
  ) {
    return {
      sectionId: SandboxProfileEditorSectionIds.TRIGGERS,
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
  const sandboxProvidersQuery = useQuery({
    queryKey: sandboxProvidersQueryKey(),
    queryFn: async ({ signal }) => listSandboxProviders({ signal }),
  });
  const defaultRuntimeConfig =
    sandboxProvidersQuery.data === undefined
      ? undefined
      : createDefaultMistleSandboxRuntimeConfig(sandboxProvidersQuery.data.items);
  const metaState = useCreateSandboxProfileMetaState({
    navigate,
    defaultRuntimeConfig,
    invalidateSandboxProfiles: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["sandbox-profiles"],
      });
    },
  });
  const createIsDisabled =
    metaState.isDisplayNameInvalid ||
    metaState.isCreating ||
    defaultRuntimeConfig === undefined ||
    sandboxProvidersQuery.isError;

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
        {sandboxProvidersQuery.isError ? (
          <Notice title="Could not load sandbox providers" variant="alert">
            {resolveApiErrorMessage({
              error: sandboxProvidersQuery.error,
              fallbackMessage: "Could not load sandbox providers.",
            })}
          </Notice>
        ) : null}
        {sandboxProvidersQuery.isSuccess && defaultRuntimeConfig === undefined ? (
          <Notice title="Mistle sandbox provider unavailable" variant="alert">
            No managed sandbox provider is configured for this deployment.
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
                <Button disabled={createIsDisabled} type="submit">
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

export function resolveSandboxProfileEditorRefetchInterval(input: {
  profileError: unknown;
  profileVersionsError: unknown;
  versions: readonly SandboxProfileVersion[] | undefined;
}): false | number {
  if (
    isUnavailableResourceError(input.profileError) ||
    isUnavailableResourceError(input.profileVersionsError)
  ) {
    return false;
  }

  return shouldPollSandboxProfileSnapshotJobs(input.versions) ? 3_000 : false;
}

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
  const resolveEditorRefetchInterval = (): false | number =>
    resolveSandboxProfileEditorRefetchInterval({
      profileError: queryClient.getQueryState(profileDetailKey)?.error,
      profileVersionsError: queryClient.getQueryState(profileVersionsKey)?.error,
      versions: queryClient.getQueryData<{ versions: readonly SandboxProfileVersion[] }>(
        profileVersionsKey,
      )?.versions,
    });

  const profileQuery = useQuery({
    queryKey: profileDetailKey,
    queryFn: async ({ signal }) => getSandboxProfile({ profileId, signal }),
    refetchInterval: resolveEditorRefetchInterval,
    retry: false,
  });
  const profileVersionsQuery = useQuery({
    queryKey: profileVersionsKey,
    queryFn: async ({ signal }) =>
      listSandboxProfileVersions({
        profileId,
        signal,
      }),
    refetchInterval: resolveEditorRefetchInterval,
    retry: false,
  });

  if (profileQuery.isError && isUnavailableResourceError(profileQuery.error)) {
    return (
      <PageFrame width="normal">
        <UnavailableResourceState />
      </PageFrame>
    );
  }

  if (profileQuery.isPending || profileVersionsQuery.isPending) {
    return <PageFrame width="normal">{null}</PageFrame>;
  }

  if (profileQuery.isError || profileQuery.data === undefined) {
    return (
      <PageFrame width="normal" title="Edit profile">
        <Card>
          <CardContent className="gap-3 flex flex-col pt-4">
            <Notice title="Could not load profile" variant="alert">
              {resolveApiErrorMessage({
                error: profileQuery.error,
                fallbackMessage: "Could not load sandbox profile.",
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

  if (profileVersionsQuery.isError && isUnavailableResourceError(profileVersionsQuery.error)) {
    return (
      <PageFrame width="normal">
        <UnavailableResourceState />
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
  const [isDuplicateProfileDialogOpen, setIsDuplicateProfileDialogOpen] = useState(false);
  const [deleteProfileError, setDeleteProfileError] = useState<string | null>(null);
  const [duplicateProfileError, setDuplicateProfileError] = useState<string | null>(null);
  const [draftEditorResetKey, setDraftEditorResetKey] = useState(0);
  const duplicateProfileIsAvailable = resolveSandboxProfileCanDuplicate({
    profile: input.profile,
    versions: input.versions,
  });
  const triggerUsagesQuery = useQuery({
    queryKey: sandboxProfileTriggerUsagesQueryKey(input.profileId),
    queryFn: async ({ signal }) =>
      listTriggersForSandboxProfile({
        sandboxProfileId: input.profileId,
        signal,
      }),
    enabled: isDeleteProfileDialogOpen,
    retry: false,
  });
  const duplicateTriggerUsagesQuery = useQuery({
    queryKey: sandboxProfileDuplicateTriggerUsagesQueryKey({
      profileId: input.profileId,
      activeVersion: input.profile.activeVersion,
    }),
    queryFn: async ({ signal }) => {
      if (input.profile.activeVersion === null) {
        return [];
      }

      return await listCopyableTriggersForSandboxProfile({
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: input.profile.activeVersion,
        signal,
      });
    },
    enabled: duplicateProfileIsAvailable,
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
    mutationFn: async (request: { version: number; refreshKind: "setup" | "maintenance" }) =>
      refreshSandboxProfileVersion({
        profileId: input.profileId,
        version: request.version,
        refreshKind: request.refreshKind,
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
  const duplicateProfileMutation = useMutation({
    mutationFn: async (payload: { displayName: string; includeTriggers: boolean }) =>
      duplicateSandboxProfile({
        payload: {
          profileId: input.profileId,
          displayName: payload.displayName,
          includeTriggers: payload.includeTriggers,
        },
      }),
    onSuccess: async (result) => {
      setDuplicateProfileError(null);
      setIsDuplicateProfileDialogOpen(false);
      await input.invalidateSandboxProfiles();
      void input.navigate(
        createSandboxProfileEditorPath({
          profileId: result.profile.id,
          view: "published",
        }),
      );
    },
    onError: (error: unknown) => {
      setDuplicateProfileError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not duplicate sandbox profile.",
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
      onRefreshSnapshot={(request) => {
        refreshSnapshotMutation.mutate(request);
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
      deleteProfileTriggerUsages={triggerUsagesQuery.data ?? []}
      deleteProfileTriggerUsagesError={
        triggerUsagesQuery.isError
          ? resolveApiErrorMessage({
              error: triggerUsagesQuery.error,
              fallbackMessage: "Could not load triggers.",
            })
          : null
      }
      deleteProfileTriggerUsagesIsPending={
        isDeleteProfileDialogOpen && triggerUsagesQuery.isPending
      }
      deleteProfileError={deleteProfileError}
      deleteProfileIsPending={deleteProfileMutation.isPending}
      duplicateProfileIsAvailable={duplicateProfileIsAvailable}
      duplicateProfileError={duplicateProfileError}
      duplicateProfileIsPending={duplicateProfileMutation.isPending}
      duplicateProfileTriggerUsages={duplicateTriggerUsagesQuery.data ?? []}
      duplicateProfileTriggerUsagesError={
        duplicateProfileIsAvailable && duplicateTriggerUsagesQuery.isError
          ? resolveApiErrorMessage({
              error: duplicateTriggerUsagesQuery.error,
              fallbackMessage: "Could not load triggers.",
            })
          : null
      }
      duplicateProfileTriggerUsagesIsPending={
        duplicateProfileIsAvailable && duplicateTriggerUsagesQuery.isPending
      }
      isDeleteProfileDialogOpen={isDeleteProfileDialogOpen}
      isDuplicateProfileDialogOpen={isDuplicateProfileDialogOpen}
      onConfirmDeleteProfile={() => {
        if (triggerUsagesQuery.isPending || triggerUsagesQuery.isError) {
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
      onConfirmDuplicateProfile={(request) => {
        duplicateProfileMutation.mutate(request);
      }}
      onDuplicateProfileDialogOpenChange={(open) => {
        if (duplicateProfileMutation.isPending) {
          return;
        }
        if (open && duplicateTriggerUsagesQuery.isPending) {
          return;
        }
        setDuplicateProfileError(null);
        setIsDuplicateProfileDialogOpen(open);
      }}
      versionActionError={versionActionError}
      versionActionIsPending={
        publishMutation.isPending ||
        createDraftMutation.isPending ||
        discardDraftMutation.isPending ||
        refreshSnapshotMutation.isPending ||
        retryPublishSnapshotMutation.isPending ||
        duplicateProfileMutation.isPending
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
  deleteProfileTriggerUsages: readonly TriggerSandboxProfileUsage[];
  deleteProfileTriggerUsagesError: string | null;
  deleteProfileTriggerUsagesIsPending: boolean;
  deleteProfileError: string | null;
  deleteProfileIsPending: boolean;
  duplicateProfileIsAvailable: boolean;
  duplicateProfileError?: string | null;
  duplicateProfileIsPending?: boolean;
  duplicateProfileTriggerUsages?: readonly TriggerSandboxProfileUsage[];
  duplicateProfileTriggerUsagesError?: string | null;
  duplicateProfileTriggerUsagesIsPending?: boolean;
  isDeleteProfileDialogOpen: boolean;
  isDuplicateProfileDialogOpen?: boolean;
  onPublish: (version: number) => Promise<void>;
  onRefreshSnapshot: (input: { version: number; refreshKind: "setup" | "maintenance" }) => void;
  onRetryPublishSnapshot: (version: number) => void;
  onDiscardChangesAndLeaveDraft: (input: { draftVersion: number }) => void;
  onConfirmDeleteProfile: () => void;
  onDeleteProfileDialogOpenChange: (open: boolean) => void;
  onConfirmDuplicateProfile?: (input: { displayName: string; includeTriggers: boolean }) => void;
  onDuplicateProfileDialogOpenChange?: (open: boolean) => void;
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
  const [integrationDraftState, setIntegrationDraftState] = useState(
    createIdleSandboxProfileDraftSectionState,
  );
  const [setupScriptDraftState, setSetupScriptDraftState] = useState(
    createIdleSandboxProfileDraftSectionState,
  );
  const [runtimeDraftState, setRuntimeDraftState] = useState(
    createIdleSandboxProfileRuntimeDraftState,
  );
  const [skillsDraftState, setSkillsDraftState] = useState(
    createIdleSandboxProfileSkillsDraftState,
  );
  const [gitCommitSigningDraftState, setGitCommitSigningDraftState] = useState(
    createIdleSandboxProfileGitCommitSigningDraftState,
  );
  const [publishRequestIsPending, setPublishRequestIsPending] = useState(false);
  const [saveDraftRequestIsPending, setSaveDraftRequestIsPending] = useState(false);
  const [publishFlushError, setPublishFlushError] = useState<string | null>(null);
  const [draftTriggerImpactAffectedTriggers, setDraftTriggerImpactAffectedTriggers] = useState<
    readonly SandboxProfileVersionDraftTriggerImpactTrigger[] | null
  >(null);
  const [draftTriggerImpactError, setDraftTriggerImpactError] = useState<string | null>(null);
  const [setupAssistantError, setSetupAssistantError] = useState<string | null>(null);
  const [
    showSetupAssistantAgentRuntimeConnectionError,
    setShowSetupAssistantAgentRuntimeConnectionError,
  ] = useState(false);
  const [saveDraftAgentRuntimeConnectionError, setSaveDraftAgentRuntimeConnectionError] = useState<
    string | null
  >(null);
  const [publishSuccessNoticeKey, setPublishSuccessNoticeKey] = useState(0);
  const [showPublishSuccessMessage, setShowPublishSuccessMessage] = useState(
    input.publishSuccessMessage,
  );
  const [setupAssistantPanelState, setSetupAssistantPanelState] =
    useState<SetupScriptAssistantPanelState | null>(null);
  const setupAssistantClosedDuringStartupRef = useRef(false);
  const setupAssistantPanelIsOpen = setupAssistantPanelState?.isOpen === true;
  const maintenanceAssistantPanelIsOpen =
    setupAssistantPanelState?.isOpen === true &&
    setupAssistantPanelState.scriptKind === "maintenance";
  const setupScriptLoader = useSandboxProfileSetupScriptLoader({
    profileId: input.profileId,
    refetchIntervalMs: setupAssistantPanelIsOpen ? 2_000 : false,
    version: input.mode.version,
  });
  useEffect(() => {
    setGitCommitSigningDraftState(createIdleSandboxProfileGitCommitSigningDraftState());
  }, [
    input.currentVersion?.gitCommitSigningIntegrationConnectionId,
    input.currentVersion?.sandboxProfileId,
    input.currentVersion?.version,
    input.draftEditorResetKey,
  ]);
  const [setupAssistantCloseDialogState, setSetupAssistantCloseDialogState] =
    useState<SetupAssistantCloseDialogState>(null);
  const [setupAssistantStartDialogState, setSetupAssistantStartDialogState] =
    useState<SetupAssistantStartDialogState>(null);
  const activeSectionId = input.routeSectionId;
  const draftFieldsAreReadOnly =
    input.mode.kind !== "draft" || publishRequestIsPending || saveDraftRequestIsPending;
  const snapshotVersion = resolveLatestPublishedSandboxProfileVersion(input.versions);
  const snapshotPanelState = resolveSnapshotPanelState(
    snapshotVersion,
    input.profile.activeVersion,
  );
  const setupAssistantOwningSectionId =
    setupAssistantPanelState?.isOpen === true
      ? setupAssistantPanelState.scriptKind === "maintenance"
        ? SandboxProfileEditorSectionIds.SNAPSHOT
        : SandboxProfileEditorSectionIds.SANDBOX_PROFILE
      : null;
  const editorSections = SandboxProfileEditorTabs;
  const setupAssistantIntegrationRows = resolveSandboxProfileSetupScriptIntegrationRows(
    integrationsLoader.initialRows,
    integrationDraftState.integrationRows,
  );
  const setupAssistantSelectedAgentRuntimeId = resolveSelectedSandboxProfileAgentRuntimeId({
    currentVersion: input.currentVersion,
    runtimeDraftState,
  });
  const setupAssistantLatestSavedDraftHasAgentRuntime =
    input.mode.kind === "draft" &&
    hasSetupAssistantAgentRuntimeConnection({
      integrationRows: integrationsLoader.initialRows,
      agentRuntimeId: input.currentVersion?.agentRuntimeId ?? setupAssistantSelectedAgentRuntimeId,
      availableConnections: integrationsLoader.availableConnections,
      availableTargets: integrationsLoader.availableTargets,
    });
  const setupAssistantLocalDraftHasAgentRuntime =
    input.mode.kind === "draft" &&
    hasSetupAssistantAgentRuntimeConnection({
      integrationRows: setupAssistantIntegrationRows,
      agentRuntimeId: setupAssistantSelectedAgentRuntimeId,
      availableConnections: integrationsLoader.availableConnections,
      availableTargets: integrationsLoader.availableTargets,
    });
  const setupAssistantHasVersionDraftChanges =
    integrationDraftState.hasUnpersistedChanges ||
    gitCommitSigningDraftState.hasUnpersistedChanges ||
    skillsDraftState.hasUnpersistedChanges ||
    setupScriptDraftState.hasUnpersistedChanges ||
    runtimeDraftState.hasUnpersistedChanges;
  useEffect(() => {
    if (setupAssistantLocalDraftHasAgentRuntime) {
      setShowSetupAssistantAgentRuntimeConnectionError(false);
      setSaveDraftAgentRuntimeConnectionError(null);
    }
  }, [setupAssistantLocalDraftHasAgentRuntime]);
  const agentRuntimeConnectionErrorMessage =
    saveDraftAgentRuntimeConnectionError ??
    (showSetupAssistantAgentRuntimeConnectionError
      ? SetupAssistantAgentRuntimeRequiredMessage
      : null);
  const updateGitCommitSigningIntegrationConnectionId = useCallback(
    (connectionId: string | null) => {
      setGitCommitSigningDraftState((currentState) =>
        updateSandboxProfileGitCommitSigningDraftState({
          connectionId,
          currentState,
          currentVersion: input.currentVersion,
        }),
      );
    },
    [input.currentVersion],
  );
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
  const stopSetupAssistantMutation = useMutation({
    meta: NoLoadingIndicatorMeta,
    mutationFn: async (sandboxInstanceId: string) =>
      stopSandboxInstance({
        instanceId: sandboxInstanceId,
        idempotencyKey: crypto.randomUUID(),
      }),
    onError: (error: unknown) => {
      console.error(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not stop Setup Assistant.",
        }),
      );
    },
  });
  const startSetupAssistantMutation = useMutation({
    meta: NoLoadingIndicatorMeta,
    mutationFn: async (request: { scriptKind: SetupAssistantScriptKind; version: number }) =>
      startSandboxProfileSetupAssistant({
        idempotencyKey: crypto.randomUUID(),
        profileId: input.profileId,
        scriptKind: request.scriptKind,
        version: request.version,
      }),
    onSuccess: (result) => {
      setSetupAssistantError(null);
      if (setupAssistantClosedDuringStartupRef.current) {
        setupAssistantClosedDuringStartupRef.current = false;
        stopSetupAssistantMutation.mutate(result.sandboxInstanceId);
        return;
      }

      setSetupAssistantPanelState((currentState) => {
        if (currentState === null) {
          return currentState;
        }

        return {
          ...currentState,
          sandboxInstanceId: result.sandboxInstanceId,
          startupOperationId: result.workflowRunId,
        };
      });
    },
    onError: (error: unknown) => {
      setupAssistantClosedDuringStartupRef.current = false;
      setSetupAssistantPanelState((currentState) =>
        currentState === null
          ? currentState
          : {
              ...currentState,
              isOpen: false,
            },
      );
      setSetupAssistantError(
        error instanceof SandboxProfilesApiError &&
          (error.code === AgentRuntimeRequiredErrorCode ||
            error.code === AgentRuntimeConnectionRequiredErrorCode)
          ? SetupAssistantAgentRuntimeRequiredMessage
          : resolveApiErrorMessage({
              error,
              fallbackMessage: "Could not start Setup Assistant.",
            }),
      );
      if (
        error instanceof SandboxProfilesApiError &&
        error.code === AgentRuntimeConnectionRequiredErrorCode
      ) {
        setShowSetupAssistantAgentRuntimeConnectionError(true);
      }
    },
  });
  function navigateToEditorSection(sectionId: SandboxProfileEditorSectionId): void {
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
  }

  function requestSetupAssistantPanelClose(): void {
    setSetupAssistantCloseDialogState({
      navigationSectionId: null,
      sandboxInstanceId: setupAssistantPanelState?.sandboxInstanceId ?? null,
    });
  }

  function cancelSetupAssistantPanelClose(): void {
    setSetupAssistantCloseDialogState(null);
  }

  function confirmSetupAssistantPanelClose(): void {
    if (setupAssistantCloseDialogState === null) {
      return;
    }

    const navigationSectionId = setupAssistantCloseDialogState.navigationSectionId;
    const sandboxInstanceId = resolveSetupAssistantCloseSandboxInstanceId({
      currentPanelSandboxInstanceId: setupAssistantPanelState?.sandboxInstanceId ?? null,
      dialogSandboxInstanceId: setupAssistantCloseDialogState.sandboxInstanceId,
    });
    setSetupAssistantCloseDialogState(null);
    setSetupAssistantPanelState(null);
    if (navigationSectionId !== null) {
      navigateToEditorSection(navigationSectionId);
    }
    if (sandboxInstanceId === null) {
      setupAssistantClosedDuringStartupRef.current = startSetupAssistantMutation.isPending;
      return;
    }

    setupAssistantClosedDuringStartupRef.current = false;
    stopSetupAssistantMutation.mutate(sandboxInstanceId);
  }

  function startSetupAssistant(inputValue: {
    scriptKind: SetupAssistantScriptKind;
    version: number;
  }): void {
    if (setupAssistantPanelState?.isOpen === true) {
      return;
    }

    setSetupAssistantError(null);
    setupAssistantClosedDuringStartupRef.current = false;
    const placeholderText = buildSetupAssistantComposerPlaceholder(inputValue.scriptKind);

    setSetupAssistantPanelState((currentState) => ({
      isOpen: true,
      placeholderText,
      sandboxInstanceId: currentState?.sandboxInstanceId ?? null,
      scriptKind: inputValue.scriptKind,
      startupOperationId: currentState?.startupOperationId ?? null,
    }));

    if (
      (setupAssistantPanelState !== null && setupAssistantPanelState.sandboxInstanceId !== null) ||
      startSetupAssistantMutation.isPending
    ) {
      return;
    }

    startSetupAssistantMutation.mutate({
      scriptKind: inputValue.scriptKind,
      version: inputValue.version,
    });
  }

  async function saveDraftAndStartSetupAssistant(
    dialogState: Exclude<SetupAssistantStartDialogState, null>,
  ): Promise<void> {
    setSaveDraftRequestIsPending(true);
    setDraftTriggerImpactAffectedTriggers(null);
    setDraftTriggerImpactError(null);
    try {
      const draftSaved = await saveDraftChanges();
      if (!draftSaved) {
        return;
      }

      setSetupAssistantStartDialogState(null);
      startSetupAssistant({
        scriptKind: dialogState.scriptKind,
        version: dialogState.version,
      });
    } finally {
      setSaveDraftRequestIsPending(false);
    }
  }

  function handleUseLatestSavedDraftSetupAssistant(
    dialogState: Exclude<SetupAssistantStartDialogState, null>,
  ): void {
    setSetupAssistantStartDialogState(null);
    startSetupAssistant({
      scriptKind: dialogState.scriptKind,
      version: dialogState.version,
    });
  }

  async function saveDraftBeforeSkillsReload(): Promise<boolean> {
    setSaveDraftRequestIsPending(true);
    setDraftTriggerImpactAffectedTriggers(null);
    setDraftTriggerImpactError(null);
    try {
      return await saveDraftChanges();
    } finally {
      setSaveDraftRequestIsPending(false);
    }
  }

  const setupAssistantDisabledReason =
    input.mode.kind !== "draft"
      ? "Setup Assistant is only available while editing a draft."
      : setupAssistantIntegrationRows === null
        ? "Integration bindings are still loading."
        : !setupAssistantLatestSavedDraftHasAgentRuntime && !setupAssistantLocalDraftHasAgentRuntime
          ? SetupAssistantAgentRuntimeRequiredMessage
          : draftFieldsAreReadOnly
            ? "Setup Assistant is unavailable while draft changes are saving."
            : startSetupAssistantMutation.isPending
              ? "Setup Assistant is starting."
              : null;
  const maintenanceAssistantDisabledReason =
    snapshotVersion === null
      ? "Publish this sandbox profile before using Setup Assistant."
      : startSetupAssistantMutation.isPending
        ? "Setup Assistant is starting."
        : null;
  function createSetupAssistantControl(inputValue: {
    defaultTitle: string;
    disabledReason: string | null;
    resolveVersion: () => number | null;
    scriptKind: SetupAssistantScriptKind;
  }): SetupScriptAssistantControl {
    const agentRuntimeConnectionIsRequired =
      inputValue.scriptKind === "setup" &&
      inputValue.disabledReason === SetupAssistantAgentRuntimeRequiredMessage;
    return {
      disabled:
        setupAssistantPanelIsOpen ||
        (inputValue.disabledReason !== null && !agentRuntimeConnectionIsRequired),
      errorMessage: setupAssistantError,
      isStarting: !setupAssistantPanelIsOpen && startSetupAssistantMutation.isPending,
      onToggle: () => {
        if (setupAssistantPanelState?.isOpen === true) {
          return;
        }

        if (agentRuntimeConnectionIsRequired) {
          setSetupAssistantError(SetupAssistantAgentRuntimeRequiredMessage);
          setShowSetupAssistantAgentRuntimeConnectionError(true);
          return;
        }

        const version = inputValue.resolveVersion();
        if (version === null) {
          return;
        }

        if (inputValue.scriptKind === "setup" && setupAssistantHasVersionDraftChanges) {
          setSetupAssistantStartDialogState({
            scriptKind: inputValue.scriptKind,
            version,
            variant: resolveSetupAssistantStartDialogVariant({
              latestSavedDraftHasAgentRuntime: setupAssistantLatestSavedDraftHasAgentRuntime,
              localDraftHasAgentRuntime: setupAssistantLocalDraftHasAgentRuntime,
            }),
          });
          return;
        }

        startSetupAssistant({
          scriptKind: inputValue.scriptKind,
          version,
        });
      },
      title: setupAssistantPanelIsOpen
        ? "Setup Assistant is open in the right panel."
        : (inputValue.disabledReason ??
          (inputValue.scriptKind === "setup" && setupAssistantHasVersionDraftChanges
            ? setupAssistantLatestSavedDraftHasAgentRuntime
              ? "Choose whether to save changes before opening Setup Assistant."
              : "Save this draft before opening Setup Assistant."
            : inputValue.defaultTitle)),
    };
  }
  const setupAssistantControl = createSetupAssistantControl({
    defaultTitle: "Open the right panel to write this setup script.",
    disabledReason: setupAssistantDisabledReason,
    resolveVersion: () => input.mode.version,
    scriptKind: "setup",
  });
  const maintenanceAssistantControl = createSetupAssistantControl({
    defaultTitle: "Open the right panel to write this snapshot maintenance script.",
    disabledReason: maintenanceAssistantDisabledReason,
    resolveVersion: () => snapshotVersion?.version ?? null,
    scriptKind: "maintenance",
  });

  useEffect(() => {
    if (!maintenanceAssistantPanelIsOpen) {
      return;
    }

    let cancelled = false;
    let scheduledHandle: TimerHandle | null = null;
    const scheduleNextRefresh = (): void => {
      scheduledHandle = systemScheduler.schedule(() => {
        if (cancelled) {
          return;
        }

        void input.invalidateProfileVersions(input.profileId);
        scheduleNextRefresh();
      }, 2_000);
    };

    scheduleNextRefresh();

    return () => {
      cancelled = true;
      if (scheduledHandle !== null) {
        systemScheduler.cancel(scheduledHandle);
      }
    };
  }, [input.invalidateProfileVersions, input.profileId, maintenanceAssistantPanelIsOpen]);

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
    setSaveDraftAgentRuntimeConnectionError(null);
    const shouldSaveRuntime = runtimeDraftState.hasUnpersistedChanges;
    const shouldSaveSkills = skillsDraftState.hasUnpersistedChanges;
    const shouldSaveGitCommitSigning = gitCommitSigningDraftState.hasUnpersistedChanges;
    const shouldSaveIntegrations = integrationDraftState.hasUnpersistedChanges;
    const shouldSaveSetupScript = setupScriptDraftState.hasUnpersistedChanges;

    if (skillsDraftState.saveBlockedMessage !== null) {
      skillsDraftState.applyDraftValidationError?.(skillsDraftState.saveBlockedMessage);
      setPublishFlushError(DraftSaveWorkflowErrorMessage);
      return false;
    }

    if (
      !shouldSaveRuntime &&
      !shouldSaveSkills &&
      !shouldSaveGitCommitSigning &&
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
        setPublishFlushError(DraftSaveWorkflowErrorMessage);
        return false;
      }
      const setupScript = shouldSaveSetupScript
        ? (setupScriptDraftState.buildDraftChanges?.() ?? null)
        : undefined;
      const skillsConfig = shouldSaveSkills
        ? (skillsDraftState.buildDraftChanges?.() ?? null)
        : undefined;
      const runtimeChanges: SandboxProfileRuntimeDraftChanges | undefined = shouldSaveRuntime
        ? buildSandboxProfileRuntimeDraftChanges({
            currentVersion: input.currentVersion,
            runtimeDraftState,
          })
        : undefined;
      const gitCommitSigningIntegrationConnectionId = shouldSaveGitCommitSigning
        ? resolveSelectedSandboxProfileGitCommitSigningIntegrationConnectionId({
            currentVersion: input.currentVersion,
            gitCommitSigningDraftState,
          })
        : undefined;

      const savedDraft = await putSandboxProfileVersionDraft({
        profileId: input.profileId,
        version: input.mode.version,
        ...(setupScript === undefined ? {} : { setupScript }),
        ...(runtimeChanges === undefined
          ? {}
          : {
              agentRuntimeId: runtimeChanges.agentRuntimeId,
              mistleMcpEnabled: runtimeChanges.mistleMcpEnabled,
              mistleMcpApiKeyId: runtimeChanges.mistleMcpApiKeyId,
              sandboxProvider: runtimeChanges.sandboxProvider,
              sandboxConnectionId: runtimeChanges.sandboxConnectionId,
              sandboxResources: runtimeChanges.sandboxResources,
            }),
        ...(gitCommitSigningIntegrationConnectionId === undefined
          ? {}
          : { gitCommitSigningIntegrationConnectionId }),
        ...(skillsConfig === undefined ? {} : { skillsConfig }),
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
      if (shouldSaveRuntime) {
        if (savedDraft.sandboxProvider === null) {
          throw new Error("Saved sandbox runtime provider is missing.");
        }

        runtimeDraftState.applySavedRuntimeConfig?.({
          agentRuntimeId: savedDraft.agentRuntimeId,
          mistleMcpEnabled: savedDraft.mistleMcpEnabled,
          mistleMcpApiKeyId: savedDraft.mistleMcpApiKeyId,
          sandboxProvider: savedDraft.sandboxProvider,
          sandboxConnectionId: savedDraft.sandboxConnectionId,
          sandboxResources: savedDraft.sandboxResources,
        });
        await input.invalidateProfileVersions(input.profileId);
      }
      if (shouldSaveSkills) {
        skillsDraftState.applySavedSkillsConfig?.(savedDraft.skillsConfig);
        if (!shouldSaveRuntime) {
          await input.invalidateProfileVersions(input.profileId);
        }
      }
      if (shouldSaveGitCommitSigning) {
        setGitCommitSigningDraftState(createIdleSandboxProfileGitCommitSigningDraftState());
        if (!shouldSaveRuntime && !shouldSaveSkills) {
          await input.invalidateProfileVersions(input.profileId);
        }
      }

      return true;
    } catch (error: unknown) {
      const errorOwner = resolveDraftSaveErrorOwner(error);
      if (errorOwner === "agent-runtime-connection") {
        setSaveDraftAgentRuntimeConnectionError(SaveDraftAgentRuntimeConnectionRequiredMessage);
      } else if (errorOwner === "integrations") {
        integrationDraftState.applyDraftSaveError?.(error);
      } else if (errorOwner === "runtime") {
        runtimeDraftState.applyDraftSaveError?.(error);
      } else if (errorOwner === "setup-script") {
        setupScriptDraftState.applyDraftSaveError?.(error);
      } else if (errorOwner === "skills") {
        skillsDraftState.applyDraftSaveError?.(error);
      }
      setPublishFlushError(DraftSaveWorkflowErrorMessage);
      return false;
    }
  }

  async function handleSaveDraft(): Promise<void> {
    setSaveDraftRequestIsPending(true);
    setDraftTriggerImpactAffectedTriggers(null);
    setDraftTriggerImpactError(null);
    try {
      const draftSaved = await saveDraftChanges();
      if (!draftSaved) {
        return;
      }

      try {
        const impact = await getSandboxProfileVersionDraftTriggerImpact({
          profileId: input.profileId,
          version: input.mode.version,
        });
        setDraftTriggerImpactAffectedTriggers(getDraftTriggerImpactAffectedTriggers(impact));
      } catch {
        setDraftTriggerImpactError(DraftTriggerImpactCheckFailedMessage);
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
      hasUnpersistedRuntimeChanges={runtimeDraftState.hasUnpersistedChanges}
      hasUnpersistedIntegrationChanges={
        integrationDraftState.hasUnpersistedChanges ||
        gitCommitSigningDraftState.hasUnpersistedChanges ||
        skillsDraftState.hasUnpersistedChanges
      }
      hasUnpersistedSetupScriptChanges={setupScriptDraftState.hasUnpersistedChanges}
      isSavingProfileName={metaState.isUpdating}
      mode={input.mode}
      shouldBlockUnpersistedChangesNavigation={shouldBlockUnpersistedChangesNavigation}
      deleteProfileTriggerUsages={input.deleteProfileTriggerUsages}
      deleteProfileTriggerUsagesError={input.deleteProfileTriggerUsagesError}
      deleteProfileTriggerUsagesIsPending={input.deleteProfileTriggerUsagesIsPending}
      deleteProfileError={input.deleteProfileError}
      deleteProfileIsPending={input.deleteProfileIsPending}
      duplicateProfileIsAvailable={input.duplicateProfileIsAvailable}
      duplicateProfileError={input.duplicateProfileError ?? null}
      duplicateProfileIsPending={input.duplicateProfileIsPending ?? false}
      duplicateProfileTriggerUsages={input.duplicateProfileTriggerUsages ?? []}
      duplicateProfileTriggerUsagesError={input.duplicateProfileTriggerUsagesError ?? null}
      duplicateProfileTriggerUsagesIsPending={input.duplicateProfileTriggerUsagesIsPending ?? false}
      onMakeChanges={input.onMakeChanges}
      onConfirmDeleteProfile={input.onConfirmDeleteProfile}
      onDeleteProfileDialogOpenChange={input.onDeleteProfileDialogOpenChange}
      onConfirmDuplicateProfile={(request) => {
        input.onConfirmDuplicateProfile?.(request);
      }}
      onDuplicateProfileDialogOpenChange={(open) => {
        input.onDuplicateProfileDialogOpenChange?.(open);
      }}
      onDiscardChangesAndLeaveDraft={input.onDiscardChangesAndLeaveDraft}
      onPublish={(version) => {
        void handlePublish(version);
      }}
      onSaveDraft={() => {
        void handleSaveDraft();
      }}
      onActiveSectionIdChange={(sectionId) => {
        if (setupAssistantOwningSectionId !== null && sectionId !== setupAssistantOwningSectionId) {
          setSetupAssistantCloseDialogState({
            navigationSectionId: sectionId,
            sandboxInstanceId: setupAssistantPanelState?.sandboxInstanceId ?? null,
          });
          return;
        }

        navigateToEditorSection(sectionId);
      }}
      onSaveProfileName={metaState.onProfileNameSave}
      onViewActive={input.onViewActive}
      onViewDraft={input.onViewDraft}
      profileName={metaState.formState.displayName}
      profileNameFallback={metaState.pageTitle}
      publishRequestIsPending={publishRequestIsPending}
      saveDraftRequestIsPending={saveDraftRequestIsPending}
      draftSaveError={publishFlushError}
      draftTriggerImpactError={draftTriggerImpactError}
      draftTriggerImpactAffectedTriggers={draftTriggerImpactAffectedTriggers}
      onDraftTriggerImpactErrorDismiss={() => {
        setDraftTriggerImpactError(null);
      }}
      versionActionError={input.versionActionError}
      versionActionIsPending={input.versionActionIsPending}
      isDeleteProfileDialogOpen={input.isDeleteProfileDialogOpen}
      isDuplicateProfileDialogOpen={input.isDuplicateProfileDialogOpen ?? false}
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
          runtimeDraftState={runtimeDraftState}
          skillsDraftState={skillsDraftState}
          gitCommitSigningDraftState={gitCommitSigningDraftState}
          onGitCommitSigningIntegrationConnectionChange={
            updateGitCommitSigningIntegrationConnectionId
          }
          onRuntimeDraftStateChange={setRuntimeDraftState}
          onSkillsDraftStateChange={setSkillsDraftState}
          onIntegrationDraftStateChange={setIntegrationDraftState}
          onPublishSuccessMessageDismiss={() => {
            setShowPublishSuccessMessage(false);
          }}
          onRefreshSnapshot={input.onRefreshSnapshot}
          onRetryPublishSnapshot={input.onRetryPublishSnapshot}
          onSetupScriptDraftStateChange={setSetupScriptDraftState}
          setupAssistantControl={setupAssistantControl}
          agentRuntimeConnectionErrorMessage={agentRuntimeConnectionErrorMessage}
          maintenanceAssistantControl={maintenanceAssistantControl}
          onSaveDraftBeforeSkillsReload={saveDraftBeforeSkillsReload}
          profileId={input.profileId}
          publishSuccessMessage={showPublishSuccessMessage}
          publishSuccessMessageKey={publishSuccessNoticeKey}
          setupScriptLoader={setupScriptLoader}
          snapshotPanelState={snapshotPanelState}
          snapshotVersion={snapshotVersion}
          {...(runtimeDraftState.buildDraftChanges === undefined
            ? {}
            : { buildSetupScriptTestRuntimeConfig: runtimeDraftState.buildDraftChanges })}
          selectedAgentRuntimeId={resolveSelectedSandboxProfileAgentRuntimeId({
            currentVersion: input.currentVersion,
            runtimeDraftState,
          })}
          versionActionIsPending={input.versionActionIsPending}
        />
      )}
      sections={editorSections}
    />
  );
  const setupAssistantStartDialog = (
    <SetupAssistantStartDialog
      isOpen={setupAssistantStartDialogState !== null}
      isPending={saveDraftRequestIsPending}
      variant={setupAssistantStartDialogState?.variant ?? "choice"}
      onOpenChange={(open) => {
        if (!open && !saveDraftRequestIsPending) {
          setSetupAssistantStartDialogState(null);
        }
      }}
      onSaveAndOpen={() => {
        if (setupAssistantStartDialogState === null || saveDraftRequestIsPending) {
          return;
        }

        void saveDraftAndStartSetupAssistant(setupAssistantStartDialogState);
      }}
      onUseLatestSavedDraft={() => {
        if (setupAssistantStartDialogState === null || saveDraftRequestIsPending) {
          return;
        }

        handleUseLatestSavedDraftSetupAssistant(setupAssistantStartDialogState);
      }}
    />
  );

  const setupAssistantPanelIsClosed =
    setupAssistantPanelState === null || !setupAssistantPanelState.isOpen;
  return (
    <div
      className={
        setupAssistantPanelIsClosed ? undefined : "sticky top-0 h-svh min-h-0 overflow-hidden"
      }
    >
      <ResizablePanelGroup
        className={setupAssistantPanelIsClosed ? undefined : "h-full min-h-0 overflow-hidden"}
        id="sandbox-profile-setup-assistant-panel-group"
        orientation="horizontal"
      >
        <ResizablePanel
          defaultSize={setupAssistantPanelIsClosed ? "100%" : "72%"}
          id="sandbox-profile-editor-main-panel"
          minSize={setupAssistantPanelIsClosed ? "100%" : "45%"}
        >
          <div
            className={
              setupAssistantPanelIsClosed
                ? undefined
                : "h-full min-h-0 overflow-y-auto overscroll-contain"
            }
          >
            {editorView}
          </div>
        </ResizablePanel>
        {setupAssistantPanelIsClosed ? null : (
          <>
            <ResizableHandle id="sandbox-profile-setup-assistant-resize-handle" />
            <ResizablePanel
              defaultSize="28%"
              id="sandbox-profile-setup-assistant-panel"
              minSize="360px"
            >
              <SetupScriptAssistantPanel
                onClose={requestSetupAssistantPanelClose}
                sandboxInstanceId={setupAssistantPanelState.sandboxInstanceId}
                scriptKind={setupAssistantPanelState.scriptKind}
                startupOperationId={setupAssistantPanelState.startupOperationId}
                placeholderText={setupAssistantPanelState.placeholderText}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      <SetupAssistantCloseDialog
        isOpen={setupAssistantCloseDialogState !== null}
        onCancel={cancelSetupAssistantPanelClose}
        onConfirm={confirmSetupAssistantPanelClose}
        reason={
          setupAssistantCloseDialogState?.navigationSectionId === null ? "close" : "switch-tabs"
        }
      />
      {setupAssistantStartDialog}
    </div>
  );
}

export function SetupAssistantStartDialog(input: {
  isOpen: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveAndOpen: () => void;
  onUseLatestSavedDraft: () => void;
  variant: SetupAssistantStartDialogVariant;
}): React.JSX.Element {
  const isChoice = input.variant === "choice";
  const isUseSavedRequired = input.variant === "use-saved-required";

  return (
    <Dialog open={input.isOpen} onOpenChange={input.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {input.variant === "save-required"
              ? "Save draft to use Setup Assistant"
              : "Unsaved changes"}
          </DialogTitle>
          <DialogDescription>
            {input.variant === "choice"
              ? "Setup Assistant uses the latest saved draft. Save your current changes before opening it, or open it with the latest saved draft instead. Your unsaved editor changes will stay in the editor."
              : isUseSavedRequired
                ? "Setup Assistant needs a saved draft with an agent runtime connection. Your current changes remove the saved agent runtime connection, so open it with the latest saved draft instead. Your unsaved editor changes will stay in the editor."
                : "Setup Assistant needs a saved draft with an agent runtime connection. Save your current changes before opening it."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {isChoice || isUseSavedRequired ? (
            <Button
              disabled={input.isPending}
              onClick={input.onUseLatestSavedDraft}
              type="button"
              variant="outline"
            >
              Use latest saved draft
            </Button>
          ) : null}
          {isUseSavedRequired ? null : (
            <Button disabled={input.isPending} onClick={input.onSaveAndOpen} type="button">
              {input.isPending ? "Saving..." : "Save and open"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SetupAssistantCloseDialog(input: {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  reason?: "close" | "switch-tabs";
}): React.JSX.Element {
  const reason = input.reason ?? "close";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          input.onCancel();
        }
      }}
      open={input.isOpen}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {reason === "switch-tabs"
              ? "Switch tabs and close Setup Assistant?"
              : "Stop Setup Assistant?"}
          </DialogTitle>
          <DialogDescription>
            {reason === "switch-tabs"
              ? "Switching tabs closes the Setup Assistant and stops its temporary sandbox. Unsaved script edits stay only while this profile editor remains open; save them before leaving or reloading."
              : "Closing the Setup Assistant stops its temporary sandbox. Unsaved script edits stay only while this profile editor remains open; save them before leaving or reloading."}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button onClick={input.onCancel} type="button" variant="outline">
            Cancel
          </Button>
          <Button onClick={input.onConfirm} type="button">
            {reason === "switch-tabs" ? "Switch tabs and close" : "Stop and close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetupScriptAssistantPanel(input: {
  onClose: () => void;
  sandboxInstanceId: string | null;
  scriptKind: SetupAssistantScriptKind;
  startupOperationId: string | null;
  placeholderText: string;
}): React.JSX.Element {
  const { conversationPane, workbench } = useSessionWorkbenchController({
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const [composerDraft, setComposerDraft] = useState(createComposerDraft(""));
  const [pendingDiffComments, setPendingDiffComments] = useState<
    readonly PendingSessionDiffComment[]
  >([]);
  const conversationScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalWorkspaceRef = useRef<SessionTerminalWorkspaceHandle | null>(null);
  const terminalPanelKey = input.sandboxInstanceId ?? "setup-assistant-missing-sandbox";
  const isTerminalOpenDisabled =
    !workbench.terminalPanelState.isVisible && !workbench.connectionReadiness.canConnect;
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
                : "border-muted-foreground/30 bg-muted-foreground/30",
            ].join(" ")}
            role="status"
            title={headerStatusLabel}
          />
          <span aria-hidden className="h-5 w-px bg-border" />
          <Button
            aria-label={workbench.terminalPanelState.isVisible ? "Terminal" : "Open terminal"}
            aria-pressed={workbench.terminalPanelState.isVisible}
            className={
              workbench.terminalPanelState.isVisible
                ? "bg-muted text-foreground shadow-none hover:bg-muted/80"
                : "bg-transparent text-foreground shadow-none hover:bg-muted/60"
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
                initialEntryStartupState: workbench.initialEntryStartupState,
                sandboxInstanceId: input.sandboxInstanceId,
                startupOperation:
                  workbench.sandboxStatusQuery.data?.startupOperation === undefined
                    ? null
                    : workbench.sandboxStatusQuery.data.startupOperation,
                startupOperationId: input.startupOperationId,
              })}
            </div>
            {workbench.initialEntryStartupState === null ? (
              <div className="shrink-0 bg-background px-5 py-4">
                <SessionConversationBottomPanelController
                  chatEntries={conversationPane.chatState.entries}
                  composerStateInput={{
                    ...conversationPane.composerStateInput,
                    collaborationModeSettings: buildSetupAssistantCollaborationModeSettings(
                      conversationPane.composerStateInput.collaborationModeSettings,
                      input.scriptKind,
                    ),
                    placeholderText: input.placeholderText,
                  }}
                  draftState={{
                    composerDraft,
                    pendingDiffComments,
                    clearPendingDiffComments: handleClearPendingDiffComments,
                    setComposerDraft,
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
  conversation: SetupAssistantConversationContent;
  initialEntryStartupState: SessionStartupState | null;
  sandboxInstanceId: string | null;
  startupOperation: SetupAssistantStartupOperation;
  startupOperationId: string | null;
}): React.JSX.Element {
  if (input.initialEntryStartupState !== null) {
    return (
      <SetupAssistantStartupProgress
        sandboxInstanceId={input.sandboxInstanceId}
        startupOperation={input.startupOperation}
        startupOperationId={input.startupOperationId}
        startupState={input.initialEntryStartupState}
      />
    );
  }

  return <SessionConversationMainContent {...input.conversation} />;
}

export function SetupAssistantStartupProgress(input: {
  sandboxInstanceId: string | null;
  startupOperation: SetupAssistantStartupOperation;
  startupOperationId: string | null;
  startupState: SessionStartupState;
}): React.JSX.Element {
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center gap-4 px-4 py-6">
      <SessionStartupStatus state={input.startupState} />
      <SandboxOperationProgress
        displayMode="timeline"
        emptyMessage="Waiting for Setup Assistant startup events."
        operationId={input.startupOperation?.operationId ?? input.startupOperationId}
        sandboxInstanceId={input.sandboxInstanceId}
        showBorder
        showLoadError={false}
      />
    </div>
  );
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
  runtimeDraftState: SandboxProfileRuntimeSettingsDraftState;
  skillsDraftState: SandboxProfileSkillsSettingsDraftState;
  gitCommitSigningDraftState: SandboxProfileGitCommitSigningDraftState;
  onGitCommitSigningIntegrationConnectionChange: (connectionId: string | null) => void;
  onRuntimeDraftStateChange: (state: SandboxProfileRuntimeSettingsDraftState) => void;
  onSkillsDraftStateChange: (state: SandboxProfileSkillsSettingsDraftState) => void;
  onSaveDraftBeforeSkillsReload: () => Promise<boolean>;
  onIntegrationDraftStateChange: (state: SandboxProfileDraftSectionState) => void;
  buildSetupScriptTestRuntimeConfig?: () => SandboxProfileRuntimeDraftChanges;
  onPublishSuccessMessageDismiss: () => void;
  onRefreshSnapshot: (input: { version: number; refreshKind: "setup" | "maintenance" }) => void;
  onRetryPublishSnapshot: (version: number) => void;
  onSetupScriptDraftStateChange: (state: SandboxProfileDraftSectionState) => void;
  setupAssistantControl: SetupScriptAssistantControl;
  agentRuntimeConnectionErrorMessage: string | null;
  maintenanceAssistantControl: SetupScriptAssistantControl;
  profileId: string;
  publishSuccessMessage: boolean;
  publishSuccessMessageKey: Key;
  setupScriptLoader: ReturnType<typeof useSandboxProfileSetupScriptLoader>;
  snapshotPanelState: SnapshotPanelState;
  snapshotVersion: SandboxProfileVersion | null;
  selectedAgentRuntimeId: SandboxProfileVersion["agentRuntimeId"];
  versionActionIsPending: boolean;
}): React.JSX.Element {
  if (input.activeSectionId === SandboxProfileEditorSectionIds.TRIGGERS) {
    return <SandboxProfileTriggersSection profileId={input.profileId} />;
  }

  if (input.activeSectionId === SandboxProfileEditorSectionIds.SNAPSHOT) {
    return (
      <SandboxProfileSnapshotPanel
        canRunMaintenanceRefresh={
          input.snapshotVersion?.usable === true &&
          (input.snapshotVersion.maintenanceScript?.trim().length ?? 0) > 0
        }
        canRunMaintenanceScript={input.snapshotVersion?.usable === true}
        isActionPending={input.versionActionIsPending}
        invalidateProfileVersions={input.invalidateProfileVersions}
        maintenanceScript={input.snapshotVersion?.maintenanceScript ?? null}
        setupAssistantControl={input.maintenanceAssistantControl}
        onRefreshSnapshot={() => {
          if (input.snapshotVersion !== null) {
            input.onRefreshSnapshot({
              version: input.snapshotVersion.version,
              refreshKind: "setup",
            });
          }
        }}
        onMaintenanceRefreshSnapshot={() => {
          if (input.snapshotVersion !== null) {
            input.onRefreshSnapshot({
              version: input.snapshotVersion.version,
              refreshKind: "maintenance",
            });
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

  const sandboxProfileIntegrationRows = resolveSandboxProfileSetupScriptIntegrationRows(
    input.integrationsLoader.initialRows,
    input.integrationDraftState.integrationRows,
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <LoadedSandboxProfileIntegrationSetupSection
        key={`${input.profileId}:${String(input.mode.version)}:${String(input.draftEditorResetKey)}:integration-setup`}
        agentRuntimeId={input.selectedAgentRuntimeId}
        loader={input.integrationsLoader}
        onDraftStateChange={input.onIntegrationDraftStateChange}
        profileId={input.profileId}
        gitCommitSigningIntegrationConnectionId={resolveSelectedSandboxProfileGitCommitSigningIntegrationConnectionId(
          {
            currentVersion: input.currentVersion,
            gitCommitSigningDraftState: input.gitCommitSigningDraftState,
          },
        )}
        onGitCommitSigningIntegrationConnectionChange={
          input.onGitCommitSigningIntegrationConnectionChange
        }
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
        agentRuntimeConnectionErrorMessage={input.agentRuntimeConnectionErrorMessage}
        version={input.mode.version}
      />
      {input.currentVersion === null || sandboxProfileIntegrationRows === null ? null : (
        <SandboxProfilePanelSection>
          <SandboxProfileSkillsSection
            availableConnections={input.integrationsLoader.availableConnections}
            availableTargets={input.integrationsLoader.availableTargets}
            disabled={input.draftFieldsAreReadOnly}
            integrationRows={sandboxProfileIntegrationRows}
            integrationRowsHaveUnpersistedChanges={
              input.integrationDraftState.hasUnpersistedChanges
            }
            isDraft={input.mode.kind === "draft"}
            onDraftStateChange={input.onSkillsDraftStateChange}
            onSaveDraftBeforeSkillsReload={input.onSaveDraftBeforeSkillsReload}
            profileId={input.profileId}
            readOnly={input.draftFieldsAreReadOnly}
            version={input.currentVersion}
          />
        </SandboxProfilePanelSection>
      )}
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
          {...(input.buildSetupScriptTestRuntimeConfig === undefined
            ? {}
            : { buildTestRunRuntimeConfig: input.buildSetupScriptTestRuntimeConfig })}
          onDraftStateChange={input.onSetupScriptDraftStateChange}
          setupAssistantControl={input.setupAssistantControl}
          isDraft={input.mode.kind === "draft"}
          version={input.mode.version}
        />
      </SandboxProfilePanelSection>
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
}): React.JSX.Element | null {
  const activeOrganizationId = useRequiredOrganizationId();
  const queryClient = useQueryClient();
  const sandboxProvidersQuery = useQuery({
    queryKey: sandboxProvidersQueryKey(),
    queryFn: async ({ signal }) => listSandboxProviders({ signal }),
    retry: false,
  });
  const apiKeysQuery = useQuery({
    queryKey: apiKeysQueryKey(activeOrganizationId),
    queryFn: async ({ signal }) => listApiKeys({ signal }),
    retry: false,
  });
  const createApiKeyMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (createdApiKey) => {
      queryClient.setQueryData<ApiKeysPage>(
        apiKeysQueryKey(activeOrganizationId),
        (currentApiKeys) => {
          if (currentApiKeys === undefined) {
            return currentApiKeys;
          }

          return {
            ...currentApiKeys,
            items: [
              createdApiKey.apiKey,
              ...currentApiKeys.items.filter((apiKey) => apiKey.id !== createdApiKey.apiKey.id),
            ],
            totalResults: currentApiKeys.totalResults + 1,
          };
        },
      );
      void queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(activeOrganizationId) });
    },
  });

  if (sandboxProvidersQuery.isPending) {
    return null;
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

  const apiKeysLoadErrorMessage = apiKeysQuery.isError
    ? resolveApiErrorMessage({
        error: apiKeysQuery.error,
        fallbackMessage: "Could not load API keys.",
      })
    : null;
  const apiKeys = apiKeysQuery.isSuccess ? apiKeysQuery.data.items : [];

  return (
    <div className="grid gap-3">
      <SandboxProfileRuntimeSection
        apiKeys={apiKeys}
        apiKeysAreLoading={apiKeysQuery.isPending}
        apiKeysLoadErrorMessage={apiKeysLoadErrorMessage}
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
        disabled={input.disabled}
        isDraft={input.isDraft}
        onCreateApiKey={(createInput) => createApiKeyMutation.mutateAsync(createInput)}
        onDraftStateChange={input.onDraftStateChange}
        providers={sandboxProvidersQuery.data.items}
        version={input.version}
        {...(input.sectionChrome === undefined ? {} : { sectionChrome: input.sectionChrome })}
      />
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
    id: SandboxProfileEditorSectionIds.TRIGGERS,
    label: "Triggers",
  },
] as const satisfies readonly SandboxProfileEditorSection<SandboxProfileEditorSectionId>[];

const DraftTriggerImpactCheckFailedMessage =
  "Couldn't check whether this draft affects related triggers.";

function getDraftTriggerImpactAffectedTriggers(
  impact: SandboxProfileVersionDraftTriggerImpact,
): readonly SandboxProfileVersionDraftTriggerImpactTrigger[] | null {
  if (!impact.hasBreakingChanges || impact.affectedTriggers.length === 0) {
    return null;
  }

  return impact.affectedTriggers;
}

function getTriggerDetailPath(trigger: SandboxProfileVersionDraftTriggerImpactTrigger): string {
  return `/triggers/${trigger.id}`;
}

function DraftTriggerImpactTriggerList(input: {
  triggers: readonly SandboxProfileVersionDraftTriggerImpactTrigger[];
}): ReactNode {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {input.triggers.map((trigger) => (
        <li key={trigger.id}>
          <TextLink
            className="font-medium text-amber-900 decoration-amber-900/35 hover:text-amber-950 dark:text-amber-100 dark:decoration-amber-100/35 dark:hover:text-amber-50"
            href={getTriggerDetailPath(trigger)}
            opensInNewWindow
          >
            {trigger.name}
          </TextLink>
          <div className="mt-1 space-y-0.5 text-amber-950/80 dark:text-amber-100/75">
            {trigger.issues.map((issue) => (
              <div key={`${trigger.id}:${issue.code}`}>
                {formatDraftTriggerImpactIssueMessage(issue)}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatDraftTriggerImpactIssueMessage(
  issue: SandboxProfileVersionDraftTriggerImpactIssue,
): string {
  switch (issue.code) {
    case "AGENT_BINDING_REQUIRED":
      return "This draft does not have an agent binding.";
    case "AGENT_BINDING_PRIMARY_REQUIRED":
      return "This draft does not have the agent runtime connection required by the selected runtime.";
    case "AGENT_BINDING_AMBIGUOUS":
      return "This draft has duplicate agent runtime connection bindings.";
    case "AGENT_BINDING_RUNTIME_INCOMPATIBLE":
      return "The draft agent binding is not compatible with the selected agent runtime.";
    case "INVALID_BINDING_CONNECTION_REFERENCE":
      return "The draft agent binding references a missing or inaccessible connection.";
    case "CONNECTION_NOT_ACTIVE":
      return "The draft agent connection is not active.";
    case "TARGET_DISABLED":
      return "The draft agent connection uses a disabled integration target.";
    case "TARGET_MISSING":
      return "The draft agent connection references an unavailable integration target.";
    case "WEBHOOK_SOURCE_CONNECTION_NOT_BOUND":
      return "This trigger's webhook source connection is not bound in the draft.";
    case "PRIMARY_REPOSITORY_UNAVAILABLE":
      return "This trigger's primary repository is not available in the draft.";
  }
}

function DuplicateSandboxProfileDialog(input: {
  duplicateError: string | null;
  isAvailable: boolean;
  isOpen: boolean;
  isPending: boolean;
  onConfirm: (request: { displayName: string; includeTriggers: boolean }) => void;
  onOpenChange: (open: boolean) => void;
  profileName: string;
  triggerUsagesError: string | null;
  triggerUsages: readonly TriggerSandboxProfileUsage[];
}): React.JSX.Element {
  const defaultDisplayName = `${input.profileName} copy`;
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [includeTriggers, setIncludeTriggers] = useState(false);
  const canChooseTriggers =
    input.isAvailable && input.triggerUsagesError === null && input.triggerUsages.length > 0;

  useEffect(() => {
    if (input.isOpen) {
      setDisplayName(defaultDisplayName);
      setIncludeTriggers(false);
    }
  }, [defaultDisplayName, input.isOpen]);

  useEffect(() => {
    if (!canChooseTriggers) {
      setIncludeTriggers(false);
    }
  }, [canChooseTriggers]);

  const trimmedDisplayName = displayName.trim();
  const isBlocked = input.isPending || !input.isAvailable || trimmedDisplayName.length === 0;

  return (
    <Dialog
      isBusy={input.isPending}
      isDismissible={!input.isPending}
      onOpenChange={input.onOpenChange}
      open={input.isOpen}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate sandbox profile</DialogTitle>
          <DialogDescription>
            Creates a new profile from the active published version, including its latest snapshot.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!input.isAvailable ? (
            <Notice variant="alert">
              Duplicate requires the active published version to have a usable snapshot.
            </Notice>
          ) : null}
          {input.isAvailable && input.triggerUsagesError !== null ? (
            <Notice variant="alert">
              Could not check triggers for this profile. Duplicate will continue without triggers.
            </Notice>
          ) : null}

          <Field>
            <FieldLabel htmlFor="duplicate-sandbox-profile-name">Name</FieldLabel>
            <FieldContent>
              <Input
                disabled={input.isPending}
                id="duplicate-sandbox-profile-name"
                onChange={(event) => {
                  setDisplayName(event.currentTarget.value);
                }}
                value={displayName}
              />
            </FieldContent>
          </Field>

          {canChooseTriggers ? (
            <label className="flex gap-3 rounded-md border bg-background p-3 text-sm">
              <Checkbox
                aria-label="Duplicate triggers tied to this profile"
                checked={includeTriggers}
                disabled={input.isPending || !input.isAvailable}
                onCheckedChange={(checked) => {
                  setIncludeTriggers(checked === true);
                }}
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">Duplicate triggers tied to this profile</span>
                <span className="text-muted-foreground">
                  Copied triggers are created disabled. One-off scheduled triggers are not copied.
                </span>
              </span>
            </label>
          ) : null}

          {input.duplicateError === null ? null : (
            <Notice title="Duplicate failed" variant="alert">
              {input.duplicateError}
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
          <Button
            disabled={isBlocked}
            onClick={() => {
              input.onConfirm({
                displayName: trimmedDisplayName,
                includeTriggers: canChooseTriggers && includeTriggers,
              });
            }}
            type="button"
          >
            {input.isPending ? "Duplicating..." : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSandboxProfileDialog(input: {
  triggerUsages: readonly TriggerSandboxProfileUsage[];
  triggerUsagesError: string | null;
  triggerUsagesIsPending: boolean;
  deleteError: string | null;
  isOpen: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  profileName: string;
}): React.JSX.Element {
  const isBlocked =
    input.isPending || input.triggerUsagesIsPending || input.triggerUsagesError !== null;

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
          {input.triggerUsagesIsPending ? (
            <p className="text-muted-foreground text-sm">Loading triggers...</p>
          ) : null}

          {input.triggerUsagesError === null ? null : (
            <Notice title="Could not load triggers" variant="alert">
              {input.triggerUsagesError}
            </Notice>
          )}

          {input.triggerUsages.length === 0 ||
          input.triggerUsagesIsPending ||
          input.triggerUsagesError !== null ? null : (
            <div className="space-y-2">
              <p className="text-sm">These triggers use this profile and will break:</p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {input.triggerUsages.map((trigger) => (
                  <li key={trigger.id}>{trigger.name}</li>
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
  deleteProfileTriggerUsages: readonly TriggerSandboxProfileUsage[];
  deleteProfileTriggerUsagesError: string | null;
  deleteProfileTriggerUsagesIsPending: boolean;
  deleteProfileError: string | null;
  deleteProfileIsPending: boolean;
  duplicateProfileIsAvailable?: boolean;
  duplicateProfileError?: string | null;
  duplicateProfileIsPending?: boolean;
  duplicateProfileTriggerUsages?: readonly TriggerSandboxProfileUsage[];
  duplicateProfileTriggerUsagesError?: string | null;
  duplicateProfileTriggerUsagesIsPending?: boolean;
  draftSaveError?: string | null;
  versionActionError: string | null;
  versionActionIsPending: boolean;
  draftTriggerImpactAffectedTriggers:
    | readonly SandboxProfileVersionDraftTriggerImpactTrigger[]
    | null;
  draftTriggerImpactError: string | null;
  draftTriggerImpactErrorAutoHideAfterMs?: number | null;
  onDraftTriggerImpactErrorDismiss: () => void;
  publishRequestIsPending?: boolean;
  saveDraftRequestIsPending?: boolean;
  isDeleteProfileDialogOpen: boolean;
  isDuplicateProfileDialogOpen?: boolean;
  shouldBlockUnpersistedChangesNavigation?: BlockerFunction;
  onPublish: (version: number) => void;
  onSaveDraft: () => void;
  onConfirmDeleteProfile: () => void;
  onConfirmDuplicateProfile?: (input: { displayName: string; includeTriggers: boolean }) => void;
  onDiscardChangesAndLeaveDraft: (input: { draftVersion: number }) => void;
  onDeleteProfileDialogOpenChange: (open: boolean) => void;
  onDuplicateProfileDialogOpenChange?: (open: boolean) => void;
  onMakeChanges: () => void;
  onViewActive: () => void;
  onViewDraft: () => void;
  sections: readonly SandboxProfileEditorSection<SandboxProfileEditorSectionId>[];
  activeSectionId: SandboxProfileEditorSectionId;
  onActiveSectionIdChange: (sectionId: SandboxProfileEditorSectionId) => void;
  renderSectionPanel: (sectionId: SandboxProfileEditorSectionId) => React.JSX.Element;
  versionActions?: React.JSX.Element;
  hasUnpersistedRuntimeChanges?: boolean;
  hasUnpersistedIntegrationChanges?: boolean;
  hasUnpersistedSetupScriptChanges?: boolean;
  isSavingProfileName?: boolean;
}): React.JSX.Element {
  const hasUnpersistedDraftChanges =
    input.mode.kind === "draft" &&
    ((input.hasUnpersistedRuntimeChanges ?? false) ||
      (input.hasUnpersistedIntegrationChanges ?? false) ||
      (input.hasUnpersistedSetupScriptChanges ?? false));
  const duplicateProfileIsAvailable = input.duplicateProfileIsAvailable ?? false;
  const duplicateProfileIsPending = input.duplicateProfileIsPending ?? false;
  const duplicateProfileTriggerUsagesIsPending =
    input.duplicateProfileTriggerUsagesIsPending ?? false;
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
  const duplicateProfileMenuItem = !duplicateProfileIsAvailable ? (
    <DropdownMenuItem className="items-start" disabled>
      <span className="flex min-w-0 flex-col gap-1">
        <span>Duplicate</span>
        <span className="text-muted-foreground text-xs">
          Requires the active published version to have a usable snapshot.
        </span>
      </span>
    </DropdownMenuItem>
  ) : duplicateProfileTriggerUsagesIsPending ? (
    <DropdownMenuItem className="items-start" disabled>
      <span className="flex min-w-0 flex-col gap-1">
        <span>Duplicate</span>
        <span className="text-muted-foreground text-xs">Checking triggers...</span>
      </span>
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem
      onClick={() => {
        input.onDuplicateProfileDialogOpenChange?.(true);
      }}
    >
      Duplicate
    </DropdownMenuItem>
  );
  const profileActions =
    input.versionActions ??
    (input.deleteProfileIsPending ? null : (
      <MoreActionsMenu triggerLabel="More actions">
        {duplicateProfileMenuItem}
        {deleteProfileMenuItem}
      </MoreActionsMenu>
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
        triggerUsages={input.deleteProfileTriggerUsages}
        triggerUsagesError={input.deleteProfileTriggerUsagesError}
        triggerUsagesIsPending={input.deleteProfileTriggerUsagesIsPending}
        deleteError={input.deleteProfileError}
        isOpen={input.isDeleteProfileDialogOpen}
        isPending={input.deleteProfileIsPending}
        onConfirm={input.onConfirmDeleteProfile}
        onOpenChange={input.onDeleteProfileDialogOpenChange}
        profileName={input.profileName ?? input.profileNameFallback}
      />
      <DuplicateSandboxProfileDialog
        duplicateError={input.duplicateProfileError ?? null}
        isAvailable={duplicateProfileIsAvailable}
        isOpen={input.isDuplicateProfileDialogOpen ?? false}
        isPending={duplicateProfileIsPending}
        onConfirm={(request) => {
          input.onConfirmDuplicateProfile?.(request);
        }}
        onOpenChange={(open) => {
          input.onDuplicateProfileDialogOpenChange?.(open);
        }}
        profileName={input.profileName ?? input.profileNameFallback}
        triggerUsagesError={input.duplicateProfileTriggerUsagesError ?? null}
        triggerUsages={input.duplicateProfileTriggerUsages ?? []}
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
                {input.draftTriggerImpactAffectedTriggers === null ? null : (
                  <Notice
                    title="Publishing this draft will break the following triggers"
                    variant="warning"
                  >
                    <DraftTriggerImpactTriggerList
                      triggers={input.draftTriggerImpactAffectedTriggers}
                    />
                  </Notice>
                )}
                {input.draftTriggerImpactError === null ? null : (
                  <Notice
                    autoHideAfterMs={
                      input.draftTriggerImpactErrorAutoHideAfterMs === null
                        ? undefined
                        : (input.draftTriggerImpactErrorAutoHideAfterMs ??
                          NoticeAutoHideDurationsMs.LONG)
                    }
                    dismissible
                    onDismiss={input.onDraftTriggerImpactErrorDismiss}
                    title="Trigger checks failed"
                    variant="alert"
                  >
                    {input.draftTriggerImpactError}
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
  agentRuntimeId: SandboxProfileVersion["agentRuntimeId"];
  disabled: boolean;
  readOnly: boolean;
  loader: ReturnType<typeof useSandboxProfileIntegrationsLoader>;
  gitCommitSigningIntegrationConnectionId: string | null;
  onGitCommitSigningIntegrationConnectionChange: (connectionId: string | null) => void;
  runtimeSettings: ReactNode | null;
  agentRuntimeConnectionErrorMessage: string | null;
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
      agentRuntimeId={input.agentRuntimeId}
      initialRows={input.loader.initialRows}
      availableConnections={input.loader.availableConnections}
      availableTargets={input.loader.availableTargets}
      disabled={input.disabled}
      readOnly={input.readOnly}
      gitCommitSigningIntegrationConnectionId={input.gitCommitSigningIntegrationConnectionId}
      onGitCommitSigningIntegrationConnectionChange={
        input.onGitCommitSigningIntegrationConnectionChange
      }
      integrationDirectoryQuery={input.loader.integrationDirectoryQuery}
      runtimeSettings={input.runtimeSettings}
      agentRuntimeConnectionErrorMessage={input.agentRuntimeConnectionErrorMessage}
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
  agentRuntimeId: SandboxProfileVersion["agentRuntimeId"];
  initialRows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  disabled: boolean;
  readOnly: boolean;
  runtimeSettings: ReactNode | null;
  gitCommitSigningIntegrationConnectionId: string | null;
  onGitCommitSigningIntegrationConnectionChange: (connectionId: string | null) => void;
  integrationDirectoryQuery: ReturnType<
    typeof useSandboxProfileIntegrationsLoader
  >["integrationDirectoryQuery"];
  agentRuntimeConnectionErrorMessage: string | null;
  onDraftStateChange?: (state: SandboxProfileDraftSectionState) => void;
}): React.JSX.Element {
  const activeOrganizationId = useRequiredOrganizationId();
  const identityLinkProvidersQuery = useQuery({
    enabled: !input.readOnly,
    queryKey: organizationIdentityLinkProvidersQueryKey(activeOrganizationId),
    queryFn: async ({ signal }) => listOrganizationIdentityLinkProviders({ signal }),
    retry: false,
  });
  const integrationsState = useLoadedSandboxProfileIntegrationsState({
    profileId: input.profileId,
    version: input.version,
    initialRows: input.initialRows,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const onDraftStateChange = input.onDraftStateChange;
  const identityLinkedGitConnectionIds = input.readOnly
    ? []
    : identityLinkProvidersQuery.data === undefined
      ? null
      : (identityLinkProvidersQuery.data
          .find((provider) => provider.providerFamily === "github")
          ?.configs.filter(
            (config) =>
              config.configurationStatus === "active" &&
              config.selectedConnection.status === "active",
          )
          .map((config) => config.integrationConnectionId) ?? []);
  const identityLinkProvidersLoadErrorMessage =
    !input.readOnly && identityLinkProvidersQuery.isError
      ? resolveApiErrorMessage({
          error: identityLinkProvidersQuery.error,
          fallbackMessage: "Could not load identity-linking providers.",
        })
      : null;

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
        agentRuntimeId={input.agentRuntimeId}
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
        gitCommitSigningIntegrationConnectionId={input.gitCommitSigningIntegrationConnectionId}
        identityLinkedGitConnectionIds={identityLinkedGitConnectionIds}
        runtimeSettings={input.runtimeSettings}
        agentRuntimeConnectionErrorMessage={input.agentRuntimeConnectionErrorMessage}
        disabled={input.disabled}
        readOnly={input.readOnly}
        onAddIntegrationBindingRow={integrationsState.onAddIntegrationBindingRow}
        onGitCommitSigningIntegrationConnectionChange={
          input.onGitCommitSigningIntegrationConnectionChange
        }
        onIntegrationBindingRowChange={integrationsState.onIntegrationBindingRowChange}
        onRemoveIntegrationBindingRow={integrationsState.onRemoveIntegrationBindingRow}
        onIntegrationSaveErrorDismiss={integrationsState.onIntegrationSaveErrorDismiss}
      />
      {identityLinkProvidersLoadErrorMessage === null ? null : (
        <Notice title="Could not load Git commit signing settings" variant="alert">
          {identityLinkProvidersLoadErrorMessage}
        </Notice>
      )}
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
  buildTestRunRuntimeConfig?: () => SandboxProfileRuntimeDraftChanges;
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
      {...(input.buildTestRunRuntimeConfig === undefined
        ? {}
        : { buildTestRunRuntimeConfig: input.buildTestRunRuntimeConfig })}
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
  buildTestRunRuntimeConfig?: () => SandboxProfileRuntimeDraftChanges;
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
    ...(input.buildTestRunRuntimeConfig === undefined
      ? {}
      : { buildRuntimeConfig: input.buildTestRunRuntimeConfig }),
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
        notice={
          setupScriptState.pendingExternalUpdate ? (
            <Notice
              action={
                <ButtonGroup>
                  <Button onClick={setupScriptState.applyPendingExternalUpdate} type="button">
                    Apply assistant version
                  </Button>
                  <Button
                    onClick={setupScriptState.dismissPendingExternalUpdate}
                    type="button"
                    variant="outline"
                  >
                    Keep editing
                  </Button>
                </ButtonGroup>
              }
              title="Setup script updated"
              variant="warning"
            >
              The Setup Assistant saved a newer setup script while you have unsaved edits.
            </Notice>
          ) : null
        }
        onChange={setupScriptState.onChange}
        setupAssistant={{
          disabled: input.setupAssistantControl.disabled,
          isStarting: input.setupAssistantControl.isStarting,
          onClick: () => {
            input.setupAssistantControl.onToggle();
          },
          title: input.setupAssistantControl.title,
        }}
        testButtonProps={setupScriptTest.buttonProps}
        testPanel={<SandboxProfileSetupScriptTestPanel {...setupScriptTest.panelProps} />}
        value={setupScriptState.draftValue}
        disabled={input.disabled}
        readOnly={!input.isDraft}
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
  notice?: ReactNode;
  onChange?: (nextValue: string) => void;
  readOnly?: boolean;
  repositoryHandles?: readonly string[];
  setupAssistant?: {
    disabled: boolean;
    isStarting: boolean;
    onClick: () => void;
    title: string;
  };
  testButtonProps?: SetupScriptTestButtonProps;
  testControl?: ReactNode;
  testPanel?: ReactNode;
}): React.JSX.Element {
  const setupScriptContext = createSandboxBaseSetupScriptContextFromGeneratedInventory(
    input.repositoryHandles,
  );

  return (
    <SandboxProfileScriptEditorPanel
      ariaLabelledBy="sandbox-setup-script-label"
      disabled={input.disabled}
      errorMessage={input.errorMessage}
      fieldLabel="Setup script"
      notice={input.notice}
      onChange={input.onChange}
      placeholderText={SetupScriptPlaceholder}
      readOnly={input.readOnly}
      setupAssistant={input.setupAssistant}
      testButtonProps={input.testButtonProps}
      testControl={input.testControl}
      testPanel={input.testPanel}
      title="Setup Script"
      value={input.value}
      detailsContent={
        input.disabled === true ? null : (
          <SetupScriptDetailsContent setupScriptContext={setupScriptContext} />
        )
      }
    />
  );
}

function SetupScriptDetailsContent(input: {
  setupScriptContext: ReturnType<typeof createSandboxBaseSetupScriptContextFromGeneratedInventory>;
}): React.JSX.Element {
  const setupScriptContext = input.setupScriptContext;

  return (
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
                <SetupScriptContextGroupRows group={setupScriptContext.repositoryLocationGroup} />
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
  );
}
