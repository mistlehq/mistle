import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";

import { buildIntegrationCards } from "../integrations/directory-model.js";
import {
  listIntegrationDirectory,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import {
  createIntegrationConnectionResourceKey,
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

function createRefreshingResourceKeys(pendingMutationVariables: readonly unknown[]): Set<string> {
  return new Set<string>(
    pendingMutationVariables
      .filter(isRefreshResourceMutationVariables)
      .map(createIntegrationConnectionResourceKey),
  );
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

  const refreshingResourceKeys = createRefreshingResourceKeys(pendingRefreshMutationVariables);

  return {
    onRefreshResource: refreshResourceMutation.mutate,
    refreshingResourceKeys,
  };
}
