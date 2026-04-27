import {
  systemClock,
  systemScheduler,
  type Clock,
  type Scheduler,
  type TimerHandle,
} from "@mistle/time";
import {
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
  DefinitionList,
  DropdownMenuItem,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  FieldLabelWithTooltip,
  Input,
  MoreActionsMenu,
  Notice,
  NoticeAutoHideDurationsMs,
} from "@mistle/ui";
import { CheckCircleIcon, SpinnerGapIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type Key, type SyntheticEvent } from "react";
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { listWebhookAutomationsForSandboxProfile } from "../automations/webhook-automations-service.js";
import type { WebhookAutomationSandboxProfileUsage } from "../automations/webhook-automations-types.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { UnsavedChangesGuard } from "../navigation/unsaved-changes-guard.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileAutomationUsagesQueryKey,
  sandboxProfileDetailQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionSetupScriptQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  createSandboxProfileVersionDraft,
  deleteSandboxProfile,
  discardSandboxProfileVersionDraft,
  getSandboxProfile,
  getSandboxProfileVersionPublishability,
  listSandboxProfileVersions,
  publishSandboxProfileVersion,
  refreshSandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type {
  PublishSandboxProfileVersionResult,
  SandboxProfile,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { FormPageFrame, PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useAppShellHeaderActions } from "../shell/app-shell-header-actions.js";
import { ActivityStatus } from "./activity-status.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileEditorSections,
  type SandboxProfileEditorSection,
} from "./sandbox-profile-editor-sections.js";
import { SandboxProfileIntegrationsSetupSection } from "./sandbox-profile-integrations-setup-section.js";
import {
  useLoadedSandboxProfileIntegrationsState,
  useSandboxProfileIntegrationsLoader,
} from "./sandbox-profile-integrations-state.js";
import {
  useCreateSandboxProfileMetaState,
  useEditSandboxProfileMetaState,
} from "./sandbox-profile-meta-state.js";
import { SandboxProfileResourcesAndToolsSection } from "./sandbox-profile-resources-and-tools-section.js";
import {
  useLoadedSandboxProfileSetupScriptState,
  useSandboxProfileSetupScriptLoader,
} from "./sandbox-profile-setup-script-state.js";
import { SandboxSetupScriptEditor } from "./sandbox-setup-script-editor.js";

type SandboxProfileEditorPageProps =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      view: SandboxProfileRouteView;
    };

type SandboxProfileEditorVersionMode =
  | {
      kind: "draft";
      version: number;
      activeVersion: number | null;
      hasDraft: true;
    }
  | {
      kind: "active";
      version: number;
      activeVersion: number | null;
      hasDraft: boolean;
      draftVersion: number | null;
    };

type SandboxProfileRouteView = "published" | "draft";
type SandboxProfileEditorSectionId =
  | "integrations"
  | "resources-and-tools"
  | "configurations"
  | "snapshot";
type SnapshotPanelState =
  | {
      kind: "draft-unavailable";
    }
  | {
      kind: "no-snapshot";
    }
  | {
      kind: "creating";
    }
  | {
      kind: "ready";
      latestSnapshotCreatedAt: string | null;
    }
  | {
      kind: "snapshot-error";
      message: string;
    }
  | {
      kind: "refresh-error";
      latestSnapshotCreatedAt: string | null;
      message: string;
    };
type SandboxProfileEditorNavigationState = {
  initialSectionId: SandboxProfileEditorSectionId | null;
  notice: "publish-success" | null;
};
type SandboxProfileDraftSectionState = {
  flushDraftChanges: () => Promise<boolean>;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
};

function createIdleSandboxProfileDraftSectionState(): SandboxProfileDraftSectionState {
  return {
    flushDraftChanges: async () => true,
    hasUnsavedChanges: false,
    isSaving: false,
  };
}

type ResolveEditorVersionModeResult =
  | {
      ok: true;
      mode: SandboxProfileEditorVersionMode;
    }
  | {
      ok: false;
      message: string;
    };

export function resolveSandboxProfileEditorVersionMode(input: {
  activeVersion: number | null;
  versions: readonly SandboxProfileVersion[];
  view: SandboxProfileRouteView;
}): ResolveEditorVersionModeResult {
  const draftVersions = input.versions.filter((version) => version.state === "draft");
  const publishedVersions = input.versions.filter((version) => version.state === "published");
  if (draftVersions.length > 1) {
    return {
      ok: false,
      message: "Sandbox profile has multiple draft versions.",
    };
  }

  const draftVersion = draftVersions[0] ?? null;
  const activeVersion =
    input.activeVersion === null
      ? null
      : (input.versions.find((version) => version.version === input.activeVersion) ?? null);
  const latestPublishedVersion =
    publishedVersions.length === 0
      ? null
      : publishedVersions.reduce((latestVersion, currentVersion) =>
          currentVersion.version > latestVersion.version ? currentVersion : latestVersion,
        );

  if (input.activeVersion !== null && activeVersion === null) {
    return {
      ok: false,
      message: "Sandbox profile active version could not be loaded.",
    };
  }

  if (input.view === "draft") {
    if (draftVersion === null) {
      return {
        ok: false,
        message: "Sandbox profile draft version could not be loaded.",
      };
    }

    return {
      ok: true,
      mode: {
        kind: "draft",
        version: draftVersion.version,
        activeVersion: input.activeVersion,
        hasDraft: true,
      },
    };
  }

  if (input.activeVersion !== null && activeVersion !== null) {
    return {
      ok: true,
      mode: {
        kind: "active",
        version: activeVersion.version,
        activeVersion: input.activeVersion,
        hasDraft: draftVersion !== null,
        draftVersion: draftVersion?.version ?? null,
      },
    };
  }

  if (latestPublishedVersion === null) {
    return {
      ok: false,
      message: "Sandbox profile published version could not be loaded.",
    };
  }

  return {
    ok: true,
    mode: {
      kind: "active",
      version: latestPublishedVersion.version,
      activeVersion: input.activeVersion,
      hasDraft: draftVersion !== null,
      draftVersion: draftVersion?.version ?? null,
    },
  };
}

const SetupScriptPlaceholder = `#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap`;

const SandboxProfileEditorSectionIds = {
  INTEGRATIONS: "integrations",
  RESOURCES_AND_TOOLS: "resources-and-tools",
  CONFIGURATIONS: "configurations",
  SNAPSHOT: "snapshot",
} satisfies Record<string, SandboxProfileEditorSectionId>;

const PublishSuccessNavigationState: SandboxProfileEditorNavigationState = {
  initialSectionId: SandboxProfileEditorSectionIds.SNAPSHOT,
  notice: "publish-success",
};

export function shouldPollSandboxProfileSnapshotJobs(
  versions: readonly SandboxProfileVersion[] | undefined,
): boolean {
  if (versions === undefined) {
    return false;
  }

  return versions.some(
    (version) =>
      version.state === "published" &&
      (version.latestSnapshotJob?.state === "queued" ||
        version.latestSnapshotJob?.state === "running"),
  );
}

function resolveSnapshotPanelState(input: {
  mode: SandboxProfileEditorVersionMode;
  version: SandboxProfileVersion | null;
}): SnapshotPanelState {
  if (input.mode.kind === "draft" || input.version === null) {
    return {
      kind: "draft-unavailable",
    };
  }

  const latestSnapshotJob = input.version.latestSnapshotJob;
  if (latestSnapshotJob?.state === "queued" || latestSnapshotJob?.state === "running") {
    return {
      kind: "creating",
    };
  }

  if (latestSnapshotJob?.state === "failed") {
    const message = latestSnapshotJob.errorMessage ?? "Snapshot materialization failed.";
    return input.version.usable
      ? {
          kind: "refresh-error",
          latestSnapshotCreatedAt: null,
          message,
        }
      : {
          kind: "snapshot-error",
          message,
        };
  }

  if (!input.version.usable) {
    return {
      kind: "no-snapshot",
    };
  }

  return {
    kind: "ready",
    latestSnapshotCreatedAt:
      latestSnapshotJob?.state === "succeeded" ? latestSnapshotJob.finishedAt : null,
  };
}

function shouldShowMissingSnapshotAlert(input: {
  mode: SandboxProfileEditorVersionMode;
  snapshotState: SnapshotPanelState;
}): boolean {
  return input.mode.kind === "active" && input.snapshotState.kind === "no-snapshot";
}

function readSandboxProfileEditorNavigationState(
  value: unknown,
): SandboxProfileEditorNavigationState {
  if (typeof value !== "object" || value === null) {
    return {
      initialSectionId: null,
      notice: null,
    };
  }

  const initialSectionId = Reflect.get(value, "initialSectionId");
  const notice = Reflect.get(value, "notice");

  return {
    initialSectionId: isSandboxProfileEditorSectionId(initialSectionId) ? initialSectionId : null,
    notice: notice === "publish-success" ? notice : null,
  };
}

function isSandboxProfileEditorSectionId(value: unknown): value is SandboxProfileEditorSectionId {
  return (
    value === SandboxProfileEditorSectionIds.INTEGRATIONS ||
    value === SandboxProfileEditorSectionIds.RESOURCES_AND_TOOLS ||
    value === SandboxProfileEditorSectionIds.CONFIGURATIONS ||
    value === SandboxProfileEditorSectionIds.SNAPSHOT
  );
}

function shouldRedirectPublishedSandboxProfileViewToDraft(input: {
  activeVersion: number | null;
  versions: readonly SandboxProfileVersion[];
}): boolean {
  return (
    input.activeVersion === null && input.versions.some((version) => version.state === "draft")
  );
}

export function shouldRedirectDraftSandboxProfileViewToPublished(input: {
  versions: readonly SandboxProfileVersion[];
}): boolean {
  const hasDraftVersion = input.versions.some((version) => version.state === "draft");
  const hasPublishedVersion = input.versions.some((version) => version.state === "published");

  return !hasDraftVersion && hasPublishedVersion;
}

export function applyPublishedSandboxProfileVersionToProfile(input: {
  profile: SandboxProfile | undefined;
  result: PublishSandboxProfileVersionResult;
}): SandboxProfile | undefined {
  if (input.profile === undefined) {
    return undefined;
  }

  return {
    ...input.profile,
    activeVersion: input.result.activeVersion,
  };
}

export function applyPublishedSandboxProfileVersionToVersions(input: {
  versions: readonly SandboxProfileVersion[] | undefined;
  result: PublishSandboxProfileVersionResult;
}): readonly SandboxProfileVersion[] | undefined {
  if (input.versions === undefined) {
    return undefined;
  }

  const remainingVersions = input.versions.filter(
    (version) => version.version !== input.result.version.version,
  );
  return [...remainingVersions, input.result.version].sort(
    (left, right) => left.version - right.version,
  );
}

export function SandboxProfileEditorPage(props: SandboxProfileEditorPageProps): React.JSX.Element {
  if (props.mode === "create") {
    return <CreateSandboxProfileEditorPage />;
  }

  return <EditSandboxProfileEditorPage view={props.view} />;
}

function CreateSandboxProfileEditorPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
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
    <FormPageFrame description={description} title={title}>
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
    </FormPageFrame>
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
    return (
      <PageFrame maxWidthClassName="max-w-5xl" title="">
        {null}
      </PageFrame>
    );
  }

  if (profileQuery.isError || profileQuery.data === undefined) {
    const isNotFoundError =
      profileQuery.error instanceof SandboxProfilesApiError && profileQuery.error.status === 404;

    return (
      <PageFrame maxWidthClassName="max-w-5xl" title="">
        <div className="gap-4 flex flex-col">
          <h1 className="text-xl font-semibold">Edit profile</h1>
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
        </div>
      </PageFrame>
    );
  }

  if (profileVersionsQuery.isError || profileVersionsQuery.data === undefined) {
    return (
      <PageFrame maxWidthClassName="max-w-5xl" title="">
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
    <PageFrame maxWidthClassName="max-w-5xl" title="">
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
    </PageFrame>
  );
}

export function SandboxProfileDefaultRedirect(): React.JSX.Element {
  const shellContext = useSandboxProfileEditorShellContext();
  const defaultView = shellContext.profile.activeVersion === null ? "draft" : "published";

  return <Navigate replace to={`/sandbox-profiles/${shellContext.profileId}/${defaultView}`} />;
}

function useSandboxProfileEditorShellContext(): SandboxProfileEditorShellContext {
  return useOutletContext<SandboxProfileEditorShellContext>();
}

function EditSandboxProfileEditorPage(input: { view: SandboxProfileRouteView }): React.JSX.Element {
  const shellContext = useSandboxProfileEditorShellContext();
  const location = useLocation();
  const navigate = shellContext.navigate;
  const navigationState = readSandboxProfileEditorNavigationState(location.state);
  const publishSuccessMessage = navigationState.notice === "publish-success";

  useEffect(() => {
    if (navigationState.notice !== "publish-success") {
      return;
    }

    void navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
  }, [location.pathname, location.search, navigate, navigationState.notice]);

  return (
    <LoadedSandboxProfileEditorPage
      initialSectionId={navigationState.initialSectionId}
      publishSuccessMessage={publishSuccessMessage}
      view={input.view}
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
  initialSectionId: SandboxProfileEditorSectionId | null;
  publishSuccessMessage: boolean;
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

function LoadedSandboxProfileEditorPage(
  input: LoadedSandboxProfileEditorPageInput,
): React.JSX.Element {
  const queryClient = useQueryClient();
  const [versionActionError, setVersionActionError] = useState<string | null>(null);
  const [isDeleteProfileDialogOpen, setIsDeleteProfileDialogOpen] = useState(false);
  const [deleteProfileError, setDeleteProfileError] = useState<string | null>(null);
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
    onSuccess: async () => {
      setVersionActionError(null);
      await Promise.all([
        input.invalidateProfileVersions(input.profileId),
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
      ]);
      void input.navigate(`/sandbox-profiles/${input.profileId}/draft`);
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
      void input.navigate(`/sandbox-profiles/${input.profileId}/published`, {
        state: PublishSuccessNavigationState,
      });

      const invalidationPromises = [
        input.invalidateProfileVersions(input.profileId),
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
      ];
      if (result.activeVersion !== null) {
        invalidationPromises.push(
          input.invalidateVersionBindings({
            profileId: input.profileId,
            version: result.activeVersion,
          }),
          input.invalidateVersionSetupScript({
            profileId: input.profileId,
            version: result.activeVersion,
          }),
        );
      }
      void Promise.all(invalidationPromises);
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
    onSuccess: async () => {
      setVersionActionError(null);
      await Promise.all([
        input.invalidateProfileVersions(input.profileId),
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
      ]);
      void input.navigate(`/sandbox-profiles/${input.profileId}/published`);
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

  if (
    input.view === "published" &&
    shouldRedirectPublishedSandboxProfileViewToDraft({
      activeVersion: input.profile.activeVersion,
      versions: input.versions,
    })
  ) {
    return <Navigate replace to={`/sandbox-profiles/${input.profileId}/draft`} />;
  }

  if (
    input.view === "draft" &&
    shouldRedirectDraftSandboxProfileViewToPublished({
      versions: input.versions,
    })
  ) {
    return <Navigate replace to={`/sandbox-profiles/${input.profileId}/published`} />;
  }

  const resolvedMode = resolveSandboxProfileEditorVersionMode({
    activeVersion: input.profile.activeVersion,
    versions: input.versions,
    view: input.view,
  });

  if (!resolvedMode.ok) {
    return (
      <Notice title="Could not load profile version" variant="alert">
        {resolvedMode.message}
      </Notice>
    );
  }

  return (
    <ReadySandboxProfileEditorPage
      currentVersion={
        input.versions.find((version) => version.version === resolvedMode.mode.version) ?? null
      }
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
      initialSectionId={input.initialSectionId}
      publishSuccessMessage={input.publishSuccessMessage}
      onViewActive={() => {
        setVersionActionError(null);
        void input.navigate(`/sandbox-profiles/${input.profileId}/published`);
      }}
      onViewDraft={() => {
        setVersionActionError(null);
        void input.navigate(`/sandbox-profiles/${input.profileId}/draft`);
      }}
      profile={input.profile}
      profileId={input.profileId}
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
        refreshSnapshotMutation.isPending
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
  initialSectionId: SandboxProfileEditorSectionId | null;
  publishSuccessMessage: boolean;
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
  const isSavingDraftChanges = integrationDraftState.isSaving || setupScriptDraftState.isSaving;
  const [publishRequestIsPending, setPublishRequestIsPending] = useState(false);
  const [publishFlushError, setPublishFlushError] = useState<string | null>(null);
  const [publishSuccessNoticeKey, setPublishSuccessNoticeKey] = useState(0);
  const [showPublishSuccessMessage, setShowPublishSuccessMessage] = useState(
    input.publishSuccessMessage,
  );
  const [activeSectionId, setActiveSectionId] = useState<SandboxProfileEditorSectionId>(
    input.initialSectionId ?? SandboxProfileEditorSectionIds.INTEGRATIONS,
  );
  const draftFieldsAreDisabled =
    input.mode.kind !== "draft" || isSavingDraftChanges || publishRequestIsPending;
  const snapshotPanelState = resolveSnapshotPanelState({
    mode: input.mode,
    version: input.currentVersion,
  });
  const editorSections = createSandboxProfileEditorSections({
    mode: input.mode,
    snapshotState: snapshotPanelState,
  });
  const metaState = useEditSandboxProfileMetaState({
    profileId: input.profileId,
    loadedProfile: input.profile,
    navigate: input.navigate,
    invalidateSandboxProfiles: input.invalidateSandboxProfiles,
    invalidateProfileDetail: input.invalidateProfileDetail,
  });

  useEffect(() => {
    if (
      input.mode.kind === "draft" &&
      activeSectionId === SandboxProfileEditorSectionIds.SNAPSHOT
    ) {
      setActiveSectionId(SandboxProfileEditorSectionIds.INTEGRATIONS);
    }
  }, [activeSectionId, input.mode.kind]);

  async function handlePublish(version: number): Promise<void> {
    setPublishFlushError(null);
    const shouldFlushDraft =
      integrationDraftState.hasUnsavedChanges ||
      integrationDraftState.isSaving ||
      setupScriptDraftState.hasUnsavedChanges ||
      setupScriptDraftState.isSaving;

    setPublishRequestIsPending(true);
    try {
      if (shouldFlushDraft) {
        const [integrationsSaved, setupScriptSaved] = await Promise.all([
          integrationDraftState.flushDraftChanges(),
          setupScriptDraftState.flushDraftChanges(),
        ]);

        if (!integrationsSaved || !setupScriptSaved) {
          setPublishFlushError(DraftFlushBeforePublishErrorMessage);
          return;
        }
      }

      await input.onPublish(version);
      setPublishSuccessNoticeKey((currentKey) => currentKey + 1);
      setShowPublishSuccessMessage(true);
      setActiveSectionId(SandboxProfileEditorSectionIds.SNAPSHOT);
    } catch {
      return;
    } finally {
      setPublishRequestIsPending(false);
    }
  }

  return (
    <>
      <SandboxProfileEditorHeaderActions
        isSavingDraftChanges={input.mode.kind === "draft" && isSavingDraftChanges}
      />
      <SandboxProfileEditorView
        activeSectionId={activeSectionId}
        hasUnsavedIntegrationChanges={integrationDraftState.hasUnsavedChanges}
        hasUnsavedSetupScriptChanges={setupScriptDraftState.hasUnsavedChanges}
        isSavingProfileName={metaState.isUpdating}
        mode={input.mode}
        deleteProfileAutomationUsages={input.deleteProfileAutomationUsages}
        deleteProfileAutomationUsagesError={input.deleteProfileAutomationUsagesError}
        deleteProfileAutomationUsagesIsPending={input.deleteProfileAutomationUsagesIsPending}
        deleteProfileError={input.deleteProfileError}
        deleteProfileIsPending={input.deleteProfileIsPending}
        onMakeChanges={() => {
          setActiveSectionId(SandboxProfileEditorSectionIds.INTEGRATIONS);
          input.onMakeChanges();
        }}
        onConfirmDeleteProfile={input.onConfirmDeleteProfile}
        onDeleteProfileDialogOpenChange={input.onDeleteProfileDialogOpenChange}
        onDiscardChangesAndLeaveDraft={input.onDiscardChangesAndLeaveDraft}
        onPublish={(version) => {
          void handlePublish(version);
        }}
        onActiveSectionIdChange={(sectionId) => {
          if (isSandboxProfileEditorSectionId(sectionId)) {
            setActiveSectionId(sectionId);
          }
        }}
        onSaveProfileName={metaState.onProfileNameSave}
        onViewActive={input.onViewActive}
        onViewDraft={() => {
          setActiveSectionId(SandboxProfileEditorSectionIds.INTEGRATIONS);
          input.onViewDraft();
        }}
        profileName={metaState.formState.displayName}
        profileNameFallback={metaState.pageTitle}
        publishRequestIsPending={publishRequestIsPending}
        versionActionError={publishFlushError ?? input.versionActionError}
        versionActionIsPending={input.versionActionIsPending}
        isDeleteProfileDialogOpen={input.isDeleteProfileDialogOpen}
        renderSectionPanel={(sectionId) => {
          if (sectionId === SandboxProfileEditorSectionIds.SNAPSHOT) {
            return (
              <SandboxProfileSnapshotPanel
                isActionPending={input.versionActionIsPending}
                onRefreshSnapshot={() => {
                  input.onRefreshSnapshot(input.mode.version);
                }}
                onPublishSuccessMessageDismiss={() => {
                  setShowPublishSuccessMessage(false);
                }}
                publishSuccessMessageKey={publishSuccessNoticeKey}
                publishSuccessMessage={showPublishSuccessMessage}
                state={snapshotPanelState}
              />
            );
          }

          if (sectionId === "configurations") {
            return (
              <LoadedSandboxProfileSetupScriptSection
                disabled={draftFieldsAreDisabled}
                key={`${input.profileId}:${String(input.mode.version)}`}
                loader={setupScriptLoader}
                profileId={input.profileId}
                invalidateVersionSetupScript={input.invalidateVersionSetupScript}
                onDraftStateChange={setSetupScriptDraftState}
                version={input.mode.version}
              />
            );
          }

          return (
            <LoadedSandboxProfileIntegrationSetupSection
              key={`${input.profileId}:integration-setup`}
              activeSectionId={sectionId}
              loader={integrationsLoader}
              onDraftStateChange={setIntegrationDraftState}
              profileId={input.profileId}
              disabled={draftFieldsAreDisabled}
              version={input.mode.version}
              invalidateVersionBindings={input.invalidateVersionBindings}
            />
          );
        }}
        sections={editorSections}
      />
    </>
  );
}

const SandboxProfileEditorTabs = [
  {
    id: SandboxProfileEditorSectionIds.INTEGRATIONS,
    label: "Integrations",
  },
  {
    id: SandboxProfileEditorSectionIds.RESOURCES_AND_TOOLS,
    label: "Resources & Tools",
  },
  {
    id: SandboxProfileEditorSectionIds.CONFIGURATIONS,
    label: "Configurations",
  },
  {
    id: SandboxProfileEditorSectionIds.SNAPSHOT,
    label: "Snapshot",
  },
] as const satisfies readonly SandboxProfileEditorSection[];

function createSandboxProfileEditorSections(input: {
  mode: SandboxProfileEditorVersionMode;
  snapshotState: SnapshotPanelState;
}): readonly SandboxProfileEditorSection[] {
  return SandboxProfileEditorTabs.map((section) =>
    section.id === SandboxProfileEditorSectionIds.SNAPSHOT
      ? {
          ...section,
          disabled: input.mode.kind === "draft",
          sideLabel: (
            <span className="inline-flex items-center gap-1.5">
              <span>Snapshot</span>
              {shouldShowMissingSnapshotAlert({
                mode: input.mode,
                snapshotState: input.snapshotState,
              }) ? (
                <WarningCircleIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-destructive"
                />
              ) : null}
            </span>
          ),
        }
      : section,
  );
}

function SandboxProfileSnapshotPanel(input: {
  isActionPending: boolean;
  onPublishSuccessMessageDismiss: () => void;
  onRefreshSnapshot: () => void;
  publishSuccessMessageKey: Key;
  publishSuccessMessage: boolean;
  state: SnapshotPanelState;
}): React.JSX.Element {
  const actionLabel = resolveSnapshotActionLabel(input.state);
  const activityLabel = resolveSnapshotActivityLabel(input.state);
  const latestSnapshotCreatedAt = resolveLatestSnapshotCreatedAt(input.state);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PublishSuccessSnapshotNotice
        onDismiss={input.onPublishSuccessMessageDismiss}
        noticeKey={input.publishSuccessMessageKey}
        visible={input.publishSuccessMessage}
      />

      {input.state.kind === "no-snapshot" ? (
        <Notice title="Create a snapshot to start sessions from this profile." variant="alert" />
      ) : null}

      {input.state.kind === "snapshot-error" ? (
        <Notice title="Snapshot failed" variant="alert">
          {input.state.message}
        </Notice>
      ) : null}

      {input.state.kind === "refresh-error" ? (
        <Notice title="Refresh failed" variant="alert">
          {input.state.message}
        </Notice>
      ) : null}

      <div className="space-y-1">
        <h2 className="text-base font-semibold leading-6">About snapshots</h2>
        <p className="text-sm text-muted-foreground">
          A snapshot is the prepared sandbox image created from this published profile version and
          its setup script. New sessions can only start after a snapshot is ready.
        </p>
      </div>

      {actionLabel === null ? null : (
        <div>
          <Button disabled={input.isActionPending} onClick={input.onRefreshSnapshot} type="button">
            {actionLabel}
          </Button>
        </div>
      )}

      {activityLabel === null ? null : (
        <ActivityStatus
          className="justify-start text-muted-foreground"
          label={activityLabel}
          labelKey={input.state.kind}
        />
      )}

      {latestSnapshotCreatedAt === null ? null : (
        <DefinitionList
          items={[
            {
              id: "snapshot-created",
              label: "Latest snapshot",
              value: latestSnapshotCreatedAt,
            },
          ]}
        />
      )}
    </div>
  );
}

function PublishSuccessSnapshotNotice(input: {
  noticeKey: Key;
  onDismiss: () => void;
  visible: boolean;
}): React.JSX.Element | null {
  const [presentedNoticeKey, setPresentedNoticeKey] = useState<Key | null>(
    input.visible ? input.noticeKey : null,
  );

  useEffect(() => {
    if (input.visible) {
      setPresentedNoticeKey(input.noticeKey);
    }
  }, [input.noticeKey, input.visible]);

  if (presentedNoticeKey === null) {
    return null;
  }

  return (
    <Notice
      autoHideAfterMs={NoticeAutoHideDurationsMs.MEDIUM}
      dismissible
      onDismiss={input.onDismiss}
      resetKey={presentedNoticeKey}
      title="Publish successful, creating a new snapshot"
      variant="success"
    />
  );
}

function resolveSnapshotActionLabel(state: SnapshotPanelState): string | null {
  if (state.kind === "no-snapshot" || state.kind === "snapshot-error") {
    return "Create snapshot";
  }

  if (state.kind === "ready" || state.kind === "refresh-error") {
    return "Refresh snapshot";
  }

  return null;
}

function resolveSnapshotActivityLabel(state: SnapshotPanelState): string | null {
  if (state.kind === "creating") {
    return "Creating snapshot";
  }

  return null;
}

function resolveLatestSnapshotCreatedAt(state: SnapshotPanelState): string | null {
  if (state.kind === "ready" || state.kind === "refresh-error") {
    return state.latestSnapshotCreatedAt;
  }

  return null;
}

const DraftSavingIndicatorShowDelayMs = 200;
const DraftSavingIndicatorMinimumVisibleMs = 500;
const DraftFlushBeforePublishErrorMessage =
  "Could not save draft changes before publishing. Check your draft changes and try again.";

export function SandboxProfileEditorHeaderActions(input: {
  isSavingDraftChanges: boolean;
  minimumVisibleMs?: number;
  scheduler?: Scheduler;
  showDelayMs?: number;
}): null {
  const showSavingIndicator = useDelayedMinimumVisibleFlag({
    active: input.isSavingDraftChanges,
    clock: systemClock,
    minimumVisibleMs: input.minimumVisibleMs ?? DraftSavingIndicatorMinimumVisibleMs,
    scheduler: input.scheduler ?? systemScheduler,
    showDelayMs: input.showDelayMs ?? DraftSavingIndicatorShowDelayMs,
  });
  const headerActions = useMemo(
    () =>
      showSavingIndicator ? (
        <div
          aria-live="polite"
          className="text-muted-foreground inline-flex h-6 items-center gap-1.5 text-xs"
          role="status"
        >
          <SpinnerGapIcon aria-hidden="true" className="size-3.5 animate-spin" />
          <span>Saving</span>
        </div>
      ) : null,
    [showSavingIndicator],
  );
  useAppShellHeaderActions(headerActions);

  return null;
}

function useDelayedMinimumVisibleFlag(input: {
  active: boolean;
  clock: Clock;
  minimumVisibleMs: number;
  scheduler: Scheduler;
  showDelayMs: number;
}): boolean {
  const [visible, setVisible] = useState(false);
  const visibleSinceRef = useRef<number | null>(null);

  useEffect(() => {
    let timeoutId: TimerHandle | null = null;

    if (input.active && !visible) {
      timeoutId = input.scheduler.schedule(() => {
        visibleSinceRef.current = input.clock.nowMs();
        setVisible(true);
      }, input.showDelayMs);
    } else if (!input.active && visible) {
      const visibleSince = visibleSinceRef.current;
      const elapsedVisibleMs =
        visibleSince === null ? input.minimumVisibleMs : input.clock.nowMs() - visibleSince;
      const remainingVisibleMs = Math.max(input.minimumVisibleMs - elapsedVisibleMs, 0);

      timeoutId = input.scheduler.schedule(() => {
        visibleSinceRef.current = null;
        setVisible(false);
      }, remainingVisibleMs);
    } else if (!input.active && !visible) {
      visibleSinceRef.current = null;
    }

    return () => {
      if (timeoutId !== null) {
        input.scheduler.cancel(timeoutId);
      }
    };
  }, [
    input.active,
    input.clock,
    input.minimumVisibleMs,
    input.scheduler,
    input.showDelayMs,
    visible,
  ]);

  return visible;
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
  versionActionError: string | null;
  versionActionIsPending: boolean;
  publishRequestIsPending?: boolean;
  isDeleteProfileDialogOpen: boolean;
  onPublish: (version: number) => void;
  onConfirmDeleteProfile: () => void;
  onDiscardChangesAndLeaveDraft: (input: { draftVersion: number }) => void;
  onDeleteProfileDialogOpenChange: (open: boolean) => void;
  onMakeChanges: () => void;
  onViewActive: () => void;
  onViewDraft: () => void;
  sections: readonly SandboxProfileEditorSection[];
  activeSectionId?: string;
  onActiveSectionIdChange?: (sectionId: string) => void;
  renderSectionPanel: (sectionId: SandboxProfileEditorSection["id"]) => React.JSX.Element;
  versionStatusBadge?: React.JSX.Element;
  versionActions?: React.JSX.Element;
  hasUnsavedIntegrationChanges?: boolean;
  hasUnsavedSetupScriptChanges?: boolean;
  isSavingProfileName?: boolean;
}): React.JSX.Element {
  const hasUnsavedDraftChanges =
    input.mode.kind === "draft" &&
    ((input.hasUnsavedIntegrationChanges ?? false) ||
      (input.hasUnsavedSetupScriptChanges ?? false));
  const publishRequestIsPending = input.publishRequestIsPending === true;
  const versionActionIsDisabled = input.versionActionIsPending || publishRequestIsPending;
  const discardChangesInput = resolveDiscardDraftInput(input.mode);
  const discardChangesMenuItem =
    discardChangesInput === null ? null : (
      <DropdownMenuItem
        disabled={hasUnsavedDraftChanges || versionActionIsDisabled}
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

  return (
    <div className="gap-4 flex flex-col">
      <UnsavedChangesGuard
        description="You have unsaved draft changes. If you leave this page, your changes will be discarded."
        when={hasUnsavedDraftChanges}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex items-center gap-2">
          {input.versionStatusBadge ?? (
            <span
              className={
                input.mode.kind === "draft"
                  ? "inline-flex h-6 items-center rounded-sm border border-amber-200 bg-amber-50 px-2 text-xs font-medium text-amber-700"
                  : "inline-flex h-6 items-center rounded-sm border border-blue-200 bg-blue-50 px-2 text-xs font-medium text-blue-700"
              }
            >
              {input.mode.kind === "draft" ? "Viewing: Draft" : "Viewing: Published"}
            </span>
          )}
          {input.versionActions ??
            (input.mode.kind === "draft" ? (
              <ButtonGroup>
                <Button
                  disabled={versionActionIsDisabled}
                  onClick={() => {
                    input.onPublish(input.mode.version);
                  }}
                  type="button"
                >
                  {publishRequestIsPending ? "Publishing..." : "Publish"}
                </Button>
                <MoreActionsMenu
                  disabled={versionActionIsDisabled}
                  triggerIconVariant="chevron-down"
                  triggerLabel="More actions"
                  triggerVariant="default"
                >
                  {viewPublishedMenuItem}
                  {discardChangesMenuItem}
                  {deleteProfileMenuItem}
                </MoreActionsMenu>
              </ButtonGroup>
            ) : (
              <ButtonGroup>
                <Button
                  disabled={input.versionActionIsPending}
                  onClick={input.mode.hasDraft ? input.onViewDraft : input.onMakeChanges}
                  type="button"
                >
                  {input.mode.hasDraft ? "Resume editing" : "Edit"}
                </Button>
                <MoreActionsMenu
                  disabled={input.versionActionIsPending}
                  triggerIconVariant="chevron-down"
                  triggerLabel="More actions"
                  triggerVariant="default"
                >
                  {discardChangesMenuItem}
                  {deleteProfileMenuItem}
                </MoreActionsMenu>
              </ButtonGroup>
            ))}
        </div>
      </div>

      {input.versionActionError === null ? null : (
        <Notice title="Profile version action failed" variant="alert">
          {input.versionActionError}
        </Notice>
      )}

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

      <SandboxProfileEditorSections
        {...(input.activeSectionId === undefined ? {} : { activeSectionId: input.activeSectionId })}
        {...(input.onActiveSectionIdChange === undefined
          ? {}
          : { onActiveSectionIdChange: input.onActiveSectionIdChange })}
        renderPanel={input.renderSectionPanel}
        sections={input.sections}
      />
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
  activeSectionId: string;
  profileId: string;
  version: number;
  disabled: boolean;
  loader: ReturnType<typeof useSandboxProfileIntegrationsLoader>;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
  onDraftStateChange?: (state: SandboxProfileDraftSectionState) => void;
}): React.JSX.Element {
  const showBindingsUnavailableNotice = input.loader.integrationBindingsQuery.isError;
  const showDirectoryUnavailableNotice = input.loader.integrationDirectoryQuery.isError;

  if (
    input.loader.integrationBindingsQuery.isPending ||
    input.loader.integrationDirectoryQuery.isPending ||
    input.loader.initialRows === null ||
    input.loader.integrationBindingsQuery.isError ||
    input.loader.integrationDirectoryQuery.isError
  ) {
    return (
      <SandboxProfileIntegrationsSetupUnavailableState
        activeSectionId={input.activeSectionId}
        integrationBindingsError={
          showBindingsUnavailableNotice ? input.loader.integrationBindingsQuery.error : null
        }
        integrationDirectoryError={
          showDirectoryUnavailableNotice ? input.loader.integrationDirectoryQuery.error : null
        }
        isPending={
          input.loader.integrationBindingsQuery.isPending ||
          input.loader.integrationDirectoryQuery.isPending
        }
      />
    );
  }

  return (
    <ReadySandboxProfileIntegrationSetupSection
      key={`${input.profileId}:${String(input.version)}`}
      activeSectionId={input.activeSectionId}
      profileId={input.profileId}
      version={input.version}
      initialRows={input.loader.initialRows}
      availableConnections={input.loader.availableConnections}
      availableTargets={input.loader.availableTargets}
      disabled={input.disabled}
      invalidateVersionBindings={input.invalidateVersionBindings}
      integrationDirectoryQuery={input.loader.integrationDirectoryQuery}
      {...(input.onDraftStateChange === undefined
        ? {}
        : { onDraftStateChange: input.onDraftStateChange })}
    />
  );
}

export function SandboxProfileIntegrationsSetupUnavailableState(input: {
  activeSectionId: SandboxProfileEditorSection["id"];
  integrationBindingsError: unknown;
  integrationDirectoryError: unknown;
  isPending: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {input.isPending && input.activeSectionId !== "resources-and-tools" ? (
        <div
          aria-live="polite"
          className="text-muted-foreground flex items-center gap-2 text-sm"
          role="status"
        >
          <SpinnerGapIcon aria-hidden className="size-4 animate-spin" />
          <span>Loading integrations...</span>
        </div>
      ) : null}
      {input.integrationBindingsError !== null ? (
        <Notice title="Could not load integration bindings" variant="alert">
          {resolveApiErrorMessage({
            error: input.integrationBindingsError,
            fallbackMessage: "Could not load sandbox profile integration bindings.",
          })}
        </Notice>
      ) : null}
      {input.integrationDirectoryError !== null ? (
        <Notice title="Could not load integration connections" variant="alert">
          {resolveApiErrorMessage({
            error: input.integrationDirectoryError,
            fallbackMessage: "Could not load integration connections.",
          })}
        </Notice>
      ) : null}
    </div>
  );
}

function ReadySandboxProfileIntegrationSetupSection(input: {
  activeSectionId: string;
  profileId: string;
  version: number;
  initialRows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  disabled: boolean;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
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
    invalidateVersionBindings: input.invalidateVersionBindings,
  });
  const onDraftStateChange = input.onDraftStateChange;

  useEffect(() => {
    onDraftStateChange?.({
      flushDraftChanges: integrationsState.flushDraftChanges,
      hasUnsavedChanges: integrationsState.hasUnsavedChanges,
      isSaving: integrationsState.isSubmittingIntegrationBindings,
    });
  }, [
    onDraftStateChange,
    integrationsState.flushDraftChanges,
    integrationsState.hasUnsavedChanges,
    integrationsState.isSubmittingIntegrationBindings,
  ]);

  return input.activeSectionId === "resources-and-tools" ? (
    <SandboxProfileResourcesAndToolsSection
      availableConnections={integrationsState.availableConnections}
      availableTargets={integrationsState.availableTargets}
      disabled={input.disabled}
      onRowChange={integrationsState.onIntegrationBindingRowChange}
      rows={integrationsState.integrationRows}
    />
  ) : (
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
      disabled={input.disabled}
      onAddIntegrationBindingRow={integrationsState.onAddIntegrationBindingRow}
      onIntegrationBindingRowChange={integrationsState.onIntegrationBindingRowChange}
      onRemoveIntegrationBindingRow={integrationsState.onRemoveIntegrationBindingRow}
      onIntegrationSaveErrorDismiss={integrationsState.onIntegrationSaveErrorDismiss}
    />
  );
}

function LoadedSandboxProfileSetupScriptSection(input: {
  profileId: string;
  version: number;
  disabled: boolean;
  loader: ReturnType<typeof useSandboxProfileSetupScriptLoader>;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
  onDraftStateChange?: (state: SandboxProfileDraftSectionState) => void;
}): React.JSX.Element {
  if (input.loader.setupScriptQuery.isPending) {
    return <SandboxProfileSetupScriptPanel disabled={true} value="" />;
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
      invalidateVersionSetupScript={input.invalidateVersionSetupScript}
      profileId={input.profileId}
      disabled={input.disabled}
      setupScript={input.loader.setupScript}
      version={input.version}
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
  setupScript: string | null;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
  onDraftStateChange?: (state: SandboxProfileDraftSectionState) => void;
}): React.JSX.Element {
  const setupScriptState = useLoadedSandboxProfileSetupScriptState({
    profileId: input.profileId,
    version: input.version,
    setupScript: input.setupScript,
    invalidateVersionSetupScript: input.invalidateVersionSetupScript,
  });
  const onDraftStateChange = input.onDraftStateChange;

  useEffect(() => {
    onDraftStateChange?.({
      flushDraftChanges: setupScriptState.flushDraftChanges,
      hasUnsavedChanges: setupScriptState.hasUnsavedChanges,
      isSaving: setupScriptState.isSaving,
    });
  }, [
    onDraftStateChange,
    setupScriptState.flushDraftChanges,
    setupScriptState.hasUnsavedChanges,
    setupScriptState.isSaving,
  ]);

  return (
    <SandboxProfileSetupScriptPanel
      errorMessage={setupScriptState.errorMessage}
      isSaving={setupScriptState.isSaving}
      onBlur={setupScriptState.onBlur}
      onChange={setupScriptState.onChange}
      saveStatus={setupScriptState.saveStatus}
      value={setupScriptState.draftValue}
      disabled={input.disabled}
    />
  );
}

export function SandboxProfileSetupScriptPanel(input: {
  value: string;
  disabled?: boolean;
  isSaving?: boolean;
  saveStatus?: "idle" | "saving" | "saved" | "saved-fading";
  errorMessage?: string | null;
  onChange?: (nextValue: string) => void;
  onBlur?: () => void;
}): React.JSX.Element {
  const liveMessage =
    input.errorMessage !== null && input.errorMessage !== undefined
      ? ""
      : input.saveStatus === "saved" || input.saveStatus === "saved-fading"
        ? "Saved"
        : "";

  return (
    <div className="max-w-5xl">
      <Field>
        <FieldHeader>
          <FieldLabelWithTooltip
            id="sandbox-setup-script-label"
            tooltip="Runs once during sandbox setup after repositories, resources, and CLI tools are ready. Use it for project bootstrap steps such as dependency install, local config generation, or repo-specific setup commands."
            tooltipLabel="Explain setup script"
          >
            Setup script
          </FieldLabelWithTooltip>
        </FieldHeader>
        <FieldContent>
          <p aria-live="polite" className="sr-only" role="status">
            {liveMessage}
          </p>
          <div className="gap-2 flex flex-col">
            <SandboxSetupScriptEditor
              ariaLabelledBy="sandbox-setup-script-label"
              disabled={input.disabled === true || input.isSaving === true}
              onChange={(nextValue) => {
                input.onChange?.(nextValue);
              }}
              placeholderText={SetupScriptPlaceholder}
              value={input.value}
              {...(input.onBlur === undefined ? {} : { onBlur: input.onBlur })}
            />

            {input.errorMessage ? (
              <div aria-live="polite" className="text-destructive text-xs" role="status">
                {input.errorMessage}
              </div>
            ) : input.saveStatus === "saved" || input.saveStatus === "saved-fading" ? (
              <div
                className={`flex items-center gap-1.5 text-xs text-emerald-700 transition-opacity duration-700 ${
                  input.saveStatus === "saved" ? "opacity-100" : "opacity-0"
                }`}
              >
                <CheckCircleIcon aria-hidden className="size-4" weight="fill" />
                <span>Saved</span>
              </div>
            ) : null}
          </div>
        </FieldContent>
      </Field>
    </div>
  );
}
