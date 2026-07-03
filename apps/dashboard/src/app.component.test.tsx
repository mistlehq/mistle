// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "./app.js";
import type { AuthenticatedSessionData } from "./features/auth/types.js";
import { SESSION_QUERY_KEY } from "./features/shell/session-query.js";
import { createTestQueryClient } from "./test-support/query-client.js";

const AuthenticatedSession = {
  session: {
    activeOrganizationId: "org_test",
  },
  user: {
    id: "usr_test",
    name: "Test User",
    email: "test@example.com",
    appearance: "system",
  },
} satisfies AuthenticatedSessionData;

describe("app routes", () => {
  it.each(["/designer", "/not-a-designer-session", "/dsn_", "/dsn_!"])(
    "redirects invalid single-segment path %s to home",
    async (initialPath) => {
      const router = renderAuthenticatedAppRoute(initialPath);

      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/");
      });
    },
  );
});

function renderAuthenticatedAppRoute(initialPath: string): ReturnType<typeof createMemoryRouter> {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    retryOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  queryClient.setQueryData(SESSION_QUERY_KEY, AuthenticatedSession);
  const router = createMemoryRouter(APP_ROUTES, { initialEntries: [initialPath] });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
}
