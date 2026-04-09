import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  createAuthenticatedSessionForOrganization,
  seedAuthenticatedSession,
} from "../../test-support/auth-session.js";
import {
  clearAuthenticatedSessionCache,
  refreshAuthenticatedSessionAfterOrganizationSwitch,
} from "./session-cache.js";
import { SESSION_QUERY_KEY } from "./session-query-key.js";

function seedOrganizationScopedQueryState(queryClient: QueryClient, organizationId: string): void {
  queryClient.setQueryData(["settings", "members", organizationId], [{ id: "mem_1" }]);
  queryClient.setQueryData(["integrations", organizationId], [{ id: "github" }]);
}

describe("clearAuthenticatedSessionCache", () => {
  it("clears existing query cache entries and seeds null authenticated session", () => {
    const queryClient = new QueryClient();
    seedOrganizationScopedQueryState(queryClient, "org_123");
    seedAuthenticatedSession(
      queryClient,
      createAuthenticatedSessionForOrganization("org_123", {
        user: {
          id: "user_123",
          name: "Owner",
          email: "owner@mistle.local",
        },
      }),
    );

    clearAuthenticatedSessionCache(queryClient);

    expect(queryClient.getQueryData(["settings", "members", "org_123"])).toBeUndefined();
    expect(queryClient.getQueryData(["integrations", "org_123"])).toBeUndefined();
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
  });

  it("clears org-scoped state and reloads the authenticated session after an organization switch", async () => {
    const queryClient = new QueryClient();
    const previousSession = createAuthenticatedSessionForOrganization("org_123");
    const refreshedSession = createAuthenticatedSessionForOrganization("org_456");

    seedOrganizationScopedQueryState(queryClient, "org_123");
    queryClient.setQueryData(["auth", "organizations"], [{ id: "org_123", name: "Acme" }]);
    seedAuthenticatedSession(queryClient, previousSession);

    const session = await refreshAuthenticatedSessionAfterOrganizationSwitch({
      queryClient,
      fetchSessionData: async () => refreshedSession,
    });

    expect(queryClient.getQueryData(["settings", "members", "org_123"])).toBeUndefined();
    expect(queryClient.getQueryData(["auth", "organizations"])).toBeUndefined();
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual(refreshedSession);
    expect(session).toEqual(refreshedSession);
  });

  it("preserves the current authenticated session until the refreshed session resolves", async () => {
    const queryClient = new QueryClient();
    const previousSession = createAuthenticatedSessionForOrganization("org_123");
    const refreshedSession = createAuthenticatedSessionForOrganization("org_456");
    let resolveSessionRefresh:
      | ((value: ReturnType<typeof createAuthenticatedSessionForOrganization>) => void)
      | undefined;

    seedOrganizationScopedQueryState(queryClient, "org_123");
    seedAuthenticatedSession(queryClient, previousSession);
    const pendingSessionRefresh = new Promise<
      ReturnType<typeof createAuthenticatedSessionForOrganization>
    >((resolve) => {
      resolveSessionRefresh = resolve;
    });

    const refreshPromise = refreshAuthenticatedSessionAfterOrganizationSwitch({
      queryClient,
      fetchSessionData: () => pendingSessionRefresh,
    });

    expect(queryClient.getQueryData(["settings", "members", "org_123"])).toBeUndefined();
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual(previousSession);

    if (resolveSessionRefresh === undefined) {
      throw new Error("Expected session refresh promise to be pending.");
    }

    const completeSessionRefresh = resolveSessionRefresh;
    completeSessionRefresh(refreshedSession);

    await expect(refreshPromise).resolves.toEqual(refreshedSession);
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toEqual(refreshedSession);
  });
});
