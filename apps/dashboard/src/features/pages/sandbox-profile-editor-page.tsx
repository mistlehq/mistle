import {
  Button,
  Card,
  CardContent,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { CheckCircleIcon, InfoIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfile } from "../sandbox-profiles/sandbox-profiles-service.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { FormPageFrame, PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { IntegrationsEditorSection } from "./integrations-editor-section.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileEditorSections,
  type SandboxProfileEditorSection,
} from "./sandbox-profile-editor-sections.js";
import {
  useLoadedSandboxProfileIntegrationsState,
  useSandboxProfileIntegrationsLoader,
} from "./sandbox-profile-integrations-state.js";
import {
  useCreateSandboxProfileMetaState,
  useEditSandboxProfileMetaState,
} from "./sandbox-profile-meta-state.js";
import {
  useLoadedSandboxProfileSetupScriptState,
  useSandboxProfileSetupScriptLoader,
} from "./sandbox-profile-setup-script-state.js";
import { SandboxSetupScriptEditor } from "./sandbox-setup-script-editor.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

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
  profile: { displayName: string };
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
};

function LoadedSandboxProfileEditorPage(
  input: LoadedSandboxProfileEditorPageInput,
): React.JSX.Element {
  const integrationsLoader = useSandboxProfileIntegrationsLoader({
    profileId: input.profileId,
  });
  const setupScriptLoader = useSandboxProfileSetupScriptLoader({
    profileId: input.profileId,
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
      onSaveProfileName={metaState.onProfileNameSave}
      profileName={metaState.formState.displayName}
      profileNameFallback={metaState.pageTitle}
      renderSectionPanel={(sectionId) => {
        if (sectionId === "configurations") {
          return (
            <LoadedSandboxProfileSetupScriptSection
              key={
                setupScriptLoader.version === null
                  ? `unavailable:${input.profileId}`
                  : `${input.profileId}:${String(setupScriptLoader.version)}`
              }
              loader={setupScriptLoader}
              profileId={input.profileId}
              invalidateVersionSetupScript={input.invalidateVersionSetupScript}
            />
          );
        }

        return (
          <LoadedSandboxProfileIntegrationsSection
            key={`${sectionId}:${input.profileId}`}
            kind={resolveIntegrationSectionKind(sectionId)}
            loader={integrationsLoader}
            onHasUnsavedChangesChange={setHasUnsavedIntegrationChanges}
            profileId={input.profileId}
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
    id: "agent",
    label: "Agent Harness",
  },
  {
    id: "git",
    label: "Git Provider",
  },
  {
    id: "connector",
    label: "Connectors",
  },
  {
    id: "configurations",
    label: "Configurations",
  },
] as const satisfies readonly SandboxProfileEditorSection[];

function resolveIntegrationSectionKind(sectionId: string): "agent" | "git" | "connector" {
  if (sectionId === "agent" || sectionId === "git" || sectionId === "connector") {
    return sectionId;
  }

  throw new Error(`Unsupported integration section: ${sectionId}`);
}

export function SandboxProfileEditorView(input: {
  profileName: string | null;
  profileNameFallback: string;
  onSaveProfileName: (nextValue: string) => Promise<void>;
  sections: readonly SandboxProfileEditorSection[];
  renderSectionPanel: (sectionId: string) => React.JSX.Element;
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
        <AutoSaveTitleHeading
          ariaLabel="Profile name"
          emptyDisplayText={input.profileNameFallback}
          onSave={input.onSaveProfileName}
          requiredLabel="Profile name"
          value={input.profileName}
          {...(input.isSavingProfileName === undefined
            ? {}
            : { disabled: input.isSavingProfileName })}
        />
      </div>

      <SandboxProfileEditorSections
        renderPanel={input.renderSectionPanel}
        sections={input.sections}
      />
    </div>
  );
}

function LoadedSandboxProfileIntegrationsSection(input: {
  kind: "agent" | "git" | "connector";
  profileId: string;
  loader: ReturnType<typeof useSandboxProfileIntegrationsLoader>;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
  onHasUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
}): React.JSX.Element {
  if (
    input.loader.integrationBindingsQuery.isPending ||
    input.loader.integrationBindingsQuery.isError ||
    input.loader.integrationDirectoryQuery.isPending ||
    input.loader.integrationDirectoryQuery.isError ||
    input.loader.initialRows === null ||
    input.loader.version === null
  ) {
    return (
      <IntegrationsEditorSection
        availableConnections={input.loader.availableConnections}
        availableTargets={input.loader.availableTargets}
        integrationBindingsQuery={input.loader.integrationBindingsQuery}
        integrationDirectoryQuery={input.loader.integrationDirectoryQuery}
        integrationRowErrorsByClientId={{}}
        integrationRows={[]}
        integrationSaveError={null}
        isSubmittingIntegrationBindings={false}
        onAddIntegrationBindingRow={async () => false}
        onIntegrationBindingRowChange={() => {}}
        onRemoveIntegrationBindingRow={() => {}}
        sectionKinds={[input.kind]}
        showSectionNavigation={false}
        {...(input.onHasUnsavedChangesChange === undefined
          ? {}
          : { onHasUnsavedChangesChange: input.onHasUnsavedChangesChange })}
      />
    );
  }

  return (
    <ReadySandboxProfileIntegrationsSection
      key={`${input.profileId}:${String(input.loader.version)}`}
      profileId={input.profileId}
      version={input.loader.version}
      initialRows={input.loader.initialRows}
      availableConnections={input.loader.availableConnections}
      availableTargets={input.loader.availableTargets}
      kind={input.kind}
      invalidateVersionBindings={input.invalidateVersionBindings}
      integrationDirectoryQuery={input.loader.integrationDirectoryQuery}
      {...(input.onHasUnsavedChangesChange === undefined
        ? {}
        : { onHasUnsavedChangesChange: input.onHasUnsavedChangesChange })}
    />
  );
}

function ReadySandboxProfileIntegrationsSection(input: {
  kind: "agent" | "git" | "connector";
  profileId: string;
  version: number;
  initialRows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
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

  return (
    <IntegrationsEditorSection
      availableConnections={integrationsState.availableConnections}
      availableTargets={integrationsState.availableTargets}
      integrationBindingsQuery={{
        isError: false,
        error: null,
        isPending: false,
      }}
      integrationDirectoryQuery={input.integrationDirectoryQuery}
      integrationRowErrorsByClientId={integrationsState.integrationRowErrorsByClientId}
      integrationRows={integrationsState.integrationRows}
      integrationSaveError={integrationsState.integrationSaveError}
      isSubmittingIntegrationBindings={integrationsState.isSubmittingIntegrationBindings}
      onAddIntegrationBindingRow={integrationsState.onAddIntegrationBindingRow}
      onIntegrationBindingRowChange={integrationsState.onIntegrationBindingRowChange}
      onRemoveIntegrationBindingRow={integrationsState.onRemoveIntegrationBindingRow}
      sectionKinds={[input.kind]}
      showSectionNavigation={false}
      {...(input.onHasUnsavedChangesChange === undefined
        ? {}
        : { onHasUnsavedChangesChange: input.onHasUnsavedChangesChange })}
    />
  );
}

function LoadedSandboxProfileSetupScriptSection(input: {
  profileId: string;
  loader: ReturnType<typeof useSandboxProfileSetupScriptLoader>;
  invalidateVersionSetupScript: (input: { profileId: string; version: number }) => Promise<void>;
}): React.JSX.Element {
  if (input.loader.setupScriptQuery.isPending) {
    return <SandboxProfileSetupScriptPanel disabled={true} value="" />;
  }

  if (input.loader.setupScriptQuery.isError || input.loader.version === null) {
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
      setupScript={input.loader.setupScript}
      version={input.loader.version}
    />
  );
}

function ReadySandboxProfileSetupScriptSection(input: {
  profileId: string;
  version: number;
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
          <div className="flex items-center gap-1.5">
            <p
              className="text-muted-foreground text-xs uppercase tracking-wide"
              id="sandbox-setup-script-label"
            >
              Setup script
            </p>
            <Tooltip delay={0}>
              <TooltipTrigger
                aria-label="Explain setup script"
                render={
                  <button
                    className="text-muted-foreground hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
                    type="button"
                  />
                }
              >
                <InfoIcon aria-hidden className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-left" side="top">
                Runs once during sandbox setup after repositories, resources, and CLI tools are
                ready. Use it for project bootstrap steps such as dependency install, local config
                generation, or repo-specific setup commands.
              </TooltipContent>
            </Tooltip>
          </div>
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
