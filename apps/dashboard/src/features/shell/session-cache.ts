import type { QueryClient } from "@tanstack/react-query";

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
  input.queryClient.clear();

  return input.queryClient.fetchQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: input.fetchSessionData,
  });
}
