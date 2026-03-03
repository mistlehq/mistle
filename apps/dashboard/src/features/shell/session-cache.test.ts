import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { clearAuthenticatedSessionCache } from "./session-cache.js";
import { SESSION_QUERY_KEY } from "./session-query-key.js";

describe("clearAuthenticatedSessionCache", () => {
  it("clears existing query cache entries and seeds null authenticated session", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["settings", "members", "org_123"], [{ id: "mem_1" }]);
    queryClient.setQueryData(["integrations", "org_123"], [{ id: "github" }]);
    queryClient.setQueryData(SESSION_QUERY_KEY, {
      user: {
        id: "user_123",
        email: "owner@mistle.local",
      },
      session: {
        activeOrganizationId: "org_123",
      },
    });

    clearAuthenticatedSessionCache(queryClient);

    expect(queryClient.getQueryData(["settings", "members", "org_123"])).toBeUndefined();
    expect(queryClient.getQueryData(["integrations", "org_123"])).toBeUndefined();
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
  });
});
