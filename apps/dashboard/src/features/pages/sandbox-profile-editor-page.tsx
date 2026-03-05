import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfile } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  createDefaultBindingConfig,
  resolveBindingKindFromTarget,
  SandboxProfileBindingConfigEditor,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { useSandboxProfileIntegrationsState } from "./sandbox-profile-integrations-state.js";
import { useSandboxProfileMetaState } from "./sandbox-profile-meta-state.js";
import { SandboxProfileTitleEditor } from "./sandbox-profile-title-editor.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

function formatBindingKind(kind: SandboxIntegrationBindingKind): string {
  if (kind === "agent") {
    return "Agent";
  }
  if (kind === "git") {
    return "Git";
  }
  return "Connector";
}

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
};

type IntegrationAddDialogState = {
  kind: SandboxIntegrationBindingKind;
  connectionId: string;
  error: string | null;
};

const BindingSectionKinds: readonly SandboxIntegrationBindingKind[] = ["agent", "git", "connector"];

function formatBindingSectionTitle(kind: SandboxIntegrationBindingKind): string {
  if (kind === "agent") {
    return "Agent Bindings";
  }
  if (kind === "git") {
    return "Git Bindings";
  }
  return "Connector Bindings";
}

export function IntegrationsEditorSection(
  props: IntegrationsEditorSectionProps,
): React.JSX.Element {
  const [addDialogState, setAddDialogState] = useState<IntegrationAddDialogState | null>(null);

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

  function closeAddDialog(): void {
    setAddDialogState(null);
  }

  function openAddDialog(kind: SandboxIntegrationBindingKind): void {
    const firstConnectionId = availableConnectionsByKind[kind][0]?.id ?? "";
    setAddDialogState({
      kind,
      connectionId: firstConnectionId,
      error: null,
    });
  }

  function updateAddDialogConnectionId(nextConnectionId: string): void {
    if (addDialogState === null) {
      return;
    }
    setAddDialogState({
      ...addDialogState,
      connectionId: nextConnectionId,
      error: null,
    });
  }

  function addBindingFromDialog(): void {
    if (addDialogState === null) {
      return;
    }

    if (addDialogState.connectionId.trim().length === 0) {
      setAddDialogState({
        ...addDialogState,
        error: "Select a connection to add this binding.",
      });
      return;
    }

    const selectedConnection = availableConnectionsByKind[addDialogState.kind].find(
      (connection) => connection.id === addDialogState.connectionId,
    );
    if (selectedConnection === undefined) {
      setAddDialogState({
        ...addDialogState,
        error: "Selected connection is no longer available.",
      });
      return;
    }

    const selectedTarget = props.availableTargets.find(
      (target) => target.targetKey === selectedConnection.targetKey,
    );

    void props
      .onAddIntegrationBindingRow({
        kind: addDialogState.kind,
        connectionId: selectedConnection.id,
        config: createDefaultBindingConfig({
          connection: selectedConnection,
          ...(selectedTarget === undefined ? {} : { target: selectedTarget }),
        }),
      })
      .then((didSave) => {
        if (didSave) {
          closeAddDialog();
          return;
        }
        setAddDialogState((currentState) => {
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
    <Card>
      <CardContent className="gap-4 flex flex-col pt-4">
        <div className="gap-1 flex flex-col">
          <h2 className="text-lg font-semibold">Integrations</h2>
          <p className="text-muted-foreground text-sm">
            Assign integration connections for this sandbox profile.
          </p>
        </div>
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
          <div className="gap-3 flex flex-col" key={kind}>
            <div className="items-center gap-3 flex">
              <h3 className="text-sm font-semibold tracking-wide uppercase">
                {formatBindingSectionTitle(kind)}
              </h3>
              <div className="bg-border h-px flex-1" />
              <Button
                disabled={
                  props.integrationDirectoryQuery.isPending ||
                  availableConnectionsByKind[kind].length === 0
                }
                onClick={() => {
                  openAddDialog(kind);
                }}
                type="button"
                variant="outline"
              >
                <PlusIcon />
                Add
              </Button>
            </div>

            {integrationRowsByKind[kind].length === 0 ? (
              <p className="text-muted-foreground text-sm">No bindings configured.</p>
            ) : null}

            {integrationRowsByKind[kind].map((row, rowIndex) => (
              <div className="gap-3 rounded-md border p-3 flex flex-col" key={row.clientId}>
                <div className="flex items-center justify-between">
                  <Label>
                    {formatBindingKind(kind)} Binding {rowIndex + 1}
                  </Label>
                  <Button
                    onClick={() => {
                      props.onRemoveIntegrationBindingRow(row.clientId);
                    }}
                    type="button"
                    variant="outline"
                  >
                    Remove
                  </Button>
                </div>

                <Field>
                  <FieldLabel htmlFor={`binding-connection-${row.clientId}`}>Connection</FieldLabel>
                  <FieldContent>
                    <Select
                      onValueChange={(nextValue) => {
                        if (nextValue === null || nextValue.length === 0) {
                          throw new Error("Binding connection must not be null.");
                        }
                        const selectedConnection = availableConnectionsByKind[row.kind].find(
                          (connection) => connection.id === nextValue,
                        );
                        const selectedTarget =
                          selectedConnection === undefined
                            ? undefined
                            : props.availableTargets.find(
                                (target) => target.targetKey === selectedConnection.targetKey,
                              );

                        props.onIntegrationBindingRowChange(row.clientId, {
                          connectionId: nextValue,
                          config: createDefaultBindingConfig({
                            ...(selectedConnection === undefined
                              ? {}
                              : { connection: selectedConnection }),
                            ...(selectedTarget === undefined ? {} : { target: selectedTarget }),
                          }),
                        });
                      }}
                      value={row.connectionId}
                    >
                      <SelectTrigger
                        aria-label="Binding connection"
                        id={`binding-connection-${row.clientId}`}
                      >
                        <SelectValue placeholder="Select integration connection">
                          {props.resolveSelectedConnectionDisplayName(row)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {availableConnectionsByKind[row.kind].map((connection) => (
                          <SelectItem key={connection.id} value={connection.id}>
                            {formatConnectionDisplayName({
                              connection,
                              targets: props.availableTargets,
                            })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel>Config</FieldLabel>
                  <FieldContent>
                    <SandboxProfileBindingConfigEditor
                      availableConnections={props.availableConnections}
                      availableTargets={props.availableTargets}
                      onIntegrationBindingRowChange={props.onIntegrationBindingRowChange}
                      row={row}
                    />
                  </FieldContent>
                </Field>

                {props.integrationRowErrorsByClientId[row.clientId] !== undefined ? (
                  <p className="text-destructive text-sm">
                    {props.integrationRowErrorsByClientId[row.clientId]}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ))}

        <Dialog
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              closeAddDialog();
            }
          }}
          open={addDialogState !== null}
        >
          {addDialogState ? (
            <DialogContent>
              <DialogHeader variant="sectioned">
                <DialogTitle>Add {formatBindingKind(addDialogState.kind)} binding</DialogTitle>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="add-binding-connection">Connection</FieldLabel>
                <FieldContent>
                  <Select
                    onValueChange={(nextValue) => {
                      if (nextValue === null) {
                        throw new Error("Binding connection must not be null.");
                      }
                      updateAddDialogConnectionId(nextValue);
                    }}
                    value={addDialogState.connectionId}
                  >
                    <SelectTrigger aria-label="Add binding connection" id="add-binding-connection">
                      <SelectValue placeholder="Select integration connection" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableConnectionsByKind[addDialogState.kind].map((connection) => (
                        <SelectItem key={connection.id} value={connection.id}>
                          {formatConnectionDisplayName({
                            connection,
                            targets: props.availableTargets,
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              {addDialogState.error ? (
                <p className="text-destructive text-sm">{addDialogState.error}</p>
              ) : null}
              <DialogFooter>
                <Button onClick={closeAddDialog} type="button" variant="outline">
                  Cancel
                </Button>
                <Button
                  disabled={availableConnectionsByKind[addDialogState.kind].length === 0}
                  onClick={addBindingFromDialog}
                  type="button"
                >
                  <PlusIcon />
                  Add binding
                </Button>
              </DialogFooter>
            </DialogContent>
          ) : null}
        </Dialog>

        <div className="gap-2 flex">
          {props.isSavingIntegrationBindings ? (
            <p className="text-muted-foreground text-sm self-center">Saving...</p>
          ) : null}
          {props.integrationSaveSuccess ? (
            <p className="text-muted-foreground text-sm self-center">Saved.</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
          <SandboxProfileTitleEditor
            draftValue={metaState.profileNameDraft}
            isEditing={metaState.isEditingProfileName}
            onCancel={metaState.onProfileNameEditCancel}
            onCommit={metaState.onProfileNameEditCommit}
            onDraftValueChange={metaState.onProfileNameDraftChange}
            onEditStart={metaState.onProfileNameEditStart}
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
