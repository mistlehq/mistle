import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { formatSandboxProfileVersionLabel } from "../sandbox-profiles/format-sandbox-profile-version-label.js";
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

function resolveSelectedVersionDisplayName(
  selectedVersion: number | null,
  versions: readonly SandboxProfileVersion[],
): string | undefined {
  if (selectedVersion === null) {
    return undefined;
  }
  const version = versions.find((currentVersion) => currentVersion.version === selectedVersion);
  if (version === undefined) {
    return undefined;
  }
  return formatSandboxProfileVersionLabel(version.version);
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
  profileVersionsQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
    data: { versions: SandboxProfileVersion[] } | undefined;
  };
  resolvedSelectedVersion: number | null;
  selectedVersionDisplayName: string | undefined;
  onSelectedVersionChange: (nextValue: string | null) => void;
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
  onAddIntegrationBindingRow: () => void;
  onRemoveIntegrationBindingRow: (clientId: string) => void;
  onIntegrationBindingRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onSaveIntegrationBindings: () => void;
  resolveSelectedConnectionDisplayName: (row: SandboxProfileBindingEditorRow) => string | undefined;
  integrationSaveSuccess: boolean;
  isSavingIntegrationBindings: boolean;
} {
  const [explicitSelectedVersion, setExplicitSelectedVersion] = useState<number | null>(null);
  const [integrationRows, setIntegrationRows] = useState<SandboxProfileBindingEditorRow[]>([]);
  const [integrationSaveError, setIntegrationSaveError] = useState<string | null>(null);
  const [integrationRowErrorsByClientId, setIntegrationRowErrorsByClientId] = useState<
    Record<string, string>
  >({});
  const [integrationSaveSuccess, setIntegrationSaveSuccess] = useState(false);

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
    enabled: input.mode === "edit",
    retry: false,
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
      input.mode === "edit" && input.profileId !== undefined && resolvedSelectedVersion !== null
        ? sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: input.profileId,
            version: resolvedSelectedVersion,
          })
        : sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: "missing-profile-id",
            version: 0,
          }),
    queryFn: async ({ signal }) => {
      if (input.profileId === undefined || resolvedSelectedVersion === null) {
        throw new Error("profileId and selectedVersion are required.");
      }
      return getSandboxProfileVersionIntegrationBindings({
        profileId: input.profileId,
        version: resolvedSelectedVersion,
        signal,
      });
    },
    enabled:
      input.mode === "edit" && input.profileId !== undefined && resolvedSelectedVersion !== null,
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
    onSuccess: async (updatedBindings) => {
      setIntegrationRows(mapBindingsToEditorRows(updatedBindings.bindings));
      setIntegrationSaveError(null);
      setIntegrationRowErrorsByClientId({});
      setIntegrationSaveSuccess(true);

      if (input.profileId !== undefined && resolvedSelectedVersion !== null) {
        await input.invalidateVersionBindings({
          profileId: input.profileId,
          version: resolvedSelectedVersion,
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
    integrationDirectoryQuery.data?.connections ?? [];
  const availableTargets: readonly IntegrationTargetSummary[] =
    integrationDirectoryQuery.data?.targets ?? [];

  function onSelectedVersionChange(nextValue: string | null): void {
    if (nextValue === null) {
      throw new Error("Sandbox profile version must not be null.");
    }
    const parsed = Number(nextValue);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Unsupported sandbox profile version: ${nextValue}`);
    }
    setExplicitSelectedVersion(parsed);
    markIntegrationDirty();
  }

  function onAddIntegrationBindingRow(): void {
    setIntegrationRows((currentRows) => [
      ...currentRows,
      {
        clientId: createIntegrationBindingClientId(),
        connectionId: "",
        kind: "agent",
        config: {},
      },
    ]);
    markIntegrationDirty();
  }

  function onRemoveIntegrationBindingRow(clientId: string): void {
    setIntegrationRows((currentRows) => currentRows.filter((row) => row.clientId !== clientId));
    markIntegrationDirty({ clientId });
  }

  function onIntegrationBindingRowChange(
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

  function onSaveIntegrationBindings(): void {
    if (
      input.mode !== "edit" ||
      input.profileId === undefined ||
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

      parsedBindings.push({
        ...(row.id === undefined ? {} : { id: row.id }),
        clientRef: row.clientId,
        connectionId: normalizedConnectionId,
        kind: row.kind,
        config: configUiModel.mode === "editor" ? configUiModel.value : {},
      });
    }

    putIntegrationBindingsMutation.mutate({
      profileId: input.profileId,
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

  return {
    canEditIntegrations: input.mode === "edit" && input.profileId !== undefined,
    profileVersionsQuery: {
      isError: profileVersionsQuery.isError,
      error: profileVersionsQuery.error,
      isPending: profileVersionsQuery.isPending,
      data: profileVersionsQuery.data,
    },
    resolvedSelectedVersion,
    selectedVersionDisplayName: resolveSelectedVersionDisplayName(
      resolvedSelectedVersion,
      availableProfileVersions,
    ),
    onSelectedVersionChange,
    integrationBindingsQuery: {
      isError: integrationBindingsQuery.isError,
      error: integrationBindingsQuery.error,
      isPending: integrationBindingsQuery.isPending,
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
    onSaveIntegrationBindings,
    resolveSelectedConnectionDisplayName,
    integrationSaveSuccess,
    isSavingIntegrationBindings: putIntegrationBindingsMutation.isPending,
  };
}
