// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { cleanupTestQueryClients, createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
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

const SlackTarget: IntegrationTarget = {
  targetKey: "slack-default",
  familyId: "slack",
  variantId: "slack-default",
  kind: "connector",
  enabled: true,
  config: {},
  displayName: "Slack",
  description: "Slack integration",
  connectionMethods: [
    {
      id: "slack-bot-token",
      label: "Slack app",
      kind: "form",
      createBehavior: "draft-then-setup",
      setupFlow: {
        routeSegment: "slack-app",
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "secret-field",
              field: "botToken",
            },
            {
              kind: "secret-field",
              field: "signingSecret",
            },
          ],
        },
      },
      secretFields: [
        {
          name: "botToken",
          label: "Bot token",
          inputType: "password",
        },
        {
          name: "signingSecret",
          label: "Signing secret",
          inputType: "password",
        },
      ],
    },
  ],
  targetHealth: {
    configStatus: "valid",
  },
};

const IncompleteSlackConnection: IntegrationConnection = {
  id: "icn_slack_incomplete",
  targetKey: "slack-default",
  displayName: "Engineering Slack",
  status: "active",
  connectionMethodId: "slack-bot-token",
  connectionMethodLabel: "Slack app",
  config: {
    connection_method: "slack-bot-token",
  },
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

const SlackWebhookSource: IntegrationWebhookSource = {
  id: "iws_slack_setup",
  targetKey: "slack-default",
  integrationConnectionId: IncompleteSlackConnection.id,
  displayName: "Slack Events API webhook",
  endpointKey: "eps_slack_setup",
  callbackUrl:
    "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_slack_setup",
  status: "active",
  providerMetadata: {},
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

function LocationProbe(): React.JSX.Element {
  const location = useLocation();

  return <div>Current location: {`${location.pathname}${location.search}`}</div>;
}

function seedOrganizationSummaryError(input: {
  queryClient: ReturnType<typeof createTestQueryClient>;
}): void {
  const error = new Error("Organization summary unavailable.");
  const query = input.queryClient.getQueryCache().build(input.queryClient, {
    queryKey: organizationSummaryQueryKey("org_123"),
    queryFn: async (): Promise<unknown> => {
      throw error;
    },
  });

  query.setState({
    ...query.state,
    error,
    fetchStatus: "idle",
    status: "error",
  });
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
    seedAuthenticatedSession(queryClient);
    queryClient.setQueryData(organizationSummaryQueryKey("org_123"), {
      name: "Acme, Inc.",
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

  it("redirects completed setup routes without requiring the organization summary", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [GitHubTarget],
      connections: [InstalledGitHubConnection],
    });
    seedAuthenticatedSession(queryClient);
    seedOrganizationSummaryError({ queryClient });
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

  it("renders non-GitHub setup routes without requiring the organization summary", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [SlackTarget],
      connections: [IncompleteSlackConnection],
    });
    queryClient.setQueryData(
      ["integration-webhook-sources", IncompleteSlackConnection.id],
      [SlackWebhookSource],
    );
    seedAuthenticatedSession(queryClient);
    seedOrganizationSummaryError({ queryClient });
    const router = createMemoryRouter(
      [
        {
          path: "/integrations/:targetKey/:connectionId/:setupRouteSegment/setup",
          element: <IntegrationConnectionSetupPage />,
        },
      ],
      {
        initialEntries: ["/integrations/slack-default/icn_slack_incomplete/slack-app/setup"],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: "Slack app manifest" })).toBeTruthy();
    });
    expect(screen.queryByText("Could not load setup")).toBeNull();
  });

  it("renders the post-manifest GitHub install screen without requiring the organization summary", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [GitHubTarget],
      connections: [CreatedGitHubAppConnection],
    });
    queryClient.setQueryData(
      ["integration-webhook-sources", CreatedGitHubAppConnection.id],
      [CreatedGitHubAppWebhookSource],
    );
    seedAuthenticatedSession(queryClient);
    seedOrganizationSummaryError({ queryClient });
    const router = createMemoryRouter(
      [
        {
          path: "/integrations/:targetKey/:connectionId/:setupRouteSegment/setup",
          element: <IntegrationConnectionSetupPage />,
        },
      ],
      {
        initialEntries: [
          "/integrations/github-cloud/icn_github_created/github-app/setup?githubAppManifest=created",
        ],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("GitHub App created")).toBeTruthy();
    });
    expect(screen.queryByText("Could not load setup")).toBeNull();
  });

  it("renders GitHub existing app setup without requiring the organization summary", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [GitHubTarget],
      connections: [CreatedGitHubAppConnection],
    });
    queryClient.setQueryData(
      ["integration-webhook-sources", CreatedGitHubAppConnection.id],
      [CreatedGitHubAppWebhookSource],
    );
    seedAuthenticatedSession(queryClient);
    seedOrganizationSummaryError({ queryClient });
    const router = createMemoryRouter(
      [
        {
          path: "/integrations/:targetKey/:connectionId/:setupRouteSegment/setup",
          element: <IntegrationConnectionSetupPage />,
        },
      ],
      {
        initialEntries: ["/integrations/github-cloud/icn_github_created/github-app/setup"],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Use existing app", selected: true })).toBeTruthy();
    });
    expect(screen.getByText("Existing GitHub App")).toBeTruthy();
    expect(screen.queryByText("Could not load setup")).toBeNull();
  });
});
