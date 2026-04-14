import { OverflowTooltipText } from "@mistle/ui";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useMatch } from "react-router";

import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import { AppBreadcrumbs } from "./app-breadcrumbs.js";
import { useAppPageMeta } from "./route-meta.js";

type SandboxInstanceStatusSummary = {
  title: string | null;
};

export function AppHeaderLeading(): React.JSX.Element | null {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const sessionDetailMatch = useMatch("/sessions/:sandboxInstanceId");
  const sandboxInstanceId =
    pageMeta.title === "Session" ? (sessionDetailMatch?.params["sandboxInstanceId"] ?? null) : null;
  const cachedSessionStatus = useSyncExternalStore(
    (onStoreChange) => {
      return queryClient.getQueryCache().subscribe(() => {
        onStoreChange();
      });
    },
    () => resolveCachedSessionStatus(queryClient, sandboxInstanceId),
    () => resolveCachedSessionStatus(queryClient, sandboxInstanceId),
  );

  if (sandboxInstanceId === null) {
    return <AppBreadcrumbs />;
  }

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

function createSandboxInstanceStatusQueryKey(
  sandboxInstanceId: string | null,
): readonly ["sandbox-instance-status", string | null] {
  return ["sandbox-instance-status", sandboxInstanceId];
}

function resolveCachedSessionStatus(
  queryClient: QueryClient,
  sandboxInstanceId: string | null,
): SandboxInstanceStatusSummary | null {
  if (sandboxInstanceId === null) {
    return null;
  }

  return (
    queryClient.getQueryData<SandboxInstanceStatusSummary>(
      createSandboxInstanceStatusQueryKey(sandboxInstanceId),
    ) ?? null
  );
}
