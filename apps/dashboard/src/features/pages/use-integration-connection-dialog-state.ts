import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  type IntegrationConnectionDialogState,
  type IntegrationConnectionMethodId,
  IntegrationConnectionMethodIds,
} from "../integrations/integration-connection-dialog.js";
import {
  createApiKeyIntegrationConnection,
  startOAuthIntegrationConnection,
  updateIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { OpenIntegrationConnectionDialogInput } from "./integration-connection-dialog-state-types.js";
import {
  createClosedIntegrationConnectionDialogDraft,
  createOpenIntegrationConnectionDialogState,
  hasIntegrationConnectionDialogChanges,
  isIntegrationConnectionDisplayNameChanged,
  resolveIntegrationConnectionDialogValidationError,
} from "./use-integration-connection-dialog-state-helpers.js";

export function useIntegrationConnectionDialogState(input: { queryKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<IntegrationConnectionDialogState | null>(null);
  const [draft, setDraft] = useState(() =>
    createClosedIntegrationConnectionDialogDraft(IntegrationConnectionMethodIds.API_KEY),
  );

  const createApiKeyMutation = useMutation({
    mutationFn: async (mutationInput: { targetKey: string; displayName: string; apiKey: string }) =>
      createApiKeyIntegrationConnection(mutationInput),
  });

  const startOAuthMutation = useMutation({
    mutationFn: async (mutationInput: { targetKey: string }) =>
      startOAuthIntegrationConnection(mutationInput),
  });

  const updateConnectionMutation = useMutation({
    mutationFn: async (mutationInput: {
      connectionId: string;
      displayName: string;
      apiKey?: string;
    }) => updateIntegrationConnection(mutationInput),
  });

  function closeDialog(): void {
    setDialog(null);
    setDraft(createClosedIntegrationConnectionDialogDraft(IntegrationConnectionMethodIds.API_KEY));
  }

  function openDialog(openInput: OpenIntegrationConnectionDialogInput): void {
    const nextState = createOpenIntegrationConnectionDialogState({
      defaultMethodId: IntegrationConnectionMethodIds.API_KEY,
      openInput,
    });
    setDialog(nextState.dialog);
    setDraft(nextState.draft);
  }

  async function runSubmit(): Promise<void> {
    if (dialog === null) {
      throw new Error("Connection dialog is required to run this action.");
    }

    const validationError = resolveIntegrationConnectionDialogValidationError({
      dialog,
      methodId: draft.methodId,
      apiKeyValue: draft.apiKeyValue,
      connectionDisplayNameValue: draft.connectionDisplayNameValue,
    });
    if (validationError !== null) {
      setDraft((currentDraft) => ({
        ...currentDraft,
        error: validationError,
      }));
      return;
    }

    if (draft.methodId === IntegrationConnectionMethodIds.API_KEY) {
      const normalizedApiKey = draft.apiKeyValue.trim();
      const normalizedConnectionDisplayName = draft.connectionDisplayNameValue.trim();

      if (dialog.mode === "update") {
        await updateConnectionMutation.mutateAsync({
          connectionId: dialog.connectionId,
          displayName: normalizedConnectionDisplayName,
          ...(normalizedApiKey.length === 0 ? {} : { apiKey: normalizedApiKey }),
        });
      } else {
        await createApiKeyMutation.mutateAsync({
          targetKey: dialog.targetKey,
          displayName: normalizedConnectionDisplayName,
          apiKey: normalizedApiKey,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });

      closeDialog();
      return;
    }

    if (dialog.mode === "update") {
      await updateConnectionMutation.mutateAsync({
        connectionId: dialog.connectionId,
        displayName: draft.connectionDisplayNameValue.trim(),
      });

      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });

      closeDialog();
      return;
    }

    const started = await startOAuthMutation.mutateAsync({
      targetKey: dialog.targetKey,
      ...(draft.connectionDisplayNameValue.trim().length === 0
        ? {}
        : { displayName: draft.connectionDisplayNameValue.trim() }),
    });
    globalThis.location.assign(started.authorizationUrl);
  }

  function submitDialog(): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      error: null,
    }));
    void runSubmit().catch((submitError: unknown) => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        error: resolveApiErrorMessage({
          error: submitError,
          fallbackMessage:
            dialog?.mode === "update"
              ? "Could not update connection."
              : "Could not start integration connection.",
        }),
      }));
    });
  }

  return {
    dialog,
    methodId: draft.methodId,
    connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
    connectionDisplayNameValue: draft.connectionDisplayNameValue,
    apiKeyValue: draft.apiKeyValue,
    error: draft.error,
    pending:
      createApiKeyMutation.isPending ||
      startOAuthMutation.isPending ||
      updateConnectionMutation.isPending,
    hasChanges: hasIntegrationConnectionDialogChanges({
      dialog,
      connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
      connectionDisplayNameValue: draft.connectionDisplayNameValue,
      apiKeyValue: draft.apiKeyValue,
    }),
    isApiKeyChanged: draft.apiKeyValue.trim().length > 0,
    isConnectionDisplayNameChanged: isIntegrationConnectionDisplayNameChanged({
      dialog,
      connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
      connectionDisplayNameValue: draft.connectionDisplayNameValue,
    }),
    openDialog,
    closeDialog,
    submitDialog,
    onApiKeyChange: (value: string): void => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        apiKeyValue: value,
        error: null,
      }));
    },
    onConnectionDisplayNameChange: (value: string): void => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        connectionDisplayNameValue: value,
        error: null,
      }));
    },
    onMethodChange: (nextMethodId: IntegrationConnectionMethodId): void => {
      setDraft((currentDraft) => ({
        ...currentDraft,
        methodId: nextMethodId,
        error: null,
      }));
    },
  };
}
