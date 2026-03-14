import { useMutation, useMutationState, useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import {
  listIntegrationConnectionResources,
  listIntegrationDirectory,
  refreshIntegrationConnectionResources,
  type IntegrationConnection,
} from "../integrations/integrations-service.js";
import {
  buildIntegrationConnectionResourceItemsByKey,
  buildIntegrationConnectionResourceRequests,
  createRefreshingResourceKey,
  shouldPollIntegrationDetailResources,
} from "./integrations-page-view-model.js";

type IntegrationDirectoryData = Awaited<ReturnType<typeof listIntegrationDirectory>>;

const RefreshIntegrationConnectionResourcesMutationKey = [
  "settings",
  "integrations",
  "refresh-resource",
] as const;

export const SETTINGS_INTEGRATION_CONNECTION_RESOURCES_QUERY_KEY_PREFIX: readonly [
  "settings",
  "integrations",
  "connection-resources",
] = ["settings", "integrations", "connection-resources"];

function isRefreshResourceMutationVariables(
  value: unknown,
): value is { connectionId: string; kind: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("connectionId" in value) || typeof value.connectionId !== "string") {
    return false;
  }

  return "kind" in value && typeof value.kind === "string";
}

export function shouldPollIntegrationDirectory(input: {
  activeDetailConnectionId: string | null;
  detailTargetKey: string | null;
  directoryData: IntegrationDirectoryData | undefined;
}): boolean {
  if (input.directoryData === undefined) {
    return false;
  }

  return shouldPollIntegrationDetailResources({
    cards: buildIntegrationCards(input.directoryData),
    activeDetailConnectionId: input.activeDetailConnectionId,
    detailTargetKey: input.detailTargetKey,
  });
}

export function useIntegrationResourceState(input: {
  detailConnections: readonly IntegrationConnection[];
  queryKey: readonly ["settings", "integrations", "directory"];
}) {
  const queryClient = useQueryClient();

  const refreshResourceMutation = useMutation({
    mutationKey: RefreshIntegrationConnectionResourcesMutationKey,
    mutationFn: async (payload: { connectionId: string; kind: string }) =>
      refreshIntegrationConnectionResources(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: input.queryKey,
      });
      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATION_CONNECTION_RESOURCES_QUERY_KEY_PREFIX,
      });
    },
  });

  const pendingRefreshMutationVariables = useMutationState<unknown>({
    filters: {
      mutationKey: RefreshIntegrationConnectionResourcesMutationKey,
      status: "pending",
    },
    select: (mutation) => mutation.state.variables,
  });

  const refreshingResourceKeys = useMemo(() => {
    return new Set<string>(
      pendingRefreshMutationVariables
        .filter(isRefreshResourceMutationVariables)
        .map(createRefreshingResourceKey),
    );
  }, [pendingRefreshMutationVariables]);

  const resourceRequests = useMemo(
    () => buildIntegrationConnectionResourceRequests(input.detailConnections),
    [input.detailConnections],
  );

  const resourceQueries = useQueries({
    queries: resourceRequests.map((resource) => ({
      queryKey: [
        ...SETTINGS_INTEGRATION_CONNECTION_RESOURCES_QUERY_KEY_PREFIX,
        resource.connectionId,
        resource.kind,
      ],
      queryFn: async ({ signal }) =>
        listIntegrationConnectionResources({
          connectionId: resource.connectionId,
          kind: resource.kind,
          signal,
        }),
      retry: false,
      refetchInterval: resource.syncState === "syncing" ? 3_000 : false,
    })),
  });

  const resourceItemsByKey = useMemo(
    () =>
      buildIntegrationConnectionResourceItemsByKey(
        resourceRequests.map((resource, index) => {
          const query = resourceQueries[index];

          return {
            connectionId: resource.connectionId,
            state: {
              errorMessage:
                query?.isError === true
                  ? resolveApiErrorMessage({
                      error: query.error,
                      fallbackMessage: `Could not load ${resource.kind}.`,
                    })
                  : null,
              isLoading: query?.isPending ?? false,
              items: query?.data?.items ?? [],
              kind: resource.kind,
            },
          };
        }),
      ),
    [resourceQueries, resourceRequests],
  );

  return {
    onRefreshResource: refreshResourceMutation.mutate,
    refreshingResourceKeys,
    resourceItemsByKey,
  };
}
