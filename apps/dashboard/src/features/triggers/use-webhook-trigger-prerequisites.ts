import { useQueries, useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  listIntegrationDirectory,
  listIntegrationWebhookSources,
} from "../integrations/integrations-service.js";
import { useTriggerSandboxProfileOptions } from "./use-trigger-sandbox-profile-options.js";
import { buildWebhookTriggerConnectionOptions } from "./webhook-trigger-option-builders.js";

export const WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY: readonly [
  "triggers",
  "integration-directory",
] = ["triggers", "integration-directory"];

export const WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX: readonly [
  "triggers",
  "webhook-sources",
] = ["triggers", "webhook-sources"];

export function useWebhookTriggerEventPrerequisites(input?: {
  enabled?: boolean;
  preservedWebhookSourceId?: string;
}) {
  const enabled = input?.enabled ?? true;
  const integrationDirectoryQuery = useQuery({
    queryKey: WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    enabled,
    retry: false,
  });

  const webhookCapableConnections =
    integrationDirectoryQuery.data?.connections.filter((connection) => {
      const target = integrationDirectoryQuery.data?.targets.find(
        (candidate) => candidate.targetKey === connection.targetKey,
      );
      return (target?.supportedWebhookEvents?.length ?? 0) > 0;
    }) ?? [];

  const webhookSourceQueries = useQueries({
    queries: webhookCapableConnections.map((connection) => ({
      queryKey: [...WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX, connection.id] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        listIntegrationWebhookSources({
          connectionId: connection.id,
          signal,
        }),
      enabled,
      retry: false,
    })),
  });

  const webhookSources = webhookSourceQueries.flatMap((query) => query.data ?? []);

  const preservedConnectionId =
    input?.preservedWebhookSourceId === undefined
      ? undefined
      : webhookSources.find((source) => source.id === input.preservedWebhookSourceId)
          ?.integrationConnectionId;

  const connectionOptions =
    integrationDirectoryQuery.data === undefined
      ? []
      : buildWebhookTriggerConnectionOptions({
          connections: integrationDirectoryQuery.data.connections,
          targets: integrationDirectoryQuery.data.targets,
          ...(preservedConnectionId === undefined ? {} : { preservedConnectionId }),
        });

  const webhookSourceError = webhookSourceQueries.find((query) => query.isError)?.error;

  const errorMessage =
    integrationDirectoryQuery.isError || webhookSourceError !== undefined
      ? resolveApiErrorMessage({
          error: integrationDirectoryQuery.error ?? webhookSourceError,
          fallbackMessage: "Could not load trigger prerequisites.",
        })
      : null;

  const directoryData =
    integrationDirectoryQuery.data === undefined
      ? undefined
      : {
          ...integrationDirectoryQuery.data,
          webhookSources,
        };

  return {
    connectionOptions,
    integrationDirectoryQuery,
    directoryData,
    errorMessage,
    isPending:
      enabled &&
      (integrationDirectoryQuery.isPending ||
        webhookSourceQueries.some((query) => query.isPending)),
  };
}

export function useWebhookTriggerPrerequisites(input?: {
  enabled?: boolean;
  preservedWebhookSourceId?: string;
}) {
  const sandboxProfiles = useTriggerSandboxProfileOptions();
  const eventPrerequisites = useWebhookTriggerEventPrerequisites(input);

  return {
    ...eventPrerequisites,
    sandboxProfileOptions: sandboxProfiles.sandboxProfileOptions,
    errorMessage: sandboxProfiles.errorMessage ?? eventPrerequisites.errorMessage,
    isPending: sandboxProfiles.isPending || eventPrerequisites.isPending,
  };
}
