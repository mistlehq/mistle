import type { QueryClient } from "@tanstack/react-query";

import type { SessionData } from "../features/auth/types.js";
import { SESSION_QUERY_KEY } from "../features/shell/session-query-key.js";

type AuthenticatedSession = Exclude<SessionData, null>;

export function createAuthenticatedSessionFixture(
  overrides: Partial<AuthenticatedSession> = {},
): AuthenticatedSession {
  return {
    session: {
      id: "session-id",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      expiresAt: new Date("2026-03-02T00:00:00.000Z"),
      token: "token",
      userId: "user-id",
      activeOrganizationId: "org_123",
      ...(overrides.session ?? {}),
    },
    user: {
      id: "user-id",
      name: "Mistle User",
      email: "mistle@example.com",
      emailVerified: true,
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      image: null,
      ...(overrides.user ?? {}),
    },
    ...overrides,
  };
}

export function seedAuthenticatedSession(queryClient: QueryClient): void {
  queryClient.setQueryData(SESSION_QUERY_KEY, createAuthenticatedSessionFixture());
}
