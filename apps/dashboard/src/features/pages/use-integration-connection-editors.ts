import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  deleteIntegrationConnection,
  startGitHubAppInstallation,
  updateApiKeyIntegrationConnection,
  updateIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { openDeferredExternalWindow } from "../shared/external-window.js";

export function useIntegrationConnectionEditors(input: {
  connections: readonly IntegrationConnection[];
  queryKey: readonly ["settings", "integrations", "directory"];
}) {
  const queryClient = useQueryClient();
  const [connectionNameErrorMessageById, setConnectionNameErrorMessageById] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const [editingApiKeyConnectionId, setEditingApiKeyConnectionId] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | undefined>(undefined);
  const [githubAppInstallErrorByConnectionId, setGitHubAppInstallErrorByConnectionId] = useState<
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

  const startGitHubAppInstallationMutation = useMutation({
    mutationFn: async (payload: { connectionId: string }) => startGitHubAppInstallation(payload),
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
    githubAppInstallation: {
      errorMessageByConnectionId: githubAppInstallErrorByConnectionId,
      pendingConnectionId: startGitHubAppInstallationMutation.isPending
        ? (startGitHubAppInstallationMutation.variables?.connectionId ?? null)
        : null,
      onStartInstallation: async (connectionId: string) => {
        setGitHubAppInstallErrorByConnectionId((current) => ({
          ...current,
          [connectionId]: undefined,
        }));

        const authorizationWindow = openDeferredExternalWindow({
          loadingMessage: "Opening GitHub App installation...",
          title: "Opening GitHub App installation...",
        });
        if (authorizationWindow === null) {
          setGitHubAppInstallErrorByConnectionId((current) => ({
            ...current,
            [connectionId]: "Browser blocked opening a new window.",
          }));
          return;
        }

        try {
          const startedInstallation = await startGitHubAppInstallationMutation.mutateAsync({
            connectionId,
          });
          authorizationWindow.navigate(startedInstallation.authorizationUrl);
        } catch (error) {
          authorizationWindow.close();
          const errorMessage = resolveApiErrorMessage({
            error,
            fallbackMessage: "Could not start GitHub App installation.",
          });

          setGitHubAppInstallErrorByConnectionId((current) => ({
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
