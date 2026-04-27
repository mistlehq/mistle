import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { z } from "zod";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { SandboxProfilesApiError } from "../sandbox-profiles/sandbox-profiles-api-errors.js";
import {
  sandboxProfileIntegrationDirectoryQueryKey,
  sandboxProfileVersionIntegrationBindingsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionIntegrationBindings,
  putSandboxProfileVersionIntegrationBindings,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  AppShellLoadingIndicators,
  createAppShellLoadingIndicatorMeta,
} from "../shell/app-shell-loading-indicator-meta.js";
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

export function mapBindingsToEditorRows(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function useSandboxProfileIntegrationsLoader(input: {
  profileId: string;
  version: number;
}): {
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
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  initialRows: readonly SandboxProfileBindingEditorRow[] | null;
} {
  const integrationBindingsQuery = useQuery({
    queryKey: sandboxProfileVersionIntegrationBindingsQueryKey({
      profileId: input.profileId,
      version: input.version,
    }),
    queryFn: async ({ signal }) =>
      getSandboxProfileVersionIntegrationBindings({
        profileId: input.profileId,
        version: input.version,
        signal,
      }),
    retry: false,
  });
  const integrationDirectoryQuery = useQuery({
    queryKey: sandboxProfileIntegrationDirectoryQueryKey(),
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  return {
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
    availableConnections:
      integrationDirectoryQuery.data?.connections.map((connection) => ({
        ...connection,
        ...(connection.config === undefined ? {} : { config: resolveRecord(connection.config) }),
      })) ?? [],
    availableTargets:
      integrationDirectoryQuery.data?.targets.map((target) => ({
        ...target,
        config: resolveRecord(target.config),
      })) ?? [],
    initialRows:
      integrationBindingsQuery.data?.bindings === undefined
        ? null
        : mapBindingsToEditorRows(integrationBindingsQuery.data.bindings),
  };
}

export function useLoadedSandboxProfileIntegrationsState(input: {
  profileId: string;
  version: number;
  initialRows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  invalidateVersionBindings: (input: { profileId: string; version: number }) => Promise<void>;
}): {
  integrationSaveError: string | null;
  integrationRows: readonly SandboxProfileBindingEditorRow[];
  integrationRowErrorsByClientId: Readonly<Record<string, string>>;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  hasUnsavedChanges: boolean;
  flushDraftChanges: () => Promise<boolean>;
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
  isSubmittingIntegrationBindings: boolean;
} {
  const [integrationRows, setIntegrationRows] = useState([...input.initialRows]);
  const [integrationSaveError, setIntegrationSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [integrationRowErrorsByClientId, setIntegrationRowErrorsByClientId] = useState<
    Record<string, string>
  >({});
  const pendingSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const integrationRowsRef = useRef(integrationRows);
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  integrationRowsRef.current = integrationRows;
  hasUnsavedChangesRef.current = hasUnsavedChanges;

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
    setHasUnsavedChanges(true);
    setIntegrationSaveError(null);
    if (inputValue === undefined) {
      setIntegrationRowErrorsByClientId({});
    } else {
      clearIntegrationRowError(inputValue.clientId);
    }
  }

  function setIntegrationSaveFailure(message: string): void {
    setIntegrationSaveError(message);
  }

  const putIntegrationBindingsMutation = useMutation({
    meta: createAppShellLoadingIndicatorMeta(AppShellLoadingIndicators.AUTOSAVE),
    mutationFn: async (mutationInput: {
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
        bindings: mutationInput.bindings,
      }),
    onSuccess: async (updatedBindings) => {
      setIntegrationRows(mapBindingsToEditorRows(updatedBindings.bindings));
      setIntegrationSaveError(null);
      setHasUnsavedChanges(false);
      setIntegrationRowErrorsByClientId({});
      await input.invalidateVersionBindings({
        profileId: input.profileId,
        version: input.version,
      });
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
    },
  });

  function setNeutralSaveState(): void {
    setIntegrationSaveError(null);
    setIntegrationRowErrorsByClientId({});
  }

  async function persistIntegrationRows(
    rowsToPersist: readonly SandboxProfileBindingEditorRow[],
  ): Promise<boolean> {
    if (putIntegrationBindingsMutation.isPending) {
      return pendingSavePromiseRef.current ?? false;
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
        connections: input.availableConnections,
        targets: input.availableTargets,
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

    const savePromise = putIntegrationBindingsMutation
      .mutateAsync({
        bindings: parsedBindings,
      })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        if (pendingSavePromiseRef.current === savePromise) {
          pendingSavePromiseRef.current = null;
        }
      });
    pendingSavePromiseRef.current = savePromise;
    return savePromise;
  }

  const flushDraftChanges = useCallback(async (): Promise<boolean> => {
    if (putIntegrationBindingsMutation.isPending) {
      return pendingSavePromiseRef.current ?? false;
    }

    if (!hasUnsavedChangesRef.current) {
      return true;
    }

    return persistIntegrationRows(integrationRowsRef.current);
  }, [putIntegrationBindingsMutation.isPending]);

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
    const nextRows = integrationRows.map((row) =>
      row.clientId === clientId
        ? {
            ...row,
            ...changes,
          }
        : row,
    );
    setIntegrationRows(nextRows);
    markIntegrationDirty({ clientId });
    void persistIntegrationRows(nextRows);
  }

  return {
    integrationSaveError,
    integrationRows,
    integrationRowErrorsByClientId,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
    hasUnsavedChanges,
    flushDraftChanges,
    onAddIntegrationBindingRow,
    onRemoveIntegrationBindingRow,
    onIntegrationBindingRowChange,
    isSubmittingIntegrationBindings: putIntegrationBindingsMutation.isPending,
  };
}
