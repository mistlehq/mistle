import {
  Button,
  Card,
  CardContent,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Notice,
} from "@mistle/ui";
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
  useLoadedSandboxProfileIntegrationsState,
  useSandboxProfileIntegrationsLoader,
} from "./sandbox-profile-integrations-state.js";
import {
  useCreateSandboxProfileMetaState,
  useEditSandboxProfileMetaState,
} from "./sandbox-profile-meta-state.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

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
      />
    </PageFrame>
  );
}

function LoadedSandboxProfileEditorPage(input: {
  navigate: ReturnType<typeof useNavigate>;
  profileId: string;
  profile: { displayName: string };
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
}): React.JSX.Element {
  const integrationsLoader = useSandboxProfileIntegrationsLoader({
    profileId: input.profileId,
  });
  const [hasUnsavedIntegrationChanges, setHasUnsavedIntegrationChanges] = useState(false);

  return (
    <div className="gap-4 flex flex-col">
      <UnsavedChangesGuard
        description="You have unsaved integration changes. If you leave this page, your changes will be discarded."
        when={hasUnsavedIntegrationChanges}
      />

      <LoadedSandboxProfileMetaSection
        key={`${input.profileId}:${input.profile.displayName}`}
        invalidateProfileDetail={input.invalidateProfileDetail}
        invalidateSandboxProfiles={input.invalidateSandboxProfiles}
        navigate={input.navigate}
        profile={input.profile}
        profileId={input.profileId}
      />

      <LoadedSandboxProfileIntegrationsSection
        key={
          integrationsLoader.version === null
            ? `unavailable:${input.profileId}`
            : `${input.profileId}:${String(integrationsLoader.version)}`
        }
        loader={integrationsLoader}
        onHasUnsavedChangesChange={setHasUnsavedIntegrationChanges}
        profileId={input.profileId}
        invalidateVersionBindings={input.invalidateVersionBindings}
      />
    </div>
  );
}

function LoadedSandboxProfileMetaSection(input: {
  navigate: ReturnType<typeof useNavigate>;
  profileId: string;
  profile: { displayName: string };
  invalidateSandboxProfiles: () => Promise<void>;
  invalidateProfileDetail: (profileId: string) => Promise<void>;
}): React.JSX.Element {
  const metaState = useEditSandboxProfileMetaState({
    profileId: input.profileId,
    loadedProfile: input.profile,
    navigate: input.navigate,
    invalidateSandboxProfiles: input.invalidateSandboxProfiles,
    invalidateProfileDetail: input.invalidateProfileDetail,
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AutoSaveTitleHeading
          ariaLabel="Profile name"
          disabled={metaState.isUpdating}
          emptyDisplayText={metaState.pageTitle}
          onSave={metaState.onProfileNameSave}
          requiredLabel="Profile name"
          value={metaState.formState.displayName}
        />
      </div>
    </>
  );
}

function LoadedSandboxProfileIntegrationsSection(input: {
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
      invalidateVersionBindings={input.invalidateVersionBindings}
      integrationDirectoryQuery={input.loader.integrationDirectoryQuery}
    />
  );
}

function ReadySandboxProfileIntegrationsSection(input: {
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
      {...(input.onHasUnsavedChangesChange === undefined
        ? {}
        : { onHasUnsavedChangesChange: input.onHasUnsavedChangesChange })}
    />
  );
}
