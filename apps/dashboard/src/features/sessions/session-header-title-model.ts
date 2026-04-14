import type { QueryClient } from "@tanstack/react-query";

import { sandboxInstanceStatusQueryKey } from "./sessions-query-keys.js";
import type { PatchSandboxInstanceTitleResult } from "./sessions-service.js";

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
}
