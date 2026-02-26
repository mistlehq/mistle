import type { SessionData } from "../auth/types.js";

type AuthenticatedSession = Exclude<SessionData, null>;

export const MISSING_AUTHENTICATED_SESSION_ERROR_MESSAGE =
  "Authenticated session is unavailable. Render this page under <RequireAuth />.";

export function requireAuthenticatedSession(session: SessionData): AuthenticatedSession {
  if (session === null) {
    throw new Error(MISSING_AUTHENTICATED_SESSION_ERROR_MESSAGE);
  }

  return session;
}
