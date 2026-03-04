import {
  buildBindingEditorRenderableFields,
  createDefaultConfigFromBindingEditorVariant,
  parseConfigAgainstBindingEditorVariant,
  parseIntegrationBindingEditorUiProjection,
  resolveBindingEditorVariant,
  type BindingEditorRenderableField,
  type BindingEditorVariant,
  updateBindingEditorConfigByField,
} from "@mistle/integrations-definitions/ui";
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
  SandboxProfileStatus,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { SaveActions } from "../settings/save-actions.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

type SandboxProfileEditorFormState = {
  displayName: string;
  status: SandboxProfileStatus;
};

type IntegrationBindingEditorRow = {
  clientId: string;
  id?: string;
  connectionId: string;
  kind: SandboxIntegrationBindingKind;
  config: Record<string, unknown>;
};

type IntegrationConnectionSummary = {
  id: string;
  targetKey: string;
  status: "active" | "error" | "revoked";
  config?: Record<string, unknown> | undefined;
};

type IntegrationTargetSummary = {
  targetKey: string;
  displayName: string;
  familyId: string;
  variantId: string;
  targetHealth: {
    configStatus: "valid" | "invalid";
  };
  resolvedBindingEditorUi?: Record<string, unknown> | undefined;
};

type BindingConfigUiModel =
  | {
      mode: "missing-connection";
    }
  | {
      mode: "editor";
      variant: BindingEditorVariant;
      value: Record<string, unknown>;
      fields: readonly BindingEditorRenderableField[];
    }
  | {
      mode: "connector";
    }
  | {
      mode: "unsupported";
      message: string;
      defaultConfig?: Record<string, unknown> | undefined;
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

function resolveBindingKindFromTarget(
  target: IntegrationTargetSummary | undefined,
): SandboxIntegrationBindingKind | undefined {
  if (target === undefined) {
    return undefined;
  }
  const projection = parseIntegrationBindingEditorUiProjection(target.resolvedBindingEditorUi);
  return projection?.bindingEditor.kind;
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

function createDefaultBindingConfig(input: {
  connection?: IntegrationConnectionSummary;
  target?: IntegrationTargetSummary;
}): Record<string, unknown> {
  if (input.target === undefined || input.connection === undefined) {
    return {};
  }
  const projection = parseIntegrationBindingEditorUiProjection(
    input.target.resolvedBindingEditorUi,
  );
  if (projection === undefined) {
    return {};
  }
  const resolvedVariant = resolveBindingEditorVariant({
    projection,
    ...(input.connection.config === undefined ? {} : { connectionConfig: input.connection.config }),
  });
  if (!resolvedVariant.ok) {
    return {};
  }
  return createDefaultConfigFromBindingEditorVariant({
    variant: resolvedVariant.variant,
  });
}

function resolveBindingConfigUiModel(input: {
  row: IntegrationBindingEditorRow;
  connections: readonly IntegrationConnectionSummary[];
  targets: readonly IntegrationTargetSummary[];
}): BindingConfigUiModel {
  const connection = input.connections.find((candidate) => candidate.id === input.row.connectionId);
  if (connection === undefined) {
    return {
      mode: "missing-connection",
    };
  }

  const target = input.targets.find((candidate) => candidate.targetKey === connection.targetKey);
  if (target === undefined) {
    return {
      mode: "unsupported",
      message: `Connection '${connection.id}' references unknown target '${connection.targetKey}'.`,
    };
  }

  const projection = parseIntegrationBindingEditorUiProjection(target.resolvedBindingEditorUi);
  if (projection === undefined) {
    return {
      mode: "unsupported",
      message: `Target '${target.familyId}/${target.variantId}' does not define binding editor UI metadata.`,
    };
  }

  if (projection.bindingEditor.kind !== input.row.kind) {
    return {
      mode: "unsupported",
      message: `Binding kind '${input.row.kind}' is not compatible with target '${target.familyId}/${target.variantId}'.`,
    };
  }

  const resolvedVariant = resolveBindingEditorVariant({
    projection,
    ...(connection.config === undefined ? {} : { connectionConfig: connection.config }),
  });
  if (!resolvedVariant.ok) {
    return {
      mode: "unsupported",
      message: resolvedVariant.message,
    };
  }

  const defaultConfig = createDefaultConfigFromBindingEditorVariant({
    variant: resolvedVariant.variant,
  });
  const parsedConfig = parseConfigAgainstBindingEditorVariant({
    config: input.row.config,
    variant: resolvedVariant.variant,
  });
  if (!parsedConfig.ok) {
    return {
      mode: "unsupported",
      message: parsedConfig.message,
      defaultConfig,
    };
  }

  return {
    mode: "editor",
    variant: resolvedVariant.variant,
    value: parsedConfig.value,
    fields: buildBindingEditorRenderableFields({
      variant: resolvedVariant.variant,
      value: parsedConfig.value,
    }),
  };
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
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [integrationRows, setIntegrationRows] = useState<IntegrationBindingEditorRow[]>([]);
  const [integrationSaveError, setIntegrationSaveError] = useState<string | null>(null);
  const [integrationRowErrorsByClientId, setIntegrationRowErrorsByClientId] = useState<
    Record<string, string>
  >({});
  const [integrationSaveSuccess, setIntegrationSaveSuccess] = useState(false);

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

  const integrationBindingsQuery = useQuery({
    queryKey:
      props.mode === "edit" && profileId !== undefined && selectedVersion !== null
        ? sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId,
            version: selectedVersion,
          })
        : sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: "missing-profile-id",
            version: 0,
          }),
    queryFn: async ({ signal }) => {
      if (profileId === undefined || selectedVersion === null) {
        throw new Error("profileId and selectedVersion are required.");
      }
      return getSandboxProfileVersionIntegrationBindings({
        profileId,
        version: selectedVersion,
        signal,
      });
    },
    enabled: props.mode === "edit" && profileId !== undefined && selectedVersion !== null,
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
    mutationFn: async (input: { profileId: string; changes: SandboxProfileEditorFormState }) =>
      updateSandboxProfile({
        payload: {
          profileId: input.profileId,
          displayName: input.changes.displayName,
          status: input.changes.status,
        },
      }),
    onSuccess: async (updatedProfile) => {
      const latestState: SandboxProfileEditorFormState = {
        displayName: updatedProfile.displayName,
        status: updatedProfile.status,
      };

      setFormState(latestState);
      setPersistedFormState(latestState);
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

      if (profileId !== undefined && selectedVersion !== null) {
        await queryClient.invalidateQueries({
          queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId,
            version: selectedVersion,
          }),
        });
      }
    },
    onError: (error: unknown) => {
      const issues = readInvalidBindingConfigIssues(error);
      if (issues !== null) {
        const rowErrors: Record<string, string> = {};
        const rowsByPersistedId = new Map<string, IntegrationBindingEditorRow>();
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
  }, [profileQuery.data, props.mode]);

  useEffect(() => {
    if (props.mode !== "edit") {
      return;
    }

    const versions = profileVersionsQuery.data?.versions ?? [];
    if (versions.length === 0) {
      return;
    }

    if (
      selectedVersion === null ||
      !versions.some((version) => version.version === selectedVersion)
    ) {
      setSelectedVersion(versions[0]?.version ?? null);
      setIntegrationSaveError(null);
      setIntegrationRowErrorsByClientId({});
      setIntegrationSaveSuccess(false);
    }
  }, [profileVersionsQuery.data, props.mode, selectedVersion]);

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
    setIntegrationSaveError(null);
    setIntegrationRowErrorsByClientId({});
    setIntegrationSaveSuccess(false);
  }, [integrationBindingsQuery.data]);

  const trimmedDisplayName = formState.displayName.trim();
  const editTitleProfileName =
    trimmedDisplayName.length > 0 ? trimmedDisplayName : (profileId ?? "Profile");
  const pageTitle =
    props.mode === "create" ? "Create Profile" : `Sandbox Profile: ${editTitleProfileName}`;
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
        displayName: trimmedDisplayName,
        status: formState.status,
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
    setSelectedVersion(parsed);
    setIntegrationSaveError(null);
    setIntegrationRowErrorsByClientId({});
    setIntegrationSaveSuccess(false);
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
    setIntegrationSaveError(null);
    setIntegrationRowErrorsByClientId({});
    setIntegrationSaveSuccess(false);
  }

  function handleRemoveIntegrationBindingRow(clientId: string): void {
    setIntegrationRows((currentRows) => currentRows.filter((row) => row.clientId !== clientId));
    setIntegrationSaveError(null);
    setIntegrationRowErrorsByClientId((currentErrors) => {
      const nextErrors: Record<string, string> = {};
      for (const [key, value] of Object.entries(currentErrors)) {
        if (key !== clientId) {
          nextErrors[key] = value;
        }
      }
      return nextErrors;
    });
    setIntegrationSaveSuccess(false);
  }

  function handleIntegrationBindingRowChange(
    clientId: string,
    changes: Partial<Omit<IntegrationBindingEditorRow, "clientId">>,
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
    setIntegrationSaveError(null);
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
    setIntegrationSaveSuccess(false);
  }

  function handleSaveIntegrationBindings(): void {
    if (
      props.mode !== "edit" ||
      profileId === undefined ||
      selectedVersion === null ||
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
        setIntegrationSaveError("Each integration binding must select a connection.");
        setIntegrationSaveSuccess(false);
        return;
      }

      const configUiModel = resolveBindingConfigUiModel({
        row,
        connections: availableConnections,
        targets: availableTargets,
      });
      if (configUiModel.mode === "missing-connection") {
        setIntegrationSaveError("Each integration binding must select a connection.");
        setIntegrationSaveSuccess(false);
        return;
      }
      if (configUiModel.mode === "unsupported") {
        setIntegrationSaveError(configUiModel.message);
        setIntegrationSaveSuccess(false);
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
      version: selectedVersion,
      bindings: parsedBindings,
    });
  }

  function resolveSelectedConnectionDisplayName(
    row: IntegrationBindingEditorRow,
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

  function renderBindingConfigField(row: IntegrationBindingEditorRow): React.JSX.Element {
    const configUiModel = resolveBindingConfigUiModel({
      row,
      connections: availableConnections,
      targets: availableTargets,
    });

    if (configUiModel.mode === "missing-connection") {
      return (
        <p className="text-muted-foreground text-sm">
          Select a connection to configure this binding.
        </p>
      );
    }

    if (configUiModel.mode === "unsupported") {
      const selectedConnection = availableConnections.find(
        (connection) => connection.id === row.connectionId,
      );
      const selectedTarget =
        selectedConnection === undefined
          ? undefined
          : availableTargets.find((target) => target.targetKey === selectedConnection.targetKey);

      return (
        <div className="gap-2 flex flex-col">
          <Alert variant="destructive">
            <AlertTitle>Unsupported binding config</AlertTitle>
            <AlertDescription>{configUiModel.message}</AlertDescription>
          </Alert>
          <div>
            <Button
              onClick={() => {
                const resolvedKind = resolveBindingKindFromTarget(selectedTarget);
                const resetConfig =
                  configUiModel.defaultConfig ??
                  createDefaultBindingConfig({
                    ...(selectedConnection === undefined ? {} : { connection: selectedConnection }),
                    ...(selectedTarget === undefined ? {} : { target: selectedTarget }),
                  });
                handleIntegrationBindingRowChange(row.clientId, {
                  ...(resolvedKind === undefined ? {} : { kind: resolvedKind }),
                  config: resetConfig,
                });
              }}
              type="button"
              variant="outline"
            >
              Reset config
            </Button>
          </div>
        </div>
      );
    }

    if (configUiModel.mode === "connector") {
      return (
        <p className="text-muted-foreground text-sm">
          Connector bindings currently do not require additional config.
        </p>
      );
    }

    if (configUiModel.mode !== "editor") {
      throw new Error("Unsupported binding config ui mode.");
    }

    return (
      <div className="gap-3 flex flex-col">
        {configUiModel.fields.map((field) => {
          if (field.type === "select") {
            return (
              <Field key={field.key}>
                <FieldLabel htmlFor={`binding-field-${field.key}-${row.clientId}`}>
                  {field.label}
                </FieldLabel>
                <FieldContent>
                  <Select
                    onValueChange={(nextValue) => {
                      if (nextValue === null) {
                        throw new Error(
                          `Binding config value for '${field.key}' must not be null.`,
                        );
                      }
                      if (!field.options.some((option) => option.value === nextValue)) {
                        throw new Error(
                          `Unsupported binding config value '${nextValue}' for field '${field.key}'.`,
                        );
                      }
                      const nextConfig = updateBindingEditorConfigByField({
                        variant: configUiModel.variant,
                        currentConfig: configUiModel.value,
                        fieldKey: field.key,
                        nextValue,
                      });
                      handleIntegrationBindingRowChange(row.clientId, {
                        config: nextConfig,
                      });
                    }}
                    value={field.value}
                  >
                    <SelectTrigger
                      aria-label={field.label}
                      id={`binding-field-${field.key}-${row.clientId}`}
                    >
                      <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
            );
          }

          return (
            <Field key={field.key}>
              <FieldLabel htmlFor={`binding-field-${field.key}-${row.clientId}`}>
                {field.label}
              </FieldLabel>
              <FieldContent>
                <Input
                  id={`binding-field-${field.key}-${row.clientId}`}
                  onChange={(event) => {
                    const values = event.currentTarget.value
                      .split(field.delimiter)
                      .map((entry) => entry.trim())
                      .filter((entry) => entry.length > 0);
                    const nextConfig = updateBindingEditorConfigByField({
                      variant: configUiModel.variant,
                      currentConfig: configUiModel.value,
                      fieldKey: field.key,
                      nextValue: values,
                    });
                    handleIntegrationBindingRowChange(row.clientId, {
                      config: nextConfig,
                    });
                  }}
                  value={field.value.join(`${field.delimiter} `)}
                />
              </FieldContent>
            </Field>
          );
        })}
      </div>
    );
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
      <h1 className="text-xl font-semibold">{pageTitle}</h1>
      <Card>
        <CardContent className="gap-4 flex flex-col pt-4">
          {saveError ? (
            <Alert variant="destructive">
              <AlertTitle>{props.mode === "create" ? "Create failed" : "Update failed"}</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

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
        <Card>
          <CardContent className="gap-4 flex flex-col pt-4">
            <div className="gap-1 flex flex-col">
              <h2 className="text-lg font-semibold">Integrations</h2>
              <p className="text-muted-foreground text-sm">
                Assign integration connections for a specific sandbox profile version.
              </p>
            </div>

            {profileVersionsQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not load sandbox profile versions</AlertTitle>
                <AlertDescription>
                  {resolveApiErrorMessage({
                    error: profileVersionsQuery.error,
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
                    profileVersionsQuery.isPending || profileVersionsQuery.data === undefined
                  }
                  onValueChange={handleSelectedVersionChange}
                  value={selectedVersion === null ? undefined : String(selectedVersion)}
                >
                  <SelectTrigger aria-label="Sandbox profile version" id="sandbox-profile-version">
                    <SelectValue placeholder="Select profile version" />
                  </SelectTrigger>
                  <SelectContent>
                    {(profileVersionsQuery.data?.versions ?? []).map((version) => (
                      <SelectItem key={version.version} value={String(version.version)}>
                        Version {version.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            {selectedVersion === null ? null : integrationBindingsQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not load integration bindings</AlertTitle>
                <AlertDescription>
                  {resolveApiErrorMessage({
                    error: integrationBindingsQuery.error,
                    fallbackMessage: "Could not load sandbox profile integration bindings.",
                  })}
                </AlertDescription>
              </Alert>
            ) : null}

            {integrationDirectoryQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not load integration connections</AlertTitle>
                <AlertDescription>
                  {resolveApiErrorMessage({
                    error: integrationDirectoryQuery.error,
                    fallbackMessage: "Could not load integration connections.",
                  })}
                </AlertDescription>
              </Alert>
            ) : null}

            {integrationSaveError ? (
              <Alert variant="destructive">
                <AlertTitle>Save failed</AlertTitle>
                <AlertDescription>{integrationSaveError}</AlertDescription>
              </Alert>
            ) : null}

            {integrationRows.map((row, rowIndex) => (
              <div className="gap-3 rounded-md border p-3 flex flex-col" key={row.clientId}>
                <div className="flex items-center justify-between">
                  <Label>Binding {rowIndex + 1}</Label>
                  <Button
                    onClick={() => {
                      handleRemoveIntegrationBindingRow(row.clientId);
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
                        const selectedConnection = availableConnections.find(
                          (connection) => connection.id === nextValue,
                        );
                        const selectedTarget =
                          selectedConnection === undefined
                            ? undefined
                            : availableTargets.find(
                                (target) => target.targetKey === selectedConnection.targetKey,
                              );
                        const resolvedKind = resolveBindingKindFromTarget(selectedTarget);
                        handleIntegrationBindingRowChange(row.clientId, {
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
                          {resolveSelectedConnectionDisplayName(row)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {availableConnections.map((connection) => (
                          <SelectItem key={connection.id} value={connection.id}>
                            {formatConnectionDisplayName({
                              connection,
                              targets: availableTargets,
                            })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel>Config</FieldLabel>
                  <FieldContent>{renderBindingConfigField(row)}</FieldContent>
                </Field>

                {integrationRowErrorsByClientId[row.clientId] !== undefined ? (
                  <p className="text-destructive text-sm">
                    {integrationRowErrorsByClientId[row.clientId]}
                  </p>
                ) : null}
              </div>
            ))}

            <div className="gap-2 flex">
              <Button onClick={handleAddIntegrationBindingRow} type="button" variant="outline">
                Add binding
              </Button>
              <Button
                disabled={
                  selectedVersion === null ||
                  integrationBindingsQuery.isPending ||
                  integrationDirectoryQuery.isPending ||
                  putIntegrationBindingsMutation.isPending
                }
                onClick={handleSaveIntegrationBindings}
                type="button"
              >
                {putIntegrationBindingsMutation.isPending ? "Saving..." : "Save integrations"}
              </Button>
              {integrationSaveSuccess ? (
                <p className="text-muted-foreground text-sm self-center">Saved.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
