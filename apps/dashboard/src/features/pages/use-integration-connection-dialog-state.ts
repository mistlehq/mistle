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

export type OpenIntegrationConnectionDialogInput =
  | {
      methods: readonly IntegrationConnectionMethodId[];
      mode: "create";
      targetDisplayName: string;
      targetKey: string;
    }
  | {
      connectionDisplayName?: string;
      connectionId: string;
      currentMethodId: IntegrationConnectionMethodId;
      mode: "update";
      targetDisplayName: string;
      targetKey: string;
    };

export function useIntegrationConnectionDialogState(input: { queryKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<IntegrationConnectionDialogState | null>(null);
  const [methodId, setMethodId] = useState<IntegrationConnectionMethodId>(
    IntegrationConnectionMethodIds.API_KEY,
  );
  const [connectionDisplayNamePlaceholder, setConnectionDisplayNamePlaceholder] = useState("");
  const [connectionDisplayNameValue, setConnectionDisplayNameValue] = useState("");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    setMethodId(IntegrationConnectionMethodIds.API_KEY);
    setConnectionDisplayNamePlaceholder("");
    setConnectionDisplayNameValue("");
    setApiKeyValue("");
    setError(null);
  }

  function openDialog(openInput: OpenIntegrationConnectionDialogInput): void {
    const supportedMethods =
      openInput.mode === "create" ? openInput.methods : [openInput.currentMethodId];
    const existingConnectionDisplayName =
      openInput.mode === "update" ? openInput.connectionDisplayName : undefined;
    const defaultMethod = supportedMethods[0];
    if (defaultMethod === undefined) {
      throw new Error(
        `Integration target '${openInput.targetKey}' does not declare any supported auth scheme.`,
      );
    }
    const defaultConnectionDisplayName =
      openInput.mode === "update"
        ? (existingConnectionDisplayName ?? openInput.connectionId ?? "")
        : `${openInput.targetDisplayName} connection`;

    if (openInput.mode === "create") {
      setDialog({
        targetKey: openInput.targetKey,
        displayName: openInput.targetDisplayName,
        mode: openInput.mode,
        methods: openInput.methods,
      });
    } else {
      setDialog({
        connectionId: openInput.connectionId,
        currentMethodId: openInput.currentMethodId,
        targetKey: openInput.targetKey,
        displayName: openInput.targetDisplayName,
        mode: openInput.mode,
        ...(existingConnectionDisplayName === undefined
          ? {}
          : { initialConnectionDisplayName: existingConnectionDisplayName }),
      });
    }
    setMethodId(defaultMethod);
    setConnectionDisplayNamePlaceholder(defaultConnectionDisplayName);
    setConnectionDisplayNameValue(existingConnectionDisplayName ?? "");
    setApiKeyValue("");
    setError(null);
  }

  async function runSubmit(): Promise<void> {
    if (dialog === null) {
      throw new Error("Connection dialog is required to run this action.");
    }

    const supportedMethods = dialog.mode === "create" ? dialog.methods : [dialog.currentMethodId];
    if (!supportedMethods.includes(methodId)) {
      throw new Error(
        `Connect method '${methodId}' is not supported for target '${dialog.targetKey}'.`,
      );
    }

    if (methodId === IntegrationConnectionMethodIds.API_KEY) {
      const normalizedApiKey = apiKeyValue.trim();
      if (dialog.mode === "create" && normalizedApiKey.length === 0) {
        setError("API key is required.");
        return;
      }
      const normalizedConnectionDisplayName = connectionDisplayNameValue.trim();
      if (normalizedConnectionDisplayName.length === 0) {
        setError("Connection name is required.");
        return;
      }

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
      const normalizedConnectionDisplayName = connectionDisplayNameValue.trim();
      if (normalizedConnectionDisplayName.length === 0) {
        setError("Connection name is required.");
        return;
      }

      await updateConnectionMutation.mutateAsync({
        connectionId: dialog.connectionId,
        displayName: normalizedConnectionDisplayName,
      });

      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });

      closeDialog();
      return;
    }

    const started = await startOAuthMutation.mutateAsync({
      targetKey: dialog.targetKey,
      ...(connectionDisplayNameValue.trim().length === 0
        ? {}
        : { displayName: connectionDisplayNameValue.trim() }),
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
              ? "Could not update connection."
              : "Could not start integration connection.",
        }),
      );
    });
  }

  return {
    dialog,
    methodId,
    connectionDisplayNamePlaceholder,
    connectionDisplayNameValue,
    apiKeyValue,
    error,
    pending:
      createApiKeyMutation.isPending ||
      startOAuthMutation.isPending ||
      updateConnectionMutation.isPending,
    hasChanges:
      dialog?.mode === "create"
        ? true
        : (dialog?.initialConnectionDisplayName ?? connectionDisplayNamePlaceholder).trim() !==
            connectionDisplayNameValue.trim() || apiKeyValue.trim().length > 0,
    isApiKeyChanged: apiKeyValue.trim().length > 0,
    isConnectionDisplayNameChanged:
      dialog?.mode === "update"
        ? (dialog.initialConnectionDisplayName ?? connectionDisplayNamePlaceholder).trim() !==
          connectionDisplayNameValue.trim()
        : connectionDisplayNameValue.trim().length > 0,
    openDialog,
    closeDialog,
    submitDialog,
    onApiKeyChange: (value: string): void => {
      setApiKeyValue(value);
      setError(null);
    },
    onConnectionDisplayNameChange: (value: string): void => {
      setConnectionDisplayNameValue(value);
      setError(null);
    },
    onMethodChange: (nextMethodId: IntegrationConnectionMethodId): void => {
      setMethodId(nextMethodId);
      setError(null);
    },
  };
}
