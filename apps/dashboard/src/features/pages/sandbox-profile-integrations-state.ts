import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionIntegrationBindings,
  listSandboxProfileVersions,
  putSandboxProfileVersionIntegrationBindings,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type {
  SandboxIntegrationBindingKind,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { resolveBindingConfigUiModel } from "./sandbox-profile-binding-config-editor.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

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

type PersistedBindingRecord = {
  id: string;
  connectionId: string;
  kind: SandboxIntegrationBindingKind;
  config: Record<string, unknown>;
};

function mapBindingsToEditorRows(
  bindings: readonly PersistedBindingRecord[],
): SandboxProfileBindingEditorRow[] {
  return bindings.map((binding) => ({
    clientId: createIntegrationBindingClientId(),
    id: binding.id,
    connectionId: binding.connectionId,
    kind: binding.kind,
    config: binding.config,
  }));
}

type IntegrationConfigObject = {
  [key: string]: unknown;
};

function isIntegrationConfigObject(value: unknown): value is IntegrationConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceIntegrationConfigObject(value: unknown): IntegrationConfigObject {
  return isIntegrationConfigObject(value) ? value : {};
}

function resolveLatestVersion(versions: readonly SandboxProfileVersion[]): number | null {
  if (versions.length === 0) {
    return null;
  }

  let latestVersion = versions[0]?.version;
  if (latestVersion === undefined) {
    return null;
  }

  for (const candidate of versions) {
    if (candidate.version > latestVersion) {
      latestVersion = candidate.version;
    }
  }

  return latestVersion;
}

type UseSandboxProfileIntegrationsStateInput = {
  mode: "create" | "edit";
  profileId: string | undefined;
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
};

export function useSandboxProfileIntegrationsState(
  input: UseSandboxProfileIntegrationsStateInput,
): {
  canEditIntegrations: boolean;
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
  onAddIntegrationBindingRow: (input: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
    config: Record<string, unknown>;
  }) => Promise<boolean>;
  onRemoveIntegrationBindingRow: (clientId: string) => void;
  onIntegrationBindingRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  resolveSelectedConnectionDisplayName: (row: SandboxProfileBindingEditorRow) => string | undefined;
  integrationSaveSuccess: boolean;
  isSavingIntegrationBindings: boolean;
} {
  const [integrationRows, setIntegrationRows] = useState<SandboxProfileBindingEditorRow[]>([]);
  const [integrationSaveError, setIntegrationSaveError] = useState<string | null>(null);
  const [integrationRowErrorsByClientId, setIntegrationRowErrorsByClientId] = useState<
    Record<string, string>
  >({});
  const [integrationSaveSuccess, setIntegrationSaveSuccess] = useState(false);

  const profileVersionsQuery = useQuery({
    queryKey:
      input.mode === "edit" && input.profileId !== undefined
        ? sandboxProfileVersionsQueryKey(input.profileId)
        : sandboxProfileVersionsQueryKey("missing-profile-id"),
    queryFn: async ({ signal }) => {
      if (input.profileId === undefined) {
        throw new Error("profileId is required.");
      }
      return listSandboxProfileVersions({
        profileId: input.profileId,
        signal,
      });
    },
    enabled: input.mode === "edit" && input.profileId !== undefined,
    retry: false,
  });

  const resolvedProfileVersion = resolveLatestVersion(profileVersionsQuery.data?.versions ?? []);

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

  function markIntegrationDirty(inputValue?: { clientId: string }): void {
    setIntegrationSaveError(null);
    if (inputValue === undefined) {
      setIntegrationRowErrorsByClientId({});
    } else {
      clearIntegrationRowError(inputValue.clientId);
    }
    setIntegrationSaveSuccess(false);
  }

  function setIntegrationSaveFailure(message: string): void {
    setIntegrationSaveError(message);
    setIntegrationSaveSuccess(false);
  }

  const integrationBindingsQuery = useQuery({
    queryKey:
      input.mode === "edit" && input.profileId !== undefined && resolvedProfileVersion !== null
        ? sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: input.profileId,
            version: resolvedProfileVersion,
          })
        : sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: "missing-profile-id",
            version: 0,
          }),
    queryFn: async ({ signal }) => {
      if (input.profileId === undefined || resolvedProfileVersion === null) {
        throw new Error("profileId and version are required.");
      }
      return getSandboxProfileVersionIntegrationBindings({
        profileId: input.profileId,
        version: resolvedProfileVersion,
        signal,
      });
    },
    enabled:
      input.mode === "edit" &&
      input.profileId !== undefined &&
      resolvedProfileVersion !== null &&
      !profileVersionsQuery.isPending,
    retry: false,
  });

  const integrationDirectoryQuery = useQuery({
    queryKey: ["sandbox-profiles", "integration-directory"],
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    enabled: input.mode === "edit",
  });

  const putIntegrationBindingsMutation = useMutation({
    mutationFn: async (mutationInput: {
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
        profileId: mutationInput.profileId,
        version: mutationInput.version,
        bindings: mutationInput.bindings,
      }),
    onSuccess: async (updatedBindings, mutationInput) => {
      setIntegrationRows(mapBindingsToEditorRows(updatedBindings.bindings));
      setIntegrationSaveError(null);
      setIntegrationRowErrorsByClientId({});
      setIntegrationSaveSuccess(true);

      if (input.profileId !== undefined) {
        await input.invalidateVersionBindings({
          profileId: input.profileId,
          version: mutationInput.version,
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
          if (clientId === undefined || rowErrors[clientId] !== undefined) {
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
    const bindings = integrationBindingsQuery.data?.bindings;
    if (bindings === undefined) {
      return;
    }
    setIntegrationRows(mapBindingsToEditorRows(bindings));
    markIntegrationDirty();
  }, [integrationBindingsQuery.data]);

  const availableConnections: readonly IntegrationConnectionSummary[] =
    integrationDirectoryQuery.data?.connections.map((connection) => ({
      ...connection,
      ...(connection.config === undefined
        ? {}
        : {
            config: coerceIntegrationConfigObject(connection.config),
          }),
    })) ?? [];
  const availableTargets: readonly IntegrationTargetSummary[] =
    integrationDirectoryQuery.data?.targets.map((target) => ({
      ...target,
      config: coerceIntegrationConfigObject(target.config),
    })) ?? [];

  function setNeutralSaveState(): void {
    setIntegrationSaveError(null);
    setIntegrationRowErrorsByClientId({});
    setIntegrationSaveSuccess(false);
  }

  async function persistIntegrationRows(
    rowsToPersist: readonly SandboxProfileBindingEditorRow[],
  ): Promise<boolean> {
    if (
      input.mode !== "edit" ||
      input.profileId === undefined ||
      putIntegrationBindingsMutation.isPending
    ) {
      return false;
    }
    if (resolvedProfileVersion === null) {
      setIntegrationSaveFailure("No sandbox profile version is available for this profile.");
      return false;
    }

    const parsedBindings: Array<{
      id?: string;
      clientRef: string;
      connectionId: string;
      kind: SandboxIntegrationBindingKind;
      config: Record<string, unknown>;
    }> = [];

    for (const row of rowsToPersist) {
      const normalizedConnectionId = row.connectionId.trim();
      if (normalizedConnectionId.length === 0) {
        setIntegrationSaveFailure("Each integration binding must select a connection.");
        return false;
      }

      const configUiModel = resolveBindingConfigUiModel({
        row,
        connections: availableConnections,
        targets: availableTargets,
      });
      if (configUiModel.mode === "missing-connection") {
        setIntegrationSaveFailure("Each integration binding must select a connection.");
        return false;
      }
      if (configUiModel.mode === "unsupported") {
        setIntegrationSaveFailure(configUiModel.message);
        return false;
      }

      parsedBindings.push({
        ...(row.id === undefined ? {} : { id: row.id }),
        clientRef: row.clientId,
        connectionId: normalizedConnectionId,
        kind: row.kind,
        config: configUiModel.mode === "form" ? configUiModel.value : {},
      });
    }

    setNeutralSaveState();

    try {
      await putIntegrationBindingsMutation.mutateAsync({
        profileId: input.profileId,
        version: resolvedProfileVersion,
        bindings: parsedBindings,
      });
      return true;
    } catch {
      return false;
    }
  }

  async function onAddIntegrationBindingRow(inputValue: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
    config: Record<string, unknown>;
  }): Promise<boolean> {
    const nextRows = [
      ...integrationRows,
      {
        clientId: createIntegrationBindingClientId(),
        connectionId: inputValue.connectionId,
        kind: inputValue.kind,
        config: inputValue.config,
      },
    ];
    setIntegrationRows(nextRows);
    markIntegrationDirty();
    return persistIntegrationRows(nextRows);
  }

  function onRemoveIntegrationBindingRow(clientId: string): void {
    const nextRows = integrationRows.filter((row) => row.clientId !== clientId);
    setIntegrationRows(nextRows);
    markIntegrationDirty({ clientId });
    void persistIntegrationRows(nextRows);
  }

  function onIntegrationBindingRowChange(
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ): void {
    const nextRows = integrationRows.map((row) => {
      if (row.clientId !== clientId) {
        return row;
      }
      return {
        ...row,
        ...changes,
      };
    });
    setIntegrationRows(nextRows);
    markIntegrationDirty({ clientId });
    void persistIntegrationRows(nextRows);
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
    });
  }

  return {
    canEditIntegrations: input.mode === "edit" && input.profileId !== undefined,
    integrationBindingsQuery: {
      isError:
        profileVersionsQuery.isError ||
        (!profileVersionsQuery.isPending && resolvedProfileVersion === null) ||
        integrationBindingsQuery.isError,
      error:
        profileVersionsQuery.error ??
        (!profileVersionsQuery.isPending && resolvedProfileVersion === null
          ? new Error("No sandbox profile version is available for this profile.")
          : integrationBindingsQuery.error),
      isPending: profileVersionsQuery.isPending || integrationBindingsQuery.isPending,
    },
    integrationDirectoryQuery: {
      isError: integrationDirectoryQuery.isError,
      error: integrationDirectoryQuery.error,
      isPending: integrationDirectoryQuery.isPending,
    },
    integrationSaveError,
    integrationRows,
    integrationRowErrorsByClientId,
    availableConnections,
    availableTargets,
    onAddIntegrationBindingRow,
    onRemoveIntegrationBindingRow,
    onIntegrationBindingRowChange,
    resolveSelectedConnectionDisplayName,
    integrationSaveSuccess,
    isSavingIntegrationBindings: putIntegrationBindingsMutation.isPending,
  };
}
