import type { QueryClient } from "@tanstack/react-query";

import { sandboxInstanceStatusQueryKey } from "./sessions-query-keys.js";
import type { PatchSandboxInstanceTitleResult } from "./sessions-service.js";
import type { SandboxInstancesListResult } from "./sessions-types.js";

export type SandboxInstanceStatusSummary = {
  title: string | null;
};

export function resolveCachedSessionStatus(
  queryClient: QueryClient,
  sandboxInstanceId: string,
): SandboxInstanceStatusSummary | null {
  return (
    queryClient.getQueryData<SandboxInstanceStatusSummary>(
      sandboxInstanceStatusQueryKey(sandboxInstanceId),
    ) ?? null
  );
}

export function applyPatchedSessionTitleToCache(
  queryClient: QueryClient,
  patchedTitle: PatchSandboxInstanceTitleResult,
): void {
  queryClient.setQueryData<SandboxInstanceStatusSummary>(
    sandboxInstanceStatusQueryKey(patchedTitle.id),
    (currentStatus) => {
      if (currentStatus === undefined) {
        return {
          title: patchedTitle.title,
        };
      }

      return {
        ...currentStatus,
        title: patchedTitle.title,
      };
    },
  );

  const cachedLists = queryClient.getQueriesData<SandboxInstancesListResult>({
    queryKey: ["sandbox-instances", "list"],
  });
  for (const [queryKey] of cachedLists) {
    queryClient.setQueryData<SandboxInstancesListResult>(queryKey, (currentList) => {
      if (currentList === undefined) {
        return undefined;
      }

      let didPatchItem = false;
      const items = currentList.items.map((item) => {
        if (item.id !== patchedTitle.id) {
          return item;
        }

        didPatchItem = true;
        return {
          ...item,
          title: patchedTitle.title,
          updatedAt: patchedTitle.updatedAt,
        };
      });

      if (!didPatchItem) {
        return currentList;
      }

      return {
        ...currentList,
        items,
      };
    });
  }
}
