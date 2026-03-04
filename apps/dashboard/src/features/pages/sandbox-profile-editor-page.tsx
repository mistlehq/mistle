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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { z } from "zod";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { formatSandboxProfileVersionLabel } from "../sandbox-profiles/format-sandbox-profile-version-label.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  formatSandboxProfileStatus,
  isSandboxProfileStatus,
  SANDBOX_PROFILE_STATUS_OPTIONS,
} from "../sandbox-profiles/sandbox-profiles-formatters.js";
import {
  sandboxProfileDetailQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionsQueryKey,
  SANDBOX_PROFILES_QUERY_KEY_PREFIX,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  createSandboxProfile,
  getSandboxProfileVersionIntegrationBindings,
  getSandboxProfile,
  listSandboxProfileVersions,
  putSandboxProfileVersionIntegrationBindings,
  updateSandboxProfile,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type {
  SandboxIntegrationBindingKind,
  SandboxProfileVersion,
  SandboxProfileStatus,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { SaveActions } from "../settings/save-actions.js";
import {
  createDefaultBindingConfig,
  resolveBindingConfigUiModel,
  resolveBindingKindFromTarget,
  SandboxProfileBindingConfigEditor,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { resolveProfileNameCommitDecision } from "./sandbox-profile-title-edit.js";
import { SandboxProfileTitleEditor } from "./sandbox-profile-title-editor.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

type SandboxProfileEditorFormState = {
  displayName: string;
  status: SandboxProfileStatus;
};

type InvalidBindingConfigIssue = {
  clientRef?: string | undefined;
  bindingIdOrDraftIndex: string;
  validatorCode: string;
  field: string;
  safeMessage: string;
};

const InvalidBindingConfigReferenceErrorSchema = z
  .object({
    code: z.literal("INVALID_BINDING_CONFIG_REFERENCE"),
    details: z
      .object({
        issues: z.array(
          z
            .object({
              clientRef: z.string().min(1).optional(),
              bindingIdOrDraftIndex: z.string().min(1),
              validatorCode: z.string().min(1),
              field: z.string().min(1),
              safeMessage: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

let nextIntegrationBindingClientId = 1;

function createIntegrationBindingClientId(): string {
  const clientId = `binding-${String(nextIntegrationBindingClientId)}`;
  nextIntegrationBindingClientId += 1;
  return clientId;
}

function formatBindingKind(kind: SandboxIntegrationBindingKind): string {
  if (kind === "agent") {
    return "Agent";
  }
  if (kind === "git") {
    return "Git";
  }
  return "Connector";
}

function readInvalidBindingConfigIssues(
  error: unknown,
): readonly InvalidBindingConfigIssue[] | null {
  if (!(error instanceof SandboxProfilesApiError)) {
    return null;
  }
  const parsed = InvalidBindingConfigReferenceErrorSchema.safeParse(error.body);
  if (!parsed.success) {
    return null;
  }
  return parsed.data.details.issues;
}

function parseStatusValue(value: string | null): SandboxProfileStatus {
  if (value === null) {
    throw new Error("Sandbox profile status must not be null.");
  }

  if (isSandboxProfileStatus(value)) {
    return value;
  }

  throw new Error(`Unsupported sandbox profile status: ${value}`);
}

type IntegrationsEditorSectionProps = {
  profileVersionsQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
    data: { versions: SandboxProfileVersion[] } | undefined;
  };
  resolvedSelectedVersion: number | null;
  onSelectedVersionChange: (nextValue: string | null) => void;
  selectedVersionDisplayName: string | undefined;
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
  onAddIntegrationBindingRow: () => void;
  onSaveIntegrationBindings: () => void;
  isSavingIntegrationBindings: boolean;
  integrationSaveSuccess: boolean;
};

function IntegrationsEditorSection(props: IntegrationsEditorSectionProps): React.JSX.Element {
  return (
    <Card>
      <CardContent className="gap-4 flex flex-col pt-4">
        <div className="gap-1 flex flex-col">
          <h2 className="text-lg font-semibold">Integrations</h2>
          <p className="text-muted-foreground text-sm">
            Assign integration connections for a specific sandbox profile version.
          </p>
        </div>

        {props.profileVersionsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load sandbox profile versions</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: props.profileVersionsQuery.error,
                fallbackMessage: "Could not load sandbox profile versions.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}

        <Field>
          <FieldLabel htmlFor="sandbox-profile-version">Profile version</FieldLabel>
          <FieldContent>
            <Select
              disabled={
                props.profileVersionsQuery.isPending ||
                props.profileVersionsQuery.data === undefined
              }
              onValueChange={props.onSelectedVersionChange}
              value={
                props.resolvedSelectedVersion === null
                  ? undefined
                  : String(props.resolvedSelectedVersion)
              }
            >
              <SelectTrigger aria-label="Sandbox profile version" id="sandbox-profile-version">
                <SelectValue placeholder="Select profile version">
                  {props.selectedVersionDisplayName}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(props.profileVersionsQuery.data?.versions ?? []).map((version) => (
                  <SelectItem key={version.version} value={String(version.version)}>
                    {formatSandboxProfileVersionLabel(version.version)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>

        {props.resolvedSelectedVersion === null ? null : props.integrationBindingsQuery.isError ? (
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

        {props.integrationRows.map((row, rowIndex) => (
          <div className="gap-3 rounded-md border p-3 flex flex-col" key={row.clientId}>
            <div className="flex items-center justify-between">
              <Label>Binding {rowIndex + 1}</Label>
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
              <FieldLabel>Kind</FieldLabel>
              <FieldContent>
                <p className="text-muted-foreground text-sm">{formatBindingKind(row.kind)}</p>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor={`binding-connection-${row.clientId}`}>Connection</FieldLabel>
              <FieldContent>
                <Select
                  onValueChange={(nextValue) => {
                    if (nextValue === null) {
                      throw new Error("Binding connection must not be null.");
                    }
                    const selectedConnection = props.availableConnections.find(
                      (connection) => connection.id === nextValue,
                    );
                    const selectedTarget =
                      selectedConnection === undefined
                        ? undefined
                        : props.availableTargets.find(
                            (target) => target.targetKey === selectedConnection.targetKey,
                          );
                    const resolvedKind = resolveBindingKindFromTarget(selectedTarget);
                    props.onIntegrationBindingRowChange(row.clientId, {
                      connectionId: nextValue,
                      ...(resolvedKind === undefined ? {} : { kind: resolvedKind }),
                      config: createDefaultBindingConfig({
                        ...(selectedConnection === undefined
                          ? {}
                          : { connection: selectedConnection }),
                        ...(selectedTarget === undefined ? {} : { target: selectedTarget }),
                      }),
                    });
                  }}
                  value={row.connectionId === "" ? undefined : row.connectionId}
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
                    {props.availableConnections.map((connection) => (
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

        <div className="gap-2 flex">
          <Button onClick={props.onAddIntegrationBindingRow} type="button" variant="outline">
            Add binding
          </Button>
          <Button
            disabled={
              props.resolvedSelectedVersion === null ||
              props.integrationBindingsQuery.isPending ||
              props.integrationDirectoryQuery.isPending ||
              props.isSavingIntegrationBindings
            }
            onClick={props.onSaveIntegrationBindings}
            type="button"
          >
            {props.isSavingIntegrationBindings ? "Saving..." : "Save integrations"}
          </Button>
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

  const [formState, setFormState] = useState<SandboxProfileEditorFormState>({
    displayName: "",
    status: "active",
  });
  const [persistedFormState, setPersistedFormState] = useState<SandboxProfileEditorFormState>({
    displayName: "",
    status: "active",
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [explicitSelectedVersion, setExplicitSelectedVersion] = useState<number | null>(null);
  const [integrationRows, setIntegrationRows] = useState<SandboxProfileBindingEditorRow[]>([]);
  const [integrationSaveError, setIntegrationSaveError] = useState<string | null>(null);
  const [integrationRowErrorsByClientId, setIntegrationRowErrorsByClientId] = useState<
    Record<string, string>
  >({});
  const [integrationSaveSuccess, setIntegrationSaveSuccess] = useState(false);

  function resetIntegrationSaveState(): void {
    markIntegrationDirty();
  }

  function clearIntegrationRowError(clientId: string): void {
    setIntegrationRowErrorsByClientId((currentErrors) => {
      if (currentErrors[clientId] === undefined) {
        return currentErrors;
      }
      const nextErrors: Record<string, string> = {};
      for (const [key, value] of Object.entries(currentErrors)) {
        if (key !== clientId) {
          nextErrors[key] = value;
        }
      }
      return nextErrors;
    });
  }

  function markIntegrationDirty(input?: { clientId: string }): void {
    setIntegrationSaveError(null);
    if (input === undefined) {
      setIntegrationRowErrorsByClientId({});
    } else {
      clearIntegrationRowError(input.clientId);
    }
    setIntegrationSaveSuccess(false);
  }

  function setIntegrationSaveFailure(message: string): void {
    setIntegrationSaveError(message);
    setIntegrationSaveSuccess(false);
  }

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

  const profileVersionsQuery = useQuery({
    queryKey:
      props.mode === "edit" && profileId !== undefined
        ? sandboxProfileVersionsQueryKey(profileId)
        : sandboxProfileVersionsQueryKey("missing-profile-id"),
    queryFn: async ({ signal }) => {
      if (profileId === undefined) {
        throw new Error("profileId is required.");
      }
      return listSandboxProfileVersions({
        profileId,
        signal,
      });
    },
    enabled: props.mode === "edit",
    retry: false,
  });

  const integrationDirectoryQuery = useQuery({
    queryKey: ["sandbox-profiles", "integration-directory"],
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    enabled: props.mode === "edit",
  });

  const availableProfileVersions: readonly SandboxProfileVersion[] =
    profileVersionsQuery.data?.versions ?? [];
  const resolvedSelectedVersion =
    explicitSelectedVersion !== null &&
    availableProfileVersions.some((version) => version.version === explicitSelectedVersion)
      ? explicitSelectedVersion
      : (availableProfileVersions[0]?.version ?? null);

  const integrationBindingsQuery = useQuery({
    queryKey:
      props.mode === "edit" && profileId !== undefined && resolvedSelectedVersion !== null
        ? sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId,
            version: resolvedSelectedVersion,
          })
        : sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: "missing-profile-id",
            version: 0,
          }),
    queryFn: async ({ signal }) => {
      if (profileId === undefined || resolvedSelectedVersion === null) {
        throw new Error("profileId and selectedVersion are required.");
      }
      return getSandboxProfileVersionIntegrationBindings({
        profileId,
        version: resolvedSelectedVersion,
        signal,
      });
    },
    enabled: props.mode === "edit" && profileId !== undefined && resolvedSelectedVersion !== null,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async (input: SandboxProfileEditorFormState) =>
      createSandboxProfile({
        payload: {
          displayName: input.displayName,
          status: input.status,
        },
      }),
    onSuccess: async (createdProfile) => {
      setSaveError(null);
      await queryClient.invalidateQueries({
        queryKey: SANDBOX_PROFILES_QUERY_KEY_PREFIX,
      });
      await navigate(`/sandbox-profiles/${createdProfile.id}`);
    },
    onError: (error: unknown) => {
      setSaveError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create sandbox profile.",
        }),
      );
      setSaveSuccess(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: {
      profileId: string;
      changes: Partial<SandboxProfileEditorFormState>;
    }) =>
      updateSandboxProfile({
        payload: {
          profileId: input.profileId,
          ...(input.changes.displayName === undefined
            ? {}
            : { displayName: input.changes.displayName }),
          ...(input.changes.status === undefined ? {} : { status: input.changes.status }),
        },
      }),
    onSuccess: async (updatedProfile, variables) => {
      setFormState((currentState) => ({
        ...currentState,
        ...(variables.changes.displayName === undefined
          ? {}
          : { displayName: updatedProfile.displayName }),
        ...(variables.changes.status === undefined ? {} : { status: updatedProfile.status }),
      }));
      setPersistedFormState((currentState) => ({
        ...currentState,
        ...(variables.changes.displayName === undefined
          ? {}
          : { displayName: updatedProfile.displayName }),
        ...(variables.changes.status === undefined ? {} : { status: updatedProfile.status }),
      }));
      setProfileNameDraft(updatedProfile.displayName);
      setSaveError(null);
      setSaveSuccess(true);

      await queryClient.invalidateQueries({
        queryKey: SANDBOX_PROFILES_QUERY_KEY_PREFIX,
      });
      await queryClient.invalidateQueries({
        queryKey: sandboxProfileDetailQueryKey(updatedProfile.id),
      });
    },
    onError: (error: unknown) => {
      setSaveError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update sandbox profile.",
        }),
      );
      setSaveSuccess(false);
    },
  });

  const putIntegrationBindingsMutation = useMutation({
    mutationFn: async (input: {
      profileId: string;
      version: number;
      bindings: Array<{
        id?: string;
        clientRef: string;
        connectionId: string;
        kind: SandboxIntegrationBindingKind;
        config: Record<string, unknown>;
      }>;
    }) =>
      putSandboxProfileVersionIntegrationBindings({
        profileId: input.profileId,
        version: input.version,
        bindings: input.bindings,
      }),
    onSuccess: async (updatedBindings) => {
      const nextRows = updatedBindings.bindings.map((binding) => ({
        clientId: createIntegrationBindingClientId(),
        id: binding.id,
        connectionId: binding.connectionId,
        kind: binding.kind,
        config: binding.config,
      }));
      setIntegrationRows(nextRows);
      setIntegrationSaveError(null);
      setIntegrationRowErrorsByClientId({});
      setIntegrationSaveSuccess(true);

      if (profileId !== undefined && resolvedSelectedVersion !== null) {
        await queryClient.invalidateQueries({
          queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId,
            version: resolvedSelectedVersion,
          }),
        });
      }
    },
    onError: (error: unknown) => {
      const issues = readInvalidBindingConfigIssues(error);
      if (issues !== null) {
        const rowErrors: Record<string, string> = {};
        const rowsByPersistedId = new Map<string, SandboxProfileBindingEditorRow>();
        for (const row of integrationRows) {
          if (row.id !== undefined) {
            rowsByPersistedId.set(row.id, row);
          }
        }

        for (const issue of issues) {
          const clientId =
            issue.clientRef ?? rowsByPersistedId.get(issue.bindingIdOrDraftIndex)?.clientId;
          if (clientId === undefined) {
            continue;
          }
          if (rowErrors[clientId] !== undefined) {
            continue;
          }
          rowErrors[clientId] = issue.safeMessage;
        }
        setIntegrationRowErrorsByClientId(rowErrors);
      } else {
        setIntegrationRowErrorsByClientId({});
      }
      setIntegrationSaveError(
        issues?.[0]?.safeMessage ??
          resolveApiErrorMessage({
            error,
            fallbackMessage: "Could not save sandbox profile integrations.",
          }),
      );
      setIntegrationSaveSuccess(false);
    },
  });

  useEffect(() => {
    if (props.mode !== "edit") {
      return;
    }

    if (!profileQuery.data) {
      return;
    }

    const loadedState: SandboxProfileEditorFormState = {
      displayName: profileQuery.data.displayName,
      status: profileQuery.data.status,
    };

    setFormState(loadedState);
    setPersistedFormState(loadedState);
    setProfileNameDraft(loadedState.displayName);
  }, [profileQuery.data, props.mode]);

  useEffect(() => {
    const bindings = integrationBindingsQuery.data?.bindings;
    if (bindings === undefined) {
      return;
    }

    const nextRows = bindings.map((binding) => ({
      clientId: createIntegrationBindingClientId(),
      id: binding.id,
      connectionId: binding.connectionId,
      kind: binding.kind,
      config: binding.config,
    }));

    setIntegrationRows(nextRows);
    resetIntegrationSaveState();
  }, [integrationBindingsQuery.data]);

  const trimmedDisplayName = formState.displayName.trim();
  const editTitleProfileName =
    trimmedDisplayName.length > 0 ? trimmedDisplayName : (profileId ?? "Profile");
  const pageTitle = props.mode === "create" ? "Create Profile" : editTitleProfileName;
  const isDisplayNameInvalid = trimmedDisplayName.length === 0;
  const hasEditChanges =
    trimmedDisplayName !== persistedFormState.displayName.trim() ||
    formState.status !== persistedFormState.status;
  const availableConnections: readonly IntegrationConnectionSummary[] =
    integrationDirectoryQuery.data?.connections ?? [];
  const availableTargets: readonly IntegrationTargetSummary[] =
    integrationDirectoryQuery.data?.targets ?? [];
  const canEditIntegrations = props.mode === "edit" && profileId !== undefined;

  function handleDisplayNameChange(nextValue: string): void {
    setFormState((currentState) => ({
      ...currentState,
      displayName: nextValue,
    }));
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleProfileNameEditStart(): void {
    setProfileNameDraft(formState.displayName);
    setIsEditingProfileName(true);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleProfileNameDraftChange(nextValue: string): void {
    setProfileNameDraft(nextValue);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleProfileNameEditCancel(): void {
    setProfileNameDraft(formState.displayName);
    setIsEditingProfileName(false);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleProfileNameEditCommit(): void {
    if (props.mode !== "edit" || profileId === undefined || updateMutation.isPending) {
      setIsEditingProfileName(false);
      return;
    }
    const decision = resolveProfileNameCommitDecision({
      draftDisplayName: profileNameDraft,
      persistedDisplayName: persistedFormState.displayName,
    });
    setIsEditingProfileName(false);
    if (decision.action === "revert") {
      setProfileNameDraft(persistedFormState.displayName);
      return;
    }
    setFormState((currentState) => ({
      ...currentState,
      displayName: decision.displayName,
    }));
    if (decision.action === "noop") {
      return;
    }

    updateMutation.mutate({
      profileId,
      changes: {
        displayName: decision.displayName,
      },
    });
  }

  function handleStatusChange(nextValue: string | null): void {
    const nextStatus = parseStatusValue(nextValue);
    setFormState((currentState) => ({
      ...currentState,
      status: nextStatus,
    }));
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleCancel(): void {
    if (props.mode === "create") {
      void navigate("/sandbox-profiles");
      return;
    }

    setFormState(persistedFormState);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleCreate(): void {
    if (isDisplayNameInvalid || createMutation.isPending) {
      return;
    }

    createMutation.mutate({
      displayName: trimmedDisplayName,
      status: formState.status,
    });
  }

  function handleSave(): void {
    if (
      props.mode !== "edit" ||
      profileId === undefined ||
      !hasEditChanges ||
      isDisplayNameInvalid ||
      updateMutation.isPending
    ) {
      return;
    }

    updateMutation.mutate({
      profileId,
      changes: {
        ...(trimmedDisplayName === persistedFormState.displayName.trim()
          ? {}
          : { displayName: trimmedDisplayName }),
        ...(formState.status === persistedFormState.status ? {} : { status: formState.status }),
      },
    });
  }

  function handleSelectedVersionChange(nextValue: string | null): void {
    if (nextValue === null) {
      throw new Error("Sandbox profile version must not be null.");
    }
    const parsed = Number(nextValue);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Unsupported sandbox profile version: ${nextValue}`);
    }
    setExplicitSelectedVersion(parsed);
    resetIntegrationSaveState();
  }

  function resolveSelectedVersionDisplayName(): string | undefined {
    if (resolvedSelectedVersion === null) {
      return undefined;
    }
    const explicitSelectedVersionSummary = availableProfileVersions.find(
      (version) => version.version === resolvedSelectedVersion,
    );
    if (explicitSelectedVersionSummary === undefined) {
      return undefined;
    }
    return formatSandboxProfileVersionLabel(explicitSelectedVersionSummary.version);
  }

  function handleAddIntegrationBindingRow(): void {
    setIntegrationRows((currentRows) => [
      ...currentRows,
      {
        clientId: createIntegrationBindingClientId(),
        connectionId: "",
        kind: "agent",
        config: {},
      },
    ]);
    resetIntegrationSaveState();
  }

  function handleRemoveIntegrationBindingRow(clientId: string): void {
    setIntegrationRows((currentRows) => currentRows.filter((row) => row.clientId !== clientId));
    markIntegrationDirty({ clientId });
  }

  function handleIntegrationBindingRowChange(
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ): void {
    setIntegrationRows((currentRows) =>
      currentRows.map((row) => {
        if (row.clientId !== clientId) {
          return row;
        }
        return {
          ...row,
          ...changes,
        };
      }),
    );
    markIntegrationDirty({ clientId });
  }

  function handleSaveIntegrationBindings(): void {
    if (
      props.mode !== "edit" ||
      profileId === undefined ||
      resolvedSelectedVersion === null ||
      putIntegrationBindingsMutation.isPending
    ) {
      return;
    }

    const parsedBindings: Array<{
      id?: string;
      clientRef: string;
      connectionId: string;
      kind: SandboxIntegrationBindingKind;
      config: Record<string, unknown>;
    }> = [];

    for (const row of integrationRows) {
      const normalizedConnectionId = row.connectionId.trim();
      if (normalizedConnectionId.length === 0) {
        setIntegrationSaveFailure("Each integration binding must select a connection.");
        return;
      }

      const configUiModel = resolveBindingConfigUiModel({
        row,
        connections: availableConnections,
        targets: availableTargets,
      });
      if (configUiModel.mode === "missing-connection") {
        setIntegrationSaveFailure("Each integration binding must select a connection.");
        return;
      }
      if (configUiModel.mode === "unsupported") {
        setIntegrationSaveFailure(configUiModel.message);
        return;
      }

      const config = configUiModel.mode === "editor" ? configUiModel.value : {};

      parsedBindings.push({
        ...(row.id === undefined ? {} : { id: row.id }),
        clientRef: row.clientId,
        connectionId: normalizedConnectionId,
        kind: row.kind,
        config,
      });
    }

    putIntegrationBindingsMutation.mutate({
      profileId,
      version: resolvedSelectedVersion,
      bindings: parsedBindings,
    });
  }

  function resolveSelectedConnectionDisplayName(
    row: SandboxProfileBindingEditorRow,
  ): string | undefined {
    if (row.connectionId === "") {
      return undefined;
    }
    const selectedConnection = availableConnections.find(
      (connection) => connection.id === row.connectionId,
    );
    if (selectedConnection === undefined) {
      return undefined;
    }
    return formatConnectionDisplayName({
      connection: selectedConnection,
      targets: availableTargets,
    });
  }

  if (props.mode === "edit" && profileQuery.isPending) {
    return (
      <div className="gap-4 flex flex-col">
        <h1 className="text-xl font-semibold">{pageTitle}</h1>
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
        <h1 className="text-xl font-semibold">{pageTitle}</h1>
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
      {props.mode === "create" ? (
        <h1 className="text-xl font-semibold">{pageTitle}</h1>
      ) : (
        <SandboxProfileTitleEditor
          draftValue={profileNameDraft}
          isEditing={isEditingProfileName}
          onCancel={handleProfileNameEditCancel}
          onCommit={handleProfileNameEditCommit}
          onDraftValueChange={handleProfileNameDraftChange}
          onEditStart={handleProfileNameEditStart}
          saveDisabled={updateMutation.isPending}
          title={pageTitle}
        />
      )}
      <Card>
        <CardContent className="gap-4 flex flex-col pt-4">
          {saveError ? (
            <Alert variant="destructive">
              <AlertTitle>{props.mode === "create" ? "Create failed" : "Update failed"}</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

          {props.mode === "create" ? (
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
                    handleDisplayNameChange(event.currentTarget.value);
                  }}
                  value={formState.displayName}
                />
              </FieldContent>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="sandbox-profile-status">Status</FieldLabel>
            <FieldContent>
              <Select onValueChange={handleStatusChange} value={formState.status}>
                <SelectTrigger aria-label="Sandbox profile status" id="sandbox-profile-status">
                  <SelectValue placeholder="Select status">
                    {formatSandboxProfileStatus(formState.status)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SANDBOX_PROFILE_STATUS_OPTIONS.map((statusOption) => (
                    <SelectItem key={statusOption} value={statusOption}>
                      {formatSandboxProfileStatus(statusOption)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldContent>
          </Field>

          {props.mode === "create" ? (
            <div className="gap-2 flex">
              <Button
                disabled={isDisplayNameInvalid || createMutation.isPending}
                onClick={handleCreate}
                type="button"
              >
                {createMutation.isPending ? "Creating..." : "Create profile"}
              </Button>
              <Button onClick={handleCancel} type="button" variant="outline">
                Cancel
              </Button>
            </div>
          ) : (
            <SaveActions
              cancelDisabled={!hasEditChanges || updateMutation.isPending}
              onCancel={handleCancel}
              onSave={handleSave}
              saveDisabled={!hasEditChanges || isDisplayNameInvalid || updateMutation.isPending}
              saveSuccess={saveSuccess}
              saving={updateMutation.isPending}
            />
          )}
        </CardContent>
      </Card>

      {canEditIntegrations ? (
        <IntegrationsEditorSection
          availableConnections={availableConnections}
          availableTargets={availableTargets}
          integrationBindingsQuery={{
            isError: integrationBindingsQuery.isError,
            error: integrationBindingsQuery.error,
            isPending: integrationBindingsQuery.isPending,
          }}
          integrationDirectoryQuery={{
            isError: integrationDirectoryQuery.isError,
            error: integrationDirectoryQuery.error,
            isPending: integrationDirectoryQuery.isPending,
          }}
          integrationRowErrorsByClientId={integrationRowErrorsByClientId}
          integrationRows={integrationRows}
          integrationSaveError={integrationSaveError}
          integrationSaveSuccess={integrationSaveSuccess}
          isSavingIntegrationBindings={putIntegrationBindingsMutation.isPending}
          onAddIntegrationBindingRow={handleAddIntegrationBindingRow}
          onIntegrationBindingRowChange={handleIntegrationBindingRowChange}
          onRemoveIntegrationBindingRow={handleRemoveIntegrationBindingRow}
          onSaveIntegrationBindings={handleSaveIntegrationBindings}
          onSelectedVersionChange={handleSelectedVersionChange}
          profileVersionsQuery={{
            isError: profileVersionsQuery.isError,
            error: profileVersionsQuery.error,
            isPending: profileVersionsQuery.isPending,
            data: profileVersionsQuery.data,
          }}
          resolveSelectedConnectionDisplayName={resolveSelectedConnectionDisplayName}
          resolvedSelectedVersion={resolvedSelectedVersion}
          selectedVersionDisplayName={resolveSelectedVersionDisplayName()}
        />
      ) : null}
    </div>
  );
}
