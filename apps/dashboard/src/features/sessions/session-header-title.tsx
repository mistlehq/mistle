import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import {
  applyPatchedSessionTitleToCache,
  resolveCachedSessionStatus,
} from "./session-header-title-model.js";
import { sandboxInstanceStatusQueryKey } from "./sessions-query-keys.js";
import { patchSandboxInstanceTitle } from "./sessions-service.js";

export function SessionHeaderTitle(input: { sandboxInstanceId: string }): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const cachedSessionStatus = useSyncExternalStore(
    (onStoreChange) => {
      return queryClient.getQueryCache().subscribe(() => {
        onStoreChange();
      });
    },
    () => resolveCachedSessionStatus(queryClient, input.sandboxInstanceId),
    () => resolveCachedSessionStatus(queryClient, input.sandboxInstanceId),
  );
  const patchTitleMutation = useMutation({
    mutationFn: async (title: string) => {
      return patchSandboxInstanceTitle({
        instanceId: input.sandboxInstanceId,
        title,
      });
    },
    onSuccess: async (patchedTitle) => {
      applyPatchedSessionTitleToCache(queryClient, patchedTitle);
      await queryClient.invalidateQueries({
        queryKey: sandboxInstanceStatusQueryKey(patchedTitle.id),
        exact: true,
      });
    },
  });

  if (cachedSessionStatus === null) {
    return null;
  }

  return (
    <AutoSaveTitleHeading
      ariaLabel="Session title"
      size="sm"
      emptyDisplayText="Untitled"
      inputClassName="truncate"
      maxWidthClassName="max-w-[28rem] flex-1"
      onSave={async (title) => {
        await patchTitleMutation.mutateAsync(title);
      }}
      requiredLabel="Session title"
      value={cachedSessionStatus.title}
      {...(patchTitleMutation.error instanceof Error
        ? { errorMessage: patchTitleMutation.error.message }
        : {})}
    />
  );
}
