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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@mistle/ui";
import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  IntegrationHorizontalFieldGroupClassName,
  IntegrationHorizontalFieldLayoutClassName,
  IntegrationSelectContentClassName,
} from "../forms/integration-form-theme.js";
import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfile } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SectionHeader } from "../shared/section-header.js";
import {
  createDefaultBindingConfig,
  resolveBindingConfigUiModel,
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

type IntegrationDialogState = {
  mode: "add" | "edit";
  row: SandboxProfileBindingEditorRow;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePropertyTitle(input: {
  schema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
  propertyKey: string;
}): string {
  const propertyUiSchema = input.uiSchema[input.propertyKey];
  if (isRecord(propertyUiSchema)) {
    const uiTitle = propertyUiSchema["ui:title"];
    if (typeof uiTitle === "string" && uiTitle.length > 0) {
      return uiTitle;
    }
  }

  const properties = input.schema.properties;
  if (isRecord(properties)) {
    const propertySchema = properties[input.propertyKey];
    if (isRecord(propertySchema)) {
      const title = propertySchema.title;
      if (typeof title === "string" && title.length > 0) {
        return title;
      }
    }
  }

  return input.propertyKey;
}

function resolveScalarSummaryValue(input: {
  schema: Record<string, unknown>;
  propertyKey: string;
  value: string | number | boolean;
}): string {
  const properties = input.schema.properties;
  if (!isRecord(properties)) {
    return String(input.value);
  }

  const propertySchema = properties[input.propertyKey];
  if (!isRecord(propertySchema) || !Array.isArray(propertySchema.oneOf)) {
    return String(input.value);
  }

  for (const option of propertySchema.oneOf) {
    if (!isRecord(option)) {
      continue;
    }

    if (option.const === input.value && typeof option.title === "string") {
      return option.title;
    }
  }

  return String(input.value);
}

function resolveBindingSummaryItems(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): Array<{ label: string; value: string }> {
  const items: Array<{ label: string; value: string }> = [];

  const configUiModel = resolveBindingConfigUiModel({
    row: input.row,
    connections: input.availableConnections,
    targets: input.availableTargets,
  });

  if (configUiModel.mode === "form") {
    for (const propertyKey of configUiModel.visiblePropertyKeys.slice(0, 2)) {
      const value = configUiModel.value[propertyKey];
      const label = resolvePropertyTitle({
        schema: configUiModel.schema,
        uiSchema: configUiModel.uiSchema,
        propertyKey,
      });

      if (Array.isArray(value)) {
        items.push({
          label,
          value:
            value.length === 0
              ? "None"
              : value.filter((entry): entry is string => typeof entry === "string").join(", "),
        });
        continue;
      }

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        items.push({
          label,
          value: resolveScalarSummaryValue({
            schema: configUiModel.schema,
            propertyKey,
            value,
          }),
        });
      }
    }
    return items;
  }

  if (configUiModel.mode === "no-config") {
    items.push({
      label: "Config",
      value: "No additional config required.",
    });
    return items;
  }

  if (configUiModel.mode === "unsupported") {
    items.push({
      label: "Config",
      value: configUiModel.message,
    });
    return items;
  }

  items.push({
    label: "Config",
    value: "Connection not selected.",
  });
  return items;
}

function resolveRowBindingMetadata(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): {
  connection: IntegrationConnectionSummary;
  target: IntegrationTargetSummary | undefined;
} | null {
  const connection = input.availableConnections.find(
    (candidate) => candidate.id === input.row.connectionId,
  );
  if (connection === undefined) {
    return null;
  }

  return {
    connection,
    target: input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    ),
  };
}

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
    useState<IntegrationDialogState | null>(null);

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
        <div className="gap-3 flex flex-col" key={kind}>
          <SectionHeader
            action={
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
            }
            title={formatBindingSectionTitle(kind)}
          />

          {integrationRowsByKind[kind].length === 0 ? (
            <p className="text-muted-foreground text-sm">No bindings configured.</p>
          ) : null}

          {integrationRowsByKind[kind].map((row) => {
            const rowMetadata = resolveRowBindingMetadata({
              row,
              availableConnections: props.availableConnections,
              availableTargets: props.availableTargets,
            });
            const target = rowMetadata?.target;
            const summaryItems = resolveBindingSummaryItems({
              row,
              availableConnections: props.availableConnections,
              availableTargets: props.availableTargets,
            });
            const connectionDisplayName =
              rowMetadata === null
                ? undefined
                : formatConnectionDisplayName({
                    connection: rowMetadata.connection,
                  });

            return (
              <div className="gap-4 rounded-md border p-4 flex flex-col" key={row.clientId}>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex items-center gap-2">
                    {target?.logoKey ? (
                      <img
                        alt={`${target.displayName} logo`}
                        className="h-5 w-5 rounded-sm"
                        src={resolveIntegrationLogoPath({ logoKey: target.logoKey })}
                      />
                    ) : (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold">
                        {(target?.displayName ?? "I").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 gap-0.5 flex flex-col">
                      <p className="truncate text-sm font-medium">
                        {target?.displayName ?? "Integration"}
                      </p>
                      {connectionDisplayName === undefined ? null : (
                        <p className="text-muted-foreground truncate text-xs">
                          {connectionDisplayName}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="gap-2 flex">
                    <Button
                      aria-label="Edit binding"
                      onClick={() => {
                        openEditDialog(row);
                      }}
                      size="icon-sm"
                      type="button"
                      variant="outline"
                    >
                      <PencilSimpleIcon aria-hidden className="size-4" />
                    </Button>
                    <Button
                      aria-label="Remove binding"
                      onClick={() => {
                        props.onRemoveIntegrationBindingRow(row.clientId);
                      }}
                      size="icon-sm"
                      type="button"
                      variant="outline"
                    >
                      <TrashIcon aria-hidden className="size-4" />
                    </Button>
                  </div>
                </div>

                <dl className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {summaryItems.map((item) => (
                    <div className="gap-1 flex flex-col" key={item.label}>
                      <dt className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                        {item.label}
                      </dt>
                      <dd className="text-sm">{item.value}</dd>
                    </div>
                  ))}
                </dl>

                {props.integrationRowErrorsByClientId[row.clientId] !== undefined ? (
                  <p className="text-destructive text-sm">
                    {props.integrationRowErrorsByClientId[row.clientId]}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}

      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeIntegrationDialog();
          }
        }}
        open={integrationDialogState !== null}
      >
        {integrationDialogState ? (
          <DialogContent>
            <DialogHeader variant="sectioned">
              <DialogTitle>
                {integrationDialogState.mode === "add" ? "Add binding" : "Edit binding"}
              </DialogTitle>
            </DialogHeader>
            <div className={IntegrationHorizontalFieldGroupClassName}>
              <Field className={IntegrationHorizontalFieldLayoutClassName} orientation="horizontal">
                <FieldLabel htmlFor="add-binding-connection">Connection</FieldLabel>
                <FieldContent>
                  <Select
                    onValueChange={(nextValue) => {
                      if (nextValue === null) {
                        throw new Error("Binding connection must not be null.");
                      }
                      updateDialogConnectionId(nextValue);
                    }}
                    value={integrationDialogState.row.connectionId}
                  >
                    <SelectTrigger
                      aria-label="Add binding connection"
                      className="w-full"
                      id="add-binding-connection"
                    >
                      <SelectValue placeholder="Select integration connection">
                        {props.resolveSelectedConnectionDisplayName(integrationDialogState.row)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className={IntegrationSelectContentClassName}>
                      {availableConnectionsByKind[integrationDialogState.row.kind].map(
                        (connection) => (
                          <SelectItem key={connection.id} value={connection.id}>
                            {formatConnectionDisplayName({ connection })}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <SandboxProfileBindingConfigEditor
                availableConnections={props.availableConnections}
                availableTargets={props.availableTargets}
                layout="horizontal"
                onIntegrationBindingRowChange={updateDialogRow}
                row={integrationDialogState.row}
              />
              {integrationDialogState.error ? (
                <p className="text-destructive text-sm">{integrationDialogState.error}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button onClick={closeIntegrationDialog} type="button" variant="outline">
                Cancel
              </Button>
              <Button
                disabled={
                  props.isSavingIntegrationBindings ||
                  availableConnectionsByKind[integrationDialogState.row.kind].length === 0
                }
                onClick={saveBindingFromDialog}
                type="button"
              >
                {integrationDialogState.mode === "add" ? <PlusIcon /> : null}
                {integrationDialogState.mode === "add" ? "Add binding" : "Save changes"}
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
