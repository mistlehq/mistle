import { useQuery } from "@tanstack/react-query";

import type { SessionData } from "../auth/types.js";

import { authClient } from "../../lib/auth/client.js";
import { SESSION_QUERY_KEY } from "./session-query-key.js";
import { resolveSessionFromAuthPayload } from "./session-query-result.js";

export { SESSION_QUERY_KEY } from "./session-query-key.js";

export async function fetchSession(): Promise<SessionData> {
  const response = await authClient.getSession();
  return resolveSessionFromAuthPayload({
    data: response.data,
    error: response.error,
  });
}

export function useSessionQuery() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
}
