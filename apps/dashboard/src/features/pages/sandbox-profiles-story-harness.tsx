import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { sandboxProfilesListQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { SandboxProfilesListResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SandboxProfilesPage } from "./sandbox-profiles-page.js";

type SandboxProfilesStoryHarnessProps = {
  initialEntries: readonly string[];
  sandboxProfilesList?: SandboxProfilesListResult;
};

export function SandboxProfilesStoryHarness(
  input: SandboxProfilesStoryHarnessProps,
): React.JSX.Element {
  const [queryClient] = useState(() => {
    const client = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    client.setQueryData(
      sandboxProfilesListQueryKey({
        limit: 20,
        after: null,
        before: null,
      }),
      input.sandboxProfilesList ?? DefaultSandboxProfilesList,
    );

    return client;
  });

  const [router] = useState(() =>
    createMemoryRouter(
      createRoutesFromElements(
        <Route element={<StoryRouteOutlet />}>
          <Route
            element={<SandboxProfilesPage />}
            handle={ROUTE_HANDLES.sandboxProfiles}
            path="/sandbox-profiles"
          >
            <Route handle={ROUTE_HANDLES.sandboxProfilesNew} path="new" />
          </Route>
        </Route>,
      ),
      {
        initialEntries: [...input.initialEntries],
      },
    ),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function StoryRouteOutlet(): React.JSX.Element {
  return <Outlet />;
}

const DefaultSandboxProfilesList: SandboxProfilesListResult = {
  items: [
    {
      createdAt: "2026-03-05T00:00:00.000Z",
      displayName: "Codex Default",
      id: "sbp_codex_default",
      organizationId: "org_123",
      status: "active",
      updatedAt: "2026-03-12T00:00:00.000Z",
    },
    {
      createdAt: "2026-03-02T00:00:00.000Z",
      displayName: "Repository Maintainer",
      id: "sbp_repo_maintainer",
      organizationId: "org_123",
      status: "active",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
  ],
  nextPage: null,
  previousPage: null,
  totalResults: 2,
};
