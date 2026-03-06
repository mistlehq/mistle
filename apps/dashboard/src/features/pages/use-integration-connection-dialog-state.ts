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
  updateApiKeyIntegrationConnection,
} from "../integrations/integrations-service.js";

export type OpenIntegrationConnectionDialogInput = {
  targetKey: string;
  displayName: string;
  methods: readonly IntegrationConnectionMethodId[];
  mode: "create" | "update";
  connectionId?: string;
};

export function useIntegrationConnectionDialogState(input: { queryKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<IntegrationConnectionDialogState | null>(null);
  const [methodId, setMethodId] = useState<IntegrationConnectionMethodId>(
    IntegrationConnectionMethodIds.API_KEY,
  );
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createApiKeyMutation = useMutation({
    mutationFn: async (mutationInput: { targetKey: string; apiKey: string }) =>
      createApiKeyIntegrationConnection(mutationInput),
  });

  const startOAuthMutation = useMutation({
    mutationFn: async (mutationInput: { targetKey: string }) =>
      startOAuthIntegrationConnection(mutationInput),
  });

  const updateApiKeyMutation = useMutation({
    mutationFn: async (mutationInput: { connectionId: string; apiKey: string }) =>
      updateApiKeyIntegrationConnection(mutationInput),
  });

  function closeDialog(): void {
    setDialog(null);
    setMethodId(IntegrationConnectionMethodIds.API_KEY);
    setApiKeyValue("");
    setError(null);
  }

  function openDialog(openInput: OpenIntegrationConnectionDialogInput): void {
    const defaultMethod = openInput.methods[0];
    if (defaultMethod === undefined) {
      throw new Error(
        `Integration target '${openInput.targetKey}' does not declare any supported auth scheme.`,
      );
    }

    setDialog({
      targetKey: openInput.targetKey,
      displayName: openInput.displayName,
      methods: openInput.methods,
      mode: openInput.mode,
      ...(openInput.connectionId === undefined ? {} : { connectionId: openInput.connectionId }),
    });
    setMethodId(defaultMethod);
    setApiKeyValue("");
    setError(null);
  }

  async function runSubmit(): Promise<void> {
    if (dialog === null) {
      throw new Error("Connection dialog is required to run this action.");
    }

    if (!dialog.methods.includes(methodId)) {
      throw new Error(
        `Connect method '${methodId}' is not supported for target '${dialog.targetKey}'.`,
      );
    }

    if (methodId === IntegrationConnectionMethodIds.API_KEY) {
      const normalizedApiKey = apiKeyValue.trim();
      if (normalizedApiKey.length === 0) {
        setError("API key is required.");
        return;
      }

      if (dialog.mode === "update") {
        if (dialog.connectionId === undefined) {
          throw new Error("Connection id is required for API-key update.");
        }

        await updateApiKeyMutation.mutateAsync({
          connectionId: dialog.connectionId,
          apiKey: normalizedApiKey,
        });
      } else {
        await createApiKeyMutation.mutateAsync({
          targetKey: dialog.targetKey,
          apiKey: normalizedApiKey,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });

      closeDialog();
      return;
    }

    const started = await startOAuthMutation.mutateAsync({
      targetKey: dialog.targetKey,
    });
    globalThis.location.assign(started.authorizationUrl);
  }

  function submitDialog(): void {
    setError(null);
    void runSubmit().catch((submitError: unknown) => {
      setError(
        resolveApiErrorMessage({
          error: submitError,
          fallbackMessage:
            dialog?.mode === "update"
              ? "Could not update API key."
              : "Could not start integration connection.",
        }),
      );
    });
  }

  return {
    dialog,
    methodId,
    apiKeyValue,
    error,
    pending:
      createApiKeyMutation.isPending ||
      startOAuthMutation.isPending ||
      updateApiKeyMutation.isPending,
    openDialog,
    closeDialog,
    submitDialog,
    onApiKeyChange: (value: string): void => {
      setApiKeyValue(value);
      setError(null);
    },
    onMethodChange: (nextMethodId: IntegrationConnectionMethodId): void => {
      setMethodId(nextMethodId);
      setError(null);
    },
  };
}
