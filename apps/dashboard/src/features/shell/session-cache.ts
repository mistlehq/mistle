import type { QueryClient, QueryKey } from "@tanstack/react-query";

import type { SessionData } from "../auth/types.js";
import { SESSION_QUERY_KEY } from "./session-query-key.js";

export function clearAuthenticatedSessionCache(queryClient: QueryClient): void {
  queryClient.clear();
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
}

export async function refreshAuthenticatedSessionAfterOrganizationSwitch(input: {
  queryClient: QueryClient;
  fetchSessionData: () => Promise<SessionData>;
}): Promise<SessionData> {
  removeNonSessionQueries(input.queryClient);
  await input.queryClient.cancelQueries({
    exact: true,
    queryKey: SESSION_QUERY_KEY,
  });
  await input.queryClient.invalidateQueries({
    exact: true,
    queryKey: SESSION_QUERY_KEY,
  });
  return input.queryClient.fetchQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: input.fetchSessionData,
    staleTime: 0,
  });
}

function removeNonSessionQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => !isSessionQueryKey(query.queryKey),
  });
}

function isSessionQueryKey(queryKey: QueryKey): boolean {
  return (
    queryKey.length === SESSION_QUERY_KEY.length &&
    queryKey.every((entry, index) => entry === SESSION_QUERY_KEY[index])
  );
}
