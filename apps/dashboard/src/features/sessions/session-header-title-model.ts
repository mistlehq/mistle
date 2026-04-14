import type { QueryClient } from "@tanstack/react-query";

import { resolveSessionTitleLabel } from "./session-title-presentation.js";
import { sandboxInstanceStatusQueryKey } from "./sessions-query-keys.js";
import type { PatchSandboxInstanceTitleResult } from "./sessions-service.js";

export type SandboxInstanceStatusSummary = {
  title: string | null;
};

export function resolveSessionHeaderTitleDisplayText(title: string | null): string {
  return resolveSessionTitleLabel(title);
}

export function resolveSessionHeaderTitleInputValue(title: string | null): string {
  return title ?? "";
}

export function validateSessionHeaderTitle(title: string): string | null {
  return title.trim().length > 0 ? null : "Session title is required.";
}

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
