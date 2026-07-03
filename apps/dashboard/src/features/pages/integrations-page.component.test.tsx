// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { cleanupTestQueryClients, createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import { IntegrationsPage, renderSelectedConnectionSetupBody } from "./integrations-page.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

const CreatedGitHubAppConnection: IntegrationConnection = {
  id: "icn_github_created",
  targetKey: "github-cloud",
  displayName: "Engineering GitHub",
  status: "active",
  connectionMethodId: "github-app-installation",
  connectionMethodLabel: "GitHub App installation",
  config: {
    connection_method: "github-app-installation",
    app_id: "12345",
    app_slug: "acme-mistle-agent",
    client_id: "Iv1.created",
  },
  configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

const CreatedGitHubAppWebhookSource: IntegrationWebhookSource = {
  id: "iws_github_created",
  targetKey: "github-cloud",
  integrationConnectionId: CreatedGitHubAppConnection.id,
  displayName: "GitHub App webhook",
  endpointKey: "eps_github_created",
  callbackUrl:
    "https://control-plane.example.com/p/integration/webhooks/github-cloud/eps_github_created",
  status: "active",
  providerMetadata: {},
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

const SecondaryGitHubAppConnection: IntegrationConnection = {
  ...CreatedGitHubAppConnection,
  id: "icn_github_secondary",
  displayName: "Secondary GitHub",
};

const GitHubIntegrationTarget: IntegrationTarget = {
  targetKey: "github-cloud",
  familyId: "github",
  variantId: "github-cloud",
  kind: "git",
  enabled: true,
  config: {},
  displayName: "GitHub",
  description: "Connect GitHub.",
  connectionMethods: [
    {
      id: "github-app-installation",
      label: "GitHub App installation",
      kind: "form",
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

describe("renderSelectedConnectionSetupBody", () => {
  afterEach(async () => {
    await cleanupTestQueryClients();
  });

  it("renders GitHub existing app setup without requiring the organization summary", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(
      ["integration-webhook-sources", CreatedGitHubAppConnection.id],
      [CreatedGitHubAppWebhookSource],
    );

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          {renderSelectedConnectionSetupBody({
            connection: CreatedGitHubAppConnection,
            navigate: () => {},
            organizationName: null,
            setupFlow: {
              methodId: "github-app-installation",
              routeSegment: "github-app",
            },
          })}
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Use existing app", selected: true })).toBeTruthy();
    });
    expect(screen.getByText("Existing GitHub App")).toBeTruthy();
    expect(screen.queryByText("Could not load setup")).toBeNull();
  });
});

describe("IntegrationsPage", () => {
  afterEach(async () => {
    await cleanupTestQueryClients();
  });

  it("updates the connectionId URL parameter when another connection is selected", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedAuthenticatedSession(queryClient);
    queryClient.setQueryDefaults(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [GitHubIntegrationTarget],
      connections: [CreatedGitHubAppConnection, SecondaryGitHubAppConnection],
    });
    queryClient.setQueryData(organizationSummaryQueryKey("org_123"), {
      name: "Acme",
    });

    const router = createMemoryRouter(
      [
        {
          path: "/integrations/:targetKey",
          element: (
            <>
              <IntegrationsPage />
              <LocationProbe />
            </>
          ),
        },
      ],
      {
        initialEntries: [
          `/integrations/github-cloud?connectionId=${CreatedGitHubAppConnection.id}`,
        ],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText("Engineering GitHub")).not.toHaveLength(0);
    expect(
      screen.getByText(
        "Current location: /integrations/github-cloud?connectionId=icn_github_created",
      ),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Select connection Secondary GitHub" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Current location: /integrations/github-cloud?connectionId=icn_github_secondary",
        ),
      ).toBeDefined();
    });
  });
});

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <p>{`Current location: ${location.pathname}${location.search}`}</p>;
}
