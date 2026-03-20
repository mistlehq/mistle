import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  updateApiKeyIntegrationConnection,
  updateIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";

export function useIntegrationConnectionEditors(input: {
  connections: readonly IntegrationConnection[];
  queryKey: readonly ["settings", "integrations", "directory"];
}) {
  const queryClient = useQueryClient();
  const [editingConnectionNameId, setEditingConnectionNameId] = useState<string | null>(null);
  const [connectionNameError, setConnectionNameError] = useState<string | undefined>(undefined);
  const [editingApiKeyConnectionId, setEditingApiKeyConnectionId] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | undefined>(undefined);

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

  const editingApiKeyConnection =
    input.connections.find((connection) => connection.id === editingApiKeyConnectionId) ?? null;

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
    onEditApiKey: (connectionId: string) => {
      setEditingApiKeyConnectionId(connectionId);
      setApiKeyDraft("");
      setApiKeyError(undefined);
    },
    titleEditor:
      input.connections.length === 0
        ? undefined
        : {
            connectionIdWithError: editingConnectionNameId,
            ...(connectionNameError === undefined ? {} : { errorMessage: connectionNameError }),
            onCommit: (connectionId: string, draftValue: string) => {
              const editingConnection =
                input.connections.find((connection) => connection.id === connectionId) ?? null;
              if (editingConnection === null) {
                throw new Error("Editing connection is required.");
              }

              const normalizedDraft = draftValue.trim();
              if (normalizedDraft.length === 0) {
                setEditingConnectionNameId(connectionId);
                setConnectionNameError("Connection name is required.");
                return;
              }

              if (normalizedDraft === editingConnection.displayName) {
                setEditingConnectionNameId(null);
                setConnectionNameError(undefined);
                return;
              }

              setEditingConnectionNameId(connectionId);
              setConnectionNameError(undefined);
              updateConnectionNameMutation.mutate(
                {
                  connectionId: editingConnection.id,
                  displayName: normalizedDraft,
                },
                {
                  onError: (error) => {
                    setConnectionNameError(
                      resolveApiErrorMessage({
                        error,
                        fallbackMessage: "Could not update connection.",
                      }),
                    );
                  },
                  onSuccess: () => {
                    setEditingConnectionNameId(null);
                    setConnectionNameError(undefined);
                  },
                },
              );
            },
            onEditStart: () => {
              setEditingConnectionNameId(null);
              setConnectionNameError(undefined);
            },
            onEditCancel: () => {
              setEditingConnectionNameId(null);
              setConnectionNameError(undefined);
            },
            saveDisabled: updateConnectionNameMutation.isPending,
          },
  };
}
