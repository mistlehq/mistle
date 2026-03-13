import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Skeleton,
} from "@mistle/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { IntegrationFormContext } from "../forms/integration-form-context.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfile } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import { EditablePageTitle } from "../shared/editable-page-title.js";
import {
  createDefaultBindingConfig,
  resolveBindingKindFromTarget,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileBindingDialog,
  type SandboxProfileBindingDialogState,
} from "./sandbox-profile-binding-dialog.js";
import { SandboxProfileBindingSection } from "./sandbox-profile-binding-section.js";
import { useSandboxProfileIntegrationsState } from "./sandbox-profile-integrations-state.js";
import { useSandboxProfileMetaState } from "./sandbox-profile-meta-state.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

type IntegrationsEditorSectionProps = {
  integrationBindingsQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
  };
  integrationDirectoryQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
  };
  integrationSaveError: string | null;
  integrationRows: readonly SandboxProfileBindingEditorRow[];
  integrationRowErrorsByClientId: Readonly<Record<string, string>>;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onRemoveIntegrationBindingRow: (clientId: string) => void;
  onIntegrationBindingRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  resolveSelectedConnectionDisplayName: (row: SandboxProfileBindingEditorRow) => string | undefined;
  onAddIntegrationBindingRow: (input: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
    config: Record<string, unknown>;
  }) => Promise<boolean>;
  isSavingIntegrationBindings: boolean;
  integrationSaveSuccess: boolean;
  bindingFormContext?: IntegrationFormContext | undefined;
};

const BindingSectionKinds: readonly SandboxIntegrationBindingKind[] = ["agent", "git", "connector"];

export function preserveDialogRowIdentity(input: {
  currentRow: SandboxProfileBindingEditorRow;
  nextDraftRow: SandboxProfileBindingEditorRow;
}): SandboxProfileBindingEditorRow {
  return {
    ...input.nextDraftRow,
    clientId: input.currentRow.clientId,
    ...(input.currentRow.id === undefined ? {} : { id: input.currentRow.id }),
  };
}

export function IntegrationsEditorSection(
  props: IntegrationsEditorSectionProps,
): React.JSX.Element {
  const [integrationDialogState, setIntegrationDialogState] =
    useState<SandboxProfileBindingDialogState | null>(null);

  const availableConnectionsByKind = useMemo(() => {
    const grouped: Record<SandboxIntegrationBindingKind, IntegrationConnectionSummary[]> = {
      agent: [],
      git: [],
      connector: [],
    };

    for (const connection of props.availableConnections) {
      const target = props.availableTargets.find(
        (candidate) => candidate.targetKey === connection.targetKey,
      );
      const kind = resolveBindingKindFromTarget(target);
      if (kind === undefined) {
        continue;
      }
      grouped[kind].push(connection);
    }

    return grouped;
  }, [props.availableConnections, props.availableTargets]);

  const integrationRowsByKind = useMemo(() => {
    const grouped: Record<SandboxIntegrationBindingKind, SandboxProfileBindingEditorRow[]> = {
      agent: [],
      git: [],
      connector: [],
    };

    for (const row of props.integrationRows) {
      grouped[row.kind].push(row);
    }

    return grouped;
  }, [props.integrationRows]);

  function closeIntegrationDialog(): void {
    setIntegrationDialogState(null);
  }

  function createDraftRow(
    kind: SandboxIntegrationBindingKind,
    connectionId: string,
  ): SandboxProfileBindingEditorRow {
    const selectedConnection = availableConnectionsByKind[kind].find(
      (connection) => connection.id === connectionId,
    );
    const selectedTarget =
      selectedConnection === undefined
        ? undefined
        : props.availableTargets.find(
            (target) => target.targetKey === selectedConnection.targetKey,
          );

    return {
      clientId: "dialog-draft",
      connectionId,
      kind,
      config: createDefaultBindingConfig({
        ...(selectedConnection === undefined ? {} : { connection: selectedConnection }),
        ...(selectedTarget === undefined ? {} : { target: selectedTarget }),
      }),
    };
  }

  function openAddDialog(kind: SandboxIntegrationBindingKind): void {
    const firstConnectionId = availableConnectionsByKind[kind][0]?.id ?? "";
    setIntegrationDialogState({
      mode: "add",
      row: createDraftRow(kind, firstConnectionId),
      error: null,
    });
  }

  function openEditDialog(row: SandboxProfileBindingEditorRow): void {
    setIntegrationDialogState({
      mode: "edit",
      row: {
        ...row,
      },
      error: null,
    });
  }

  function updateDialogConnectionId(nextConnectionId: string): void {
    if (integrationDialogState === null) {
      return;
    }
    const nextDraftRow = createDraftRow(integrationDialogState.row.kind, nextConnectionId);
    setIntegrationDialogState({
      ...integrationDialogState,
      row: preserveDialogRowIdentity({
        currentRow: integrationDialogState.row,
        nextDraftRow,
      }),
      error: null,
    });
  }

  function updateDialogRow(
    _clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ): void {
    if (integrationDialogState === null) {
      return;
    }
    setIntegrationDialogState({
      ...integrationDialogState,
      row: {
        ...integrationDialogState.row,
        ...changes,
      },
      error: null,
    });
  }

  function saveBindingFromDialog(): void {
    if (integrationDialogState === null) {
      return;
    }

    if (integrationDialogState.row.connectionId.trim().length === 0) {
      setIntegrationDialogState({
        ...integrationDialogState,
        error: "Select a connection to add this binding.",
      });
      return;
    }

    const selectedConnection = availableConnectionsByKind[integrationDialogState.row.kind].find(
      (connection) => connection.id === integrationDialogState.row.connectionId,
    );
    if (selectedConnection === undefined) {
      setIntegrationDialogState({
        ...integrationDialogState,
        error: "Selected connection is no longer available.",
      });
      return;
    }

    if (integrationDialogState.mode === "edit") {
      props.onIntegrationBindingRowChange(integrationDialogState.row.clientId, {
        connectionId: integrationDialogState.row.connectionId,
        kind: integrationDialogState.row.kind,
        config: integrationDialogState.row.config,
      });
      closeIntegrationDialog();
      return;
    }

    void props
      .onAddIntegrationBindingRow({
        kind: integrationDialogState.row.kind,
        connectionId: selectedConnection.id,
        config: integrationDialogState.row.config,
      })
      .then((didSave) => {
        if (didSave) {
          closeIntegrationDialog();
          return;
        }
        setIntegrationDialogState((currentState) => {
          if (currentState === null) {
            return currentState;
          }
          return {
            ...currentState,
            error: "Could not add binding.",
          };
        });
      });
  }

  return (
    <div className="gap-4 flex flex-col">
      {props.integrationBindingsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load integration bindings</AlertTitle>
          <AlertDescription>
            {resolveApiErrorMessage({
              error: props.integrationBindingsQuery.error,
              fallbackMessage: "Could not load sandbox profile integration bindings.",
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {props.integrationDirectoryQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load integration connections</AlertTitle>
          <AlertDescription>
            {resolveApiErrorMessage({
              error: props.integrationDirectoryQuery.error,
              fallbackMessage: "Could not load integration connections.",
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {props.integrationSaveError ? (
        <Alert variant="destructive">
          <AlertTitle>Save failed</AlertTitle>
          <AlertDescription>{props.integrationSaveError}</AlertDescription>
        </Alert>
      ) : null}

      {BindingSectionKinds.map((kind) => (
        <SandboxProfileBindingSection
          addDisabled={
            props.integrationDirectoryQuery.isPending ||
            availableConnectionsByKind[kind].length === 0
          }
          availableConnections={props.availableConnections}
          availableTargets={props.availableTargets}
          key={kind}
          kind={kind}
          onAdd={() => {
            openAddDialog(kind);
          }}
          onEdit={openEditDialog}
          onRemove={props.onRemoveIntegrationBindingRow}
          rowErrorsByClientId={props.integrationRowErrorsByClientId}
          rows={integrationRowsByKind[kind]}
        />
      ))}

      <SandboxProfileBindingDialog
        availableConnections={props.availableConnections}
        availableConnectionsByKind={availableConnectionsByKind}
        availableTargets={props.availableTargets}
        bindingFormContext={props.bindingFormContext}
        isSavingIntegrationBindings={props.isSavingIntegrationBindings}
        onClose={closeIntegrationDialog}
        onConnectionIdChange={updateDialogConnectionId}
        onRowChange={updateDialogRow}
        onSave={saveBindingFromDialog}
        resolveSelectedConnectionDisplayName={props.resolveSelectedConnectionDisplayName}
        state={integrationDialogState}
      />

      <div className="gap-2 flex">
        {props.isSavingIntegrationBindings ? (
          <p className="text-muted-foreground text-sm self-center">Saving...</p>
        ) : null}
        {props.integrationSaveSuccess ? (
          <p className="text-muted-foreground text-sm self-center">Saved.</p>
        ) : null}
      </div>
    </div>
  );
}

export function SandboxProfileEditorPage(props: SandboxProfileEditorPageProps): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const profileId = params["profileId"];
  const profileQuery = useQuery({
    queryKey:
      props.mode === "edit" && profileId !== undefined
        ? sandboxProfileDetailQueryKey(profileId)
        : sandboxProfileDetailQueryKey("missing-profile-id"),
    queryFn: async ({ signal }) => {
      if (profileId === undefined) {
        throw new Error("profileId is required.");
      }

      return getSandboxProfile({ profileId, signal });
    },
    enabled: props.mode === "edit",
    retry: false,
  });
  const metaState = useSandboxProfileMetaState({
    mode: props.mode,
    profileId,
    loadedProfile: profileQuery.data,
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
  });

  const integrationsState = useSandboxProfileIntegrationsState({
    mode: props.mode,
    profileId,
    invalidateVersionBindings: async ({ profileId: invalidateProfileId, version }) => {
      await queryClient.invalidateQueries({
        queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
          profileId: invalidateProfileId,
          version,
        }),
      });
    },
  });

  if (props.mode === "edit" && profileQuery.isPending) {
    return (
      <div className="gap-4 flex flex-col">
        <h1 className="text-xl font-semibold">{metaState.pageTitle}</h1>
        <Card>
          <CardContent className="pt-4">
            <div className="gap-3 flex flex-col">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-48" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (props.mode === "edit" && profileQuery.isError) {
    const isNotFoundError =
      profileQuery.error instanceof SandboxProfilesApiError && profileQuery.error.status === 404;

    return (
      <div className="gap-4 flex flex-col">
        <h1 className="text-xl font-semibold">{metaState.pageTitle}</h1>
        <Card>
          <CardContent className="gap-3 flex flex-col pt-4">
            <Alert variant="destructive">
              <AlertTitle>
                {isNotFoundError ? "Sandbox profile not found" : "Could not load profile"}
              </AlertTitle>
              <AlertDescription>
                {resolveApiErrorMessage({
                  error: profileQuery.error,
                  fallbackMessage: isNotFoundError
                    ? "The sandbox profile was not found."
                    : "Could not load sandbox profile.",
                })}
              </AlertDescription>
            </Alert>
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
    );
  }

  return (
    <div className="gap-4 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {props.mode === "create" ? (
          <h1 className="text-xl font-semibold">{metaState.pageTitle}</h1>
        ) : (
          <EditablePageTitle
            ariaLabel="Profile name"
            cancelOnEscape={true}
            draftValue={metaState.profileNameDraft}
            editButtonLabel="Edit profile name"
            errorMessage={undefined}
            isEditing={metaState.isEditingProfileName}
            maxWidthClassName={undefined}
            onCancel={metaState.onProfileNameEditCancel}
            onCommit={metaState.onProfileNameEditCommit}
            onDraftValueChange={metaState.onProfileNameDraftChange}
            onEditStart={metaState.onProfileNameEditStart}
            placeholder={undefined}
            saveDisabled={metaState.isUpdating}
            title={metaState.pageTitle}
          />
        )}
      </div>
      {metaState.saveError ? (
        <Alert variant="destructive">
          <AlertTitle>{props.mode === "create" ? "Create failed" : "Update failed"}</AlertTitle>
          <AlertDescription>{metaState.saveError}</AlertDescription>
        </Alert>
      ) : null}

      {props.mode === "create" ? (
        <Card>
          <CardContent className="gap-4 flex flex-col pt-4">
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
                onClick={metaState.onCreate}
                type="button"
              >
                {metaState.isCreating ? "Creating..." : "Create profile"}
              </Button>
              <Button onClick={metaState.onCancelCreate} type="button" variant="outline">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {integrationsState.canEditIntegrations ? (
        <IntegrationsEditorSection
          availableConnections={integrationsState.availableConnections}
          availableTargets={integrationsState.availableTargets}
          integrationBindingsQuery={integrationsState.integrationBindingsQuery}
          integrationDirectoryQuery={integrationsState.integrationDirectoryQuery}
          integrationRowErrorsByClientId={integrationsState.integrationRowErrorsByClientId}
          integrationRows={integrationsState.integrationRows}
          integrationSaveError={integrationsState.integrationSaveError}
          integrationSaveSuccess={integrationsState.integrationSaveSuccess}
          isSavingIntegrationBindings={integrationsState.isSavingIntegrationBindings}
          onAddIntegrationBindingRow={integrationsState.onAddIntegrationBindingRow}
          onIntegrationBindingRowChange={integrationsState.onIntegrationBindingRowChange}
          onRemoveIntegrationBindingRow={integrationsState.onRemoveIntegrationBindingRow}
          resolveSelectedConnectionDisplayName={
            integrationsState.resolveSelectedConnectionDisplayName
          }
        />
      ) : null}
    </div>
  );
}
