// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTestQueryClients, createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import { IntegrationConnectionSetupPage } from "./integration-connection-setup-page.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

const GitHubTarget: IntegrationTarget = {
  targetKey: "github-cloud",
  familyId: "github",
  variantId: "github-cloud",
  kind: "git",
  enabled: true,
  config: {},
  displayName: "GitHub",
  description: "GitHub integration",
  connectionMethods: [
    {
      id: "github-app-installation",
      label: "GitHub App installation",
      kind: "form",
      createBehavior: "draft-then-setup",
      setupFlow: {
        routeSegment: "github-app",
        completionRequirements: {
          kind: "any-of",
          anyOf: [
            {
              kind: "config-field",
              field: "installation_id",
            },
            {
              kind: "connection-external-subject",
            },
          ],
        },
      },
      secretFields: [
        {
          name: "webhookSecret",
          label: "Webhook secret",
          inputType: "password",
        },
      ],
    },
  ],
  targetHealth: {
    configStatus: "valid",
  },
};

const InstalledGitHubConnection: IntegrationConnection = {
  id: "icn_github_installed",
  targetKey: "github-cloud",
  displayName: "Engineering GitHub",
  status: "active",
  connectionMethodId: "github-app-installation",
  connectionMethodLabel: "GitHub App installation",
  config: {
    connection_method: "github-app-installation",
    installation_id: "12345",
  },
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

function LocationProbe(): React.JSX.Element {
  const location = useLocation();

  return <div>Current location: {`${location.pathname}${location.search}`}</div>;
}

describe("IntegrationConnectionSetupPage", () => {
  afterEach(async () => {
    await cleanupTestQueryClients();
  });

  it("redirects completed setup routes to the integration detail page", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [GitHubTarget],
      connections: [InstalledGitHubConnection],
    });
    const router = createMemoryRouter(
      [
        {
          path: "/integrations/:targetKey/:connectionId/:setupRouteSegment/setup",
          element: <IntegrationConnectionSetupPage />,
        },
        {
          path: "/integrations/:targetKey",
          element: <LocationProbe />,
        },
      ],
      {
        initialEntries: ["/integrations/github-cloud/icn_github_installed/github-app/setup"],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Current location: /integrations/github-cloud?connectionId=icn_github_installed",
        ),
      ).toBeTruthy();
    });
  });
});
