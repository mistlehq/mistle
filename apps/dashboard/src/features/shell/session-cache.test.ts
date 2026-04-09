import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  createAuthenticatedSessionForOrganization,
  seedAuthenticatedSession,
} from "../../test-support/auth-session.js";
import { clearAuthenticatedSessionCache } from "./session-cache.js";
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
});
