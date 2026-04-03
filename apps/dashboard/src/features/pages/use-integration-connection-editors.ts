import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  deleteIntegrationConnection,
  updateApiKeyIntegrationConnection,
  updateIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { useAutoSaveAction } from "../shared/use-auto-save-action.js";

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
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const updateConnectionNameAction = useAutoSaveAction({
    save: async (payload: { connectionId: string; displayName: string }) => {
      await updateIntegrationConnection(payload);
    },
    afterSave: async () => {
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
    titleEditor:
      input.connections.length === 0
        ? undefined
        : {
            disabled: updateConnectionNameAction.isSaving,
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
              updateConnectionNameAction.clearError();

              try {
                await updateConnectionNameAction.run({
                  connectionId: editingConnection.id,
                  displayName: draftValue,
                });
              } catch (error) {
                const errorMessage =
                  error instanceof Error ? error.message : updateConnectionNameAction.errorMessage;

                setConnectionNameErrorMessageById((current) => ({
                  ...current,
                  [connectionId]: errorMessage ?? undefined,
                }));
                if (error instanceof Error) {
                  throw error;
                }

                throw error;
              }
            },
          },
  };
}
