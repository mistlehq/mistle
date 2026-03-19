import { useQueryClient } from "@tanstack/react-query";

import type { SessionData } from "../auth/types.js";
import { SESSION_QUERY_KEY } from "./session-query-key.js";

type AuthenticatedSession = Exclude<SessionData, null>;

export const MISSING_AUTHENTICATED_SESSION_ERROR_MESSAGE =
  "Authenticated session is unavailable. Render this page under <RequireAuth />.";

export function requireAuthenticatedSession(session: SessionData): AuthenticatedSession {
  if (session === null) {
    throw new Error(MISSING_AUTHENTICATED_SESSION_ERROR_MESSAGE);
  }

  return session;
}

export function useCachedRequiredSession(): AuthenticatedSession {
  const queryClient = useQueryClient();
  return requireAuthenticatedSession(
    queryClient.getQueryData<SessionData>(SESSION_QUERY_KEY) ?? null,
  );
}
