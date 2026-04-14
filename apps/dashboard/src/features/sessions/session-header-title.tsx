import { OverflowTooltipText } from "@mistle/ui";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { resolveSessionTitleLabel } from "./session-title-presentation.js";
import { sandboxInstanceStatusQueryKey } from "./sessions-query-keys.js";

type SandboxInstanceStatusSummary = {
  title: string | null;
};

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

  if (cachedSessionStatus === null) {
    return null;
  }

  return (
    <OverflowTooltipText
      ariaLabel="Session title"
      className="text-sm font-medium"
      containerClassName="max-w-[28rem] flex-1"
      text={resolveSessionTitleLabel(cachedSessionStatus.title)}
      tooltipSide="bottom"
    />
  );
}

function resolveCachedSessionStatus(
  queryClient: QueryClient,
  sandboxInstanceId: string,
): SandboxInstanceStatusSummary | null {
  return (
    queryClient.getQueryData<SandboxInstanceStatusSummary>(
      sandboxInstanceStatusQueryKey(sandboxInstanceId),
    ) ?? null
  );
}
