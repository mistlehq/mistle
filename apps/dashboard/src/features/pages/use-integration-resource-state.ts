import {
  type QueryClient,
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";

import { buildIntegrationCards } from "../integrations/directory-model.js";
import {
  listIntegrationDirectory,
  refreshAllIntegrationConnectionResources,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import {
  createIntegrationConnectionResourceKey,
  shouldPollIntegrationDetailResources,
} from "./integrations-page-view-model.js";

type IntegrationDirectoryData = Awaited<ReturnType<typeof listIntegrationDirectory>>;

const RefreshIntegrationConnectionResourcesMutationKey: readonly [
  "settings",
  "integrations",
  "refresh-resource",
] = ["settings", "integrations", "refresh-resource"];

const RefreshAllIntegrationConnectionResourcesMutationKey: readonly [
  "settings",
  "integrations",
  "refresh-all-resources",
] = ["settings", "integrations", "refresh-all-resources"];

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

function isRefreshAllResourceMutationVariables(value: unknown): value is { connectionId: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return "connectionId" in value && typeof value.connectionId === "string";
}

function createRefreshingResourceKeys(pendingMutationVariables: readonly unknown[]): Set<string> {
  return new Set<string>(
    pendingMutationVariables
      .filter(isRefreshResourceMutationVariables)
      .map(createIntegrationConnectionResourceKey),
  );
}

function createRefreshingConnectionIds(pendingMutationVariables: readonly unknown[]): Set<string> {
  return new Set<string>(
    pendingMutationVariables
      .filter(isRefreshAllResourceMutationVariables)
      .map((variables) => variables.connectionId),
  );
}

async function invalidateIntegrationResourceQueries(input: {
  queryClient: QueryClient;
  queryKey: readonly ["settings", "integrations", "directory"];
}): Promise<void> {
  await input.queryClient.invalidateQueries({
    queryKey: input.queryKey,
  });
  await input.queryClient.invalidateQueries({
    queryKey: SETTINGS_INTEGRATION_CONNECTION_RESOURCES_QUERY_KEY_PREFIX,
  });
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
      await invalidateIntegrationResourceQueries({
        queryClient,
        queryKey: input.queryKey,
      });
    },
  });

  const refreshAllResourcesMutation = useMutation({
    mutationKey: RefreshAllIntegrationConnectionResourcesMutationKey,
    mutationFn: async (payload: { connectionId: string }) =>
      refreshAllIntegrationConnectionResources(payload),
    onSuccess: async () => {
      await invalidateIntegrationResourceQueries({
        queryClient,
        queryKey: input.queryKey,
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

  const pendingRefreshAllMutationVariables = useMutationState<unknown>({
    filters: {
      mutationKey: RefreshAllIntegrationConnectionResourcesMutationKey,
      status: "pending",
    },
    select: (mutation) => mutation.state.variables,
  });

  const refreshingResourceKeys = createRefreshingResourceKeys(pendingRefreshMutationVariables);
  const refreshingConnectionIds = createRefreshingConnectionIds(pendingRefreshAllMutationVariables);

  return {
    onRefreshAllResources: refreshAllResourcesMutation.mutate,
    onRefreshResource: refreshResourceMutation.mutate,
    refreshingConnectionIds,
    refreshingResourceKeys,
  };
}
