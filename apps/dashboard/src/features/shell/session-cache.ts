import type { QueryClient } from "@tanstack/react-query";

import { SESSION_QUERY_KEY } from "./session-query-key.js";

export function clearAuthenticatedSessionCache(queryClient: QueryClient): void {
  queryClient.clear();
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
}
