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
  startRedirectIntegrationConnection,
  updateApiKeyIntegrationConnection,
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

function isRedirectConnectionMethodId(
  methodId: IntegrationConnectionMethodId,
): methodId is "oauth2" | "github-app-installation" {
  return (
    methodId === IntegrationConnectionMethodIds.OAUTH2 ||
    methodId === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  );
}

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

  const startRedirectMutation = useMutation({
    mutationFn: async (mutationInput: {
      targetKey: string;
      methodId: "oauth2" | "github-app-installation";
      displayName?: string;
    }) => startRedirectIntegrationConnection(mutationInput),
  });

  const updateConnectionMetadataMutation = useMutation({
    mutationFn: async (mutationInput: { connectionId: string; displayName: string }) =>
      updateIntegrationConnection(mutationInput),
  });

  const updateApiKeyMutation = useMutation({
    mutationFn: async (mutationInput: {
      connectionId: string;
      displayName: string;
      apiKey: string;
    }) => updateApiKeyIntegrationConnection(mutationInput),
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
        await updateApiKeyMutation.mutateAsync({
          connectionId: dialog.connectionId,
          displayName: normalizedConnectionDisplayName,
          apiKey: normalizedApiKey,
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
      await updateConnectionMetadataMutation.mutateAsync({
        connectionId: dialog.connectionId,
        displayName: draft.connectionDisplayNameValue.trim(),
      });

      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });

      closeDialog();
      return;
    }

    if (!isRedirectConnectionMethodId(draft.methodId)) {
      throw new Error(`Unsupported redirect connection method '${draft.methodId}'.`);
    }

    const started = await startRedirectMutation.mutateAsync({
      targetKey: dialog.targetKey,
      methodId: draft.methodId,
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
      startRedirectMutation.isPending ||
      updateConnectionMetadataMutation.isPending ||
      updateApiKeyMutation.isPending,
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
