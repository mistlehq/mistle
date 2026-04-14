import { OverflowTooltipText } from "@mistle/ui";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useMatch } from "react-router";

import type { SandboxInstancesListResult } from "../sessions/sessions-types.js";
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
  const cachedSessionListTitle =
    sandboxInstanceId === null
      ? null
      : resolveCachedSessionListTitle({
          queryClient,
          sandboxInstanceId,
        });
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

  return (
    <OverflowTooltipText
      ariaLabel="Session title"
      className="text-sm font-medium"
      containerClassName="max-w-[28rem] flex-1"
      text={resolveSessionHeaderTitle(cachedSessionStatus?.title ?? cachedSessionListTitle)}
      tooltipSide="bottom"
    />
  );
}

function resolveCachedSessionListTitle(input: {
  queryClient: QueryClient;
  sandboxInstanceId: string;
}): string | null {
  const cachedLists = input.queryClient.getQueriesData<SandboxInstancesListResult>({
    queryKey: ["sandbox-instances", "list"],
  });

  for (const [, listResult] of cachedLists) {
    const matchedItem = listResult?.items.find((item) => item.id === input.sandboxInstanceId);
    if (matchedItem?.title !== null && matchedItem?.title !== undefined) {
      return matchedItem.title;
    }
  }

  return null;
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

function resolveSessionHeaderTitle(title: string | null | undefined): string {
  if (title === null || title === undefined || title.trim().length === 0) {
    return "Untitled";
  }

  return title;
}
