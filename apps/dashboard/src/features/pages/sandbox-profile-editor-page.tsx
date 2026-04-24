import {
  Button,
  Card,
  CardContent,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  FieldLabelWithTooltip,
  Input,
  Notice,
} from "@mistle/ui";
import { CheckCircleIcon, InfoIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { UnsavedChangesGuard } from "../navigation/unsaved-changes-guard.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionSetupScriptQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  createSandboxProfileVersionDraft,
  getSandboxProfile,
  getSandboxProfileVersionPublishability,
  listSandboxProfileVersions,
  publishSandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type {
  SandboxProfile,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { FormPageFrame, PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
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

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
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
      activeVersion: number;
      hasDraft: boolean;
    };

type ViewedVersionKind = "draft" | "active";

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
  viewedVersionKind: ViewedVersionKind | null;
}): ResolveEditorVersionModeResult {
  const draftVersions = input.versions.filter((version) => version.state === "draft");
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

  if (input.activeVersion !== null && activeVersion === null) {
    return {
      ok: false,
      message: "Sandbox profile active version could not be loaded.",
    };
  }

  const preferredView = input.viewedVersionKind ?? (draftVersion === null ? "active" : "draft");

  if (preferredView === "draft") {
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

  if (input.activeVersion === null || activeVersion === null) {
    return {
      ok: false,
      message: "Sandbox profile published version could not be loaded.",
    };
  }

  return {
    ok: true,
    mode: {
      kind: "active",
      version: activeVersion.version,
      activeVersion: input.activeVersion,
      hasDraft: draftVersion !== null,
    },
  };
}

const SetupScriptPlaceholder = `#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm dev:bootstrap`;

export function SandboxProfileEditorPage(props: SandboxProfileEditorPageProps): React.JSX.Element {
  if (props.mode === "create") {
    return <CreateSandboxProfileEditorPage />;
  }

  return <EditSandboxProfileEditorPage />;
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

function EditSandboxProfileEditorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const profileId = params["profileId"];

  if (profileId === undefined) {
    throw new Error("profileId is required.");
  }

  const profileQuery = useQuery({
    queryKey: sandboxProfileDetailQueryKey(profileId),
    queryFn: async ({ signal }) => getSandboxProfile({ profileId, signal }),
    retry: false,
  });

  if (profileQuery.isPending) {
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

  return (
    <PageFrame maxWidthClassName="max-w-5xl" title="">
      <LoadedSandboxProfileEditorPage
        navigate={navigate}
        profileId={profileId}
        profile={profileQuery.data}
        invalidateSandboxProfiles={async () => {
          await queryClient.invalidateQueries({
            queryKey: ["sandbox-profiles"],
          });
        }}
        invalidateProfileDetail={async (invalidateProfileId) => {
          await queryClient.invalidateQueries({
            queryKey: sandboxProfileDetailQueryKey(invalidateProfileId),
          });
        }}
        invalidateProfileVersions={async (invalidateProfileId) => {
          await queryClient.invalidateQueries({
            queryKey: sandboxProfileVersionsQueryKey(invalidateProfileId),
          });
        }}
        invalidateVersionBindings={async ({ profileId: invalidateProfileId, version }) => {
          await queryClient.invalidateQueries({
            queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
              profileId: invalidateProfileId,
              version,
            }),
          });
        }}
        invalidateVersionSetupScript={async ({ profileId: invalidateProfileId, version }) => {
          await queryClient.invalidateQueries({
            queryKey: sandboxProfileVersionSetupScriptQueryKey({
              profileId: invalidateProfileId,
              version,
            }),
          });
        }}
      />
    </PageFrame>
  );
}

type LoadedSandboxProfileEditorPageInput = {
  navigate: ReturnType<typeof useNavigate>;
  profileId: string;
  profile: SandboxProfile;
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
  invalidateProfileVersions: (profileId: string) => Promise<void>;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
};

function LoadedSandboxProfileEditorPage(
  input: LoadedSandboxProfileEditorPageInput,
): React.JSX.Element {
  const [viewedVersionKind, setViewedVersionKind] = useState<ViewedVersionKind | null>(null);
  const [versionActionError, setVersionActionError] = useState<string | null>(null);
  const profileVersionsQuery = useQuery({
    queryKey: sandboxProfileVersionsQueryKey(input.profileId),
    queryFn: async ({ signal }) =>
      listSandboxProfileVersions({
        profileId: input.profileId,
        signal,
      }),
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
      setViewedVersionKind("draft");
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
      await Promise.all([
        input.invalidateProfileVersions(input.profileId),
        input.invalidateSandboxProfiles(),
        input.invalidateProfileDetail(input.profileId),
        input.invalidateVersionBindings({
          profileId: input.profileId,
          version: result.activeVersion,
        }),
        input.invalidateVersionSetupScript({
          profileId: input.profileId,
          version: result.activeVersion,
        }),
      ]);
      setViewedVersionKind("active");
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

  if (profileVersionsQuery.isPending) {
    return <></>;
  }

  if (profileVersionsQuery.isError || profileVersionsQuery.data === undefined) {
    return (
      <Notice title="Could not load profile versions" variant="alert">
        {resolveApiErrorMessage({
          error: profileVersionsQuery.error,
          fallbackMessage: "Could not load sandbox profile versions.",
        })}
      </Notice>
    );
  }

  const resolvedMode = resolveSandboxProfileEditorVersionMode({
    activeVersion: input.profile.activeVersion,
    versions: profileVersionsQuery.data.versions,
    viewedVersionKind,
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
      createDraftIsPending={createDraftMutation.isPending}
      mode={resolvedMode.mode}
      navigate={input.navigate}
      onMakeChanges={() => {
        createDraftMutation.mutate();
      }}
      onPublish={(version) => {
        publishMutation.mutate(version);
      }}
      onViewActive={() => {
        setVersionActionError(null);
        setViewedVersionKind("active");
      }}
      onViewDraft={() => {
        setVersionActionError(null);
        setViewedVersionKind("draft");
      }}
      profile={input.profile}
      profileId={input.profileId}
      publishIsPending={publishMutation.isPending}
      versionActionError={versionActionError}
      invalidateSandboxProfiles={input.invalidateSandboxProfiles}
      invalidateProfileDetail={input.invalidateProfileDetail}
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
  versionActionError: string | null;
  publishIsPending: boolean;
  createDraftIsPending: boolean;
  onPublish: (version: number) => void;
  onMakeChanges: () => void;
  onViewActive: () => void;
  onViewDraft: () => void;
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
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
  const [hasUnsavedIntegrationChanges, setHasUnsavedIntegrationChanges] = useState(false);
  const metaState = useEditSandboxProfileMetaState({
    profileId: input.profileId,
    loadedProfile: input.profile,
    navigate: input.navigate,
    invalidateSandboxProfiles: input.invalidateSandboxProfiles,
    invalidateProfileDetail: input.invalidateProfileDetail,
  });

  return (
    <SandboxProfileEditorView
      hasUnsavedIntegrationChanges={hasUnsavedIntegrationChanges}
      isSavingProfileName={metaState.isUpdating}
      mode={input.mode}
      onMakeChanges={input.onMakeChanges}
      onPublish={input.onPublish}
      onSaveProfileName={metaState.onProfileNameSave}
      onViewActive={input.onViewActive}
      onViewDraft={input.onViewDraft}
      profileName={metaState.formState.displayName}
      profileNameFallback={metaState.pageTitle}
      versionActionError={input.versionActionError}
      versionActionIsPending={input.publishIsPending || input.createDraftIsPending}
      renderSectionPanel={(sectionId) => {
        if (sectionId === "configurations") {
          return (
            <LoadedSandboxProfileSetupScriptSection
              disabled={input.mode.kind !== "draft"}
              key={`${input.profileId}:${String(input.mode.version)}`}
              loader={setupScriptLoader}
              profileId={input.profileId}
              invalidateVersionSetupScript={input.invalidateVersionSetupScript}
              version={input.mode.version}
            />
          );
        }

        return (
          <LoadedSandboxProfileIntegrationSetupSection
            key={`${input.profileId}:integration-setup`}
            activeSectionId={sectionId}
            loader={integrationsLoader}
            onHasUnsavedChangesChange={setHasUnsavedIntegrationChanges}
            profileId={input.profileId}
            disabled={input.mode.kind !== "draft"}
            version={input.mode.version}
            invalidateVersionBindings={input.invalidateVersionBindings}
          />
        );
      }}
      sections={SandboxProfileEditorTabs}
    />
  );
}

const SandboxProfileEditorTabs = [
  {
    id: "integrations",
    label: "Integrations",
  },
  {
    id: "resources-and-tools",
    label: "Resources & Tools",
  },
  {
    id: "configurations",
    label: "Configurations",
  },
] as const satisfies readonly SandboxProfileEditorSection[];

export function SandboxProfileEditorView(input: {
  profileName: string | null;
  profileNameFallback: string;
  onSaveProfileName: (nextValue: string) => Promise<void>;
  mode: SandboxProfileEditorVersionMode;
  versionActionError: string | null;
  versionActionIsPending: boolean;
  onPublish: (version: number) => void;
  onMakeChanges: () => void;
  onViewActive: () => void;
  onViewDraft: () => void;
  sections: readonly SandboxProfileEditorSection[];
  renderSectionPanel: (sectionId: SandboxProfileEditorSection["id"]) => React.JSX.Element;
  hasUnsavedIntegrationChanges?: boolean;
  isSavingProfileName?: boolean;
}): React.JSX.Element {
  return (
    <div className="gap-4 flex flex-col">
      <UnsavedChangesGuard
        description="You have unsaved integration changes. If you leave this page, your changes will be discarded."
        when={input.hasUnsavedIntegrationChanges ?? false}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AutoSaveTitleHeading
            ariaLabel="Profile name"
            emptyDisplayText={input.profileNameFallback}
            onSave={input.onSaveProfileName}
            requiredLabel="Profile name"
            value={input.profileName}
            disabled={input.isSavingProfileName === true}
          />
          <span className="border-border text-muted-foreground inline-flex h-6 items-center rounded-sm border px-2 text-xs font-medium">
            {input.mode.kind === "draft" ? "Draft" : "Published"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {input.mode.kind === "draft" ? (
            <>
              {input.mode.activeVersion === null ? null : (
                <Button onClick={input.onViewActive} type="button" variant="outline">
                  View published version
                </Button>
              )}
              <Button
                disabled={input.versionActionIsPending}
                onClick={() => {
                  input.onPublish(input.mode.version);
                }}
                type="button"
              >
                Publish
              </Button>
            </>
          ) : input.mode.hasDraft ? (
            <Button onClick={input.onViewDraft} type="button">
              Back to draft
            </Button>
          ) : (
            <Button
              disabled={input.versionActionIsPending}
              onClick={input.onMakeChanges}
              type="button"
            >
              Make changes
            </Button>
          )}
        </div>
      </div>

      {input.versionActionError === null ? null : (
        <Notice title="Profile version action failed" variant="alert">
          {input.versionActionError}
        </Notice>
      )}

      <SandboxProfileEditorSections
        renderPanel={input.renderSectionPanel}
        sections={input.sections}
      />
    </div>
  );
}

function LoadedSandboxProfileIntegrationSetupSection(input: {
  activeSectionId: string;
  profileId: string;
  version: number;
  disabled: boolean;
  loader: ReturnType<typeof useSandboxProfileIntegrationsLoader>;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
  onHasUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
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
      {...(input.onHasUnsavedChangesChange === undefined
        ? {}
        : { onHasUnsavedChangesChange: input.onHasUnsavedChangesChange })}
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
  onHasUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
}): React.JSX.Element {
  const integrationsState = useLoadedSandboxProfileIntegrationsState({
    profileId: input.profileId,
    version: input.version,
    initialRows: input.initialRows,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
    invalidateVersionBindings: input.invalidateVersionBindings,
  });

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
    />
  );
}

function LoadedSandboxProfileSetupScriptSection(input: {
  profileId: string;
  version: number;
  disabled: boolean;
  loader: ReturnType<typeof useSandboxProfileSetupScriptLoader>;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
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
    />
  );
}

function ReadySandboxProfileSetupScriptSection(input: {
  profileId: string;
  version: number;
  disabled: boolean;
  setupScript: string | null;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
}): React.JSX.Element {
  const setupScriptState = useLoadedSandboxProfileSetupScriptState({
    profileId: input.profileId,
    version: input.version,
    setupScript: input.setupScript,
    invalidateVersionSetupScript: input.invalidateVersionSetupScript,
  });

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
      : input.saveStatus === "saving"
        ? "Saving"
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
            ) : input.saveStatus === "saving" ? (
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <SpinnerGapIcon className="size-3.5 animate-spin" />
                <span>Saving</span>
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
