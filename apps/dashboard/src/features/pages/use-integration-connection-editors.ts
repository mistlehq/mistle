import type { IntegrationFormConnectionMethodProviderAppSetupExistingAppStartAction } from "@mistle/integrations-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { resolveFormConnectionMethodProviderAppSetupStartAction } from "../integrations/integration-connection-method-metadata.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import {
  deleteIntegrationConnection,
  startRedirectProviderAppSetup,
  updateApiKeyIntegrationConnection,
  updateIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { openDeferredExternalWindow } from "../shared/external-window.js";

function resolveProviderAppSetupStartActionOrThrow(input: {
  connectionId: string;
  connections: readonly IntegrationConnection[];
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
}): IntegrationFormConnectionMethodProviderAppSetupExistingAppStartAction {
  const connection = input.connections.find((candidate) => candidate.id === input.connectionId);
  if (connection === undefined) {
    throw new Error(`Integration connection '${input.connectionId}' was not found.`);
  }
  if (connection.connectionMethodId === undefined) {
    throw new Error(
      `Integration connection '${input.connectionId}' does not declare a connection method.`,
    );
  }

  const method = input.connectionMethods?.find(
    (candidate) => candidate.id === connection.connectionMethodId,
  );
  if (method === undefined) {
    throw new Error(
      `Integration connection method '${connection.connectionMethodId}' was not found.`,
    );
  }

  const startAction = resolveFormConnectionMethodProviderAppSetupStartAction(method);
  if (startAction === null) {
    throw new Error(
      `Integration connection method '${connection.connectionMethodId}' does not define a provider app setup start action.`,
    );
  }

  return startAction;
}

export function useIntegrationConnectionEditors(input: {
  connections: readonly IntegrationConnection[];
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
  queryKey: readonly ["settings", "integrations", "directory"];
}) {
  const queryClient = useQueryClient();
  const [connectionNameErrorMessageById, setConnectionNameErrorMessageById] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const [editingApiKeyConnectionId, setEditingApiKeyConnectionId] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | undefined>(undefined);
  const [providerAppSetupErrorByConnectionId, setProviderAppSetupErrorByConnectionId] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const updateConnectionNameMutation = useMutation({
    mutationFn: async (payload: { connectionId: string; displayName: string }) =>
      updateIntegrationConnection(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });
    },
  });

  const updateConnectionApiKeyMutation = useMutation({
    mutationFn: async (payload: { connectionId: string; apiKey: string; displayName: string }) =>
      updateApiKeyIntegrationConnection(payload),
    onMutate: () => {
      setApiKeyError(undefined);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });
      setApiKeyDraft("");
      setApiKeyError(undefined);
      setEditingApiKeyConnectionId(null);
    },
    onError: (error) => {
      setApiKeyError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update connection.",
        }),
      );
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: async (payload: { connectionId: string }) => deleteIntegrationConnection(payload),
    onMutate: () => {
      setDeleteError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });
      setDeleteError(null);
      setDeletingConnectionId(null);
    },
    onError: (error) => {
      setDeleteError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not delete connection.",
        }),
      );
    },
  });

  const startProviderAppSetupMutation = useMutation({
    mutationFn: async (payload: {
      connectionId: string;
      routeSegment: string;
      startErrorMessage: string;
      unexpectedResultMessage: string;
    }) => startRedirectProviderAppSetup(payload),
  });

  const editingApiKeyConnection =
    input.connections.find((connection) => connection.id === editingApiKeyConnectionId) ?? null;
  const deletingConnection =
    input.connections.find((connection) => connection.id === deletingConnectionId) ?? null;

  return {
    editingApiKeyConnection,
    apiKeyDialog: {
      connectionDisplayName: editingApiKeyConnection?.displayName ?? "",
      ...(apiKeyError === undefined ? {} : { errorMessage: apiKeyError }),
      isOpen: editingApiKeyConnection !== null,
      isPending: updateConnectionApiKeyMutation.isPending,
      onClose: () => {
        if (updateConnectionApiKeyMutation.isPending) {
          return;
        }
        setEditingApiKeyConnectionId(null);
        setApiKeyDraft("");
        setApiKeyError(undefined);
      },
      onSubmit: () => {
        if (editingApiKeyConnection === null) {
          throw new Error("Editing API key connection is required.");
        }

        const normalizedApiKey = apiKeyDraft.trim();
        if (normalizedApiKey.length === 0) {
          return;
        }

        updateConnectionApiKeyMutation.mutate({
          connectionId: editingApiKeyConnection.id,
          apiKey: normalizedApiKey,
          displayName: editingApiKeyConnection.displayName,
        });
      },
      onValueChange: (nextValue: string) => {
        setApiKeyDraft(nextValue);
        setApiKeyError(undefined);
      },
      value: apiKeyDraft,
    },
    deleteDialog: {
      connectionName: deletingConnection?.displayName ?? "",
      errorMessage: deleteError,
      isOpen: deletingConnection !== null,
      isPending: deleteConnectionMutation.isPending,
      onConfirm: () => {
        if (deletingConnection === null) {
          throw new Error("Deleting connection is required.");
        }

        deleteConnectionMutation.mutate({
          connectionId: deletingConnection.id,
        });
      },
      onOpenChange: (open: boolean) => {
        if (deleteConnectionMutation.isPending) {
          return;
        }

        if (!open) {
          setDeletingConnectionId(null);
          setDeleteError(null);
        }
      },
    },
    onDeleteConnection: (connectionId: string) => {
      setDeletingConnectionId(connectionId);
      setDeleteError(null);
    },
    onEditApiKey: (connectionId: string) => {
      setEditingApiKeyConnectionId(connectionId);
      setApiKeyDraft("");
      setApiKeyError(undefined);
    },
    providerAppSetup: {
      errorMessageByConnectionId: providerAppSetupErrorByConnectionId,
      pendingConnectionId: startProviderAppSetupMutation.isPending
        ? (startProviderAppSetupMutation.variables?.connectionId ?? null)
        : null,
      onStartInstallation: async (connectionId: string) => {
        const startAction = resolveProviderAppSetupStartActionOrThrow({
          connectionId,
          connections: input.connections,
          connectionMethods: input.connectionMethods,
        });
        setProviderAppSetupErrorByConnectionId((current) => ({
          ...current,
          [connectionId]: undefined,
        }));

        const authorizationWindow = openDeferredExternalWindow({
          loadingMessage: startAction.windowTitle,
          title: startAction.windowTitle,
        });
        if (authorizationWindow === null) {
          setProviderAppSetupErrorByConnectionId((current) => ({
            ...current,
            [connectionId]: "Browser blocked opening a new window.",
          }));
          return;
        }

        try {
          const startedInstallation = await startProviderAppSetupMutation.mutateAsync({
            connectionId,
            routeSegment: startAction.routeSegment,
            startErrorMessage: startAction.startErrorMessage,
            unexpectedResultMessage: startAction.unexpectedResultMessage,
          });
          authorizationWindow.navigate(startedInstallation.authorizationUrl);
        } catch (error) {
          authorizationWindow.close();
          const errorMessage = resolveApiErrorMessage({
            error,
            fallbackMessage: startAction.startErrorMessage,
          });

          setProviderAppSetupErrorByConnectionId((current) => ({
            ...current,
            [connectionId]: errorMessage,
          }));
        }
      },
    },
    titleEditor:
      input.connections.length === 0
        ? undefined
        : {
            disabled: updateConnectionNameMutation.isPending,
            errorMessageByConnectionId: connectionNameErrorMessageById,
            onStartEditing: (connectionId: string) => {
              setConnectionNameErrorMessageById((current) => ({
                ...current,
                [connectionId]: undefined,
              }));
            },
            onSave: async (connectionId: string, draftValue: string) => {
              const editingConnection =
                input.connections.find((connection) => connection.id === connectionId) ?? null;
              if (editingConnection === null) {
                throw new Error("Editing connection is required.");
              }

              if (draftValue === editingConnection.displayName) {
                return;
              }

              setConnectionNameErrorMessageById((current) => ({
                ...current,
                [connectionId]: undefined,
              }));

              try {
                await updateConnectionNameMutation.mutateAsync({
                  connectionId: editingConnection.id,
                  displayName: draftValue,
                });
              } catch (error) {
                const errorMessage = resolveApiErrorMessage({
                  error,
                  fallbackMessage: "Could not update connection.",
                });

                setConnectionNameErrorMessageById((current) => ({
                  ...current,
                  [connectionId]: errorMessage,
                }));
                throw new Error(errorMessage);
              }
            },
          },
  };
}
