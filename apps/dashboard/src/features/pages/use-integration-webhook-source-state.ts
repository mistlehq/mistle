import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  createIntegrationWebhookSource,
  deleteIntegrationWebhookSource,
  listIntegrationWebhookSources,
  type IntegrationConnection,
  type IntegrationWebhookSource,
} from "../integrations/integrations-service.js";

export type IntegrationWebhookSourceSectionState = {
  createErrorMessage: string | null;
  deleteErrorMessage: string | null;
  deletingWebhookSourceId: string | null;
  isCreating: boolean;
  isLoading: boolean;
  items: readonly IntegrationWebhookSource[];
  loadErrorMessage: string | null;
  revealedWebhookSecret: string | null;
};

export const SETTINGS_INTEGRATION_WEBHOOK_SOURCES_QUERY_KEY_PREFIX: readonly [
  "settings",
  "integrations",
  "webhook-sources",
] = ["settings", "integrations", "webhook-sources"];

export function useIntegrationWebhookSourceState(input: {
  detailConnections: readonly IntegrationConnection[];
}) {
  const queryClient = useQueryClient();
  const supportedConnections = input.detailConnections.filter(
    (connection) => connection.supportsWebhookSources === true,
  );
  const [revealedWebhookSecretByConnectionId, setRevealedWebhookSecretByConnectionId] = useState(
    () => new Map<string, string>(),
  );

  const webhookSourceQueries = useQueries({
    queries: supportedConnections.map((connection) => ({
      queryKey: [...SETTINGS_INTEGRATION_WEBHOOK_SOURCES_QUERY_KEY_PREFIX, connection.id] as const,
      queryFn: async ({ signal }) =>
        listIntegrationWebhookSources({
          connectionId: connection.id,
          signal,
        }),
      retry: false,
    })),
  });

  const createWebhookSourceMutation = useMutation({
    mutationFn: async (payload: { connectionId: string }) =>
      createIntegrationWebhookSource({
        connectionId: payload.connectionId,
      }),
    onSuccess: async (createdSource, variables) => {
      setRevealedWebhookSecretByConnectionId((currentSecrets) => {
        const nextSecrets = new Map(currentSecrets);

        if (createdSource.webhookSecret === undefined) {
          nextSecrets.delete(variables.connectionId);
          return nextSecrets;
        }

        nextSecrets.set(variables.connectionId, createdSource.webhookSecret);
        return nextSecrets;
      });

      await queryClient.invalidateQueries({
        queryKey: [
          ...SETTINGS_INTEGRATION_WEBHOOK_SOURCES_QUERY_KEY_PREFIX,
          variables.connectionId,
        ],
      });
    },
  });

  const deleteWebhookSourceMutation = useMutation({
    mutationFn: async (payload: { connectionId: string; webhookSourceId: string }) =>
      deleteIntegrationWebhookSource(payload),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({
        queryKey: [
          ...SETTINGS_INTEGRATION_WEBHOOK_SOURCES_QUERY_KEY_PREFIX,
          variables.connectionId,
        ],
      });
    },
  });

  const webhookSourceStateByConnectionId = new Map<string, IntegrationWebhookSourceSectionState>(
    supportedConnections.map((connection, index) => {
      const query = webhookSourceQueries[index];
      const isCreating =
        createWebhookSourceMutation.isPending &&
        createWebhookSourceMutation.variables?.connectionId === connection.id;
      const deletingWebhookSourceId =
        deleteWebhookSourceMutation.isPending &&
        deleteWebhookSourceMutation.variables?.connectionId === connection.id
          ? deleteWebhookSourceMutation.variables.webhookSourceId
          : null;

      return [
        connection.id,
        {
          createErrorMessage:
            createWebhookSourceMutation.isError &&
            createWebhookSourceMutation.variables?.connectionId === connection.id
              ? resolveApiErrorMessage({
                  error: createWebhookSourceMutation.error,
                  fallbackMessage: "Could not create webhook source.",
                })
              : null,
          deleteErrorMessage:
            deleteWebhookSourceMutation.isError &&
            deleteWebhookSourceMutation.variables?.connectionId === connection.id
              ? resolveApiErrorMessage({
                  error: deleteWebhookSourceMutation.error,
                  fallbackMessage: "Could not delete webhook source.",
                })
              : null,
          deletingWebhookSourceId,
          isCreating,
          isLoading: query?.isPending ?? false,
          items: query?.data ?? [],
          loadErrorMessage:
            query?.isError === true
              ? resolveApiErrorMessage({
                  error: query.error,
                  fallbackMessage: "Could not load webhook sources.",
                })
              : null,
          revealedWebhookSecret: revealedWebhookSecretByConnectionId.get(connection.id) ?? null,
        },
      ] as const;
    }),
  );

  return {
    createWebhookSource: createWebhookSourceMutation.mutate,
    deleteWebhookSource: deleteWebhookSourceMutation.mutate,
    webhookSourceStateByConnectionId,
  };
}
