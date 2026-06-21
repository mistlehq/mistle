// @vitest-environment jsdom

import type { IntegrationFormConnectionMethodProviderConfigurationSetup } from "@mistle/integrations-core";
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
import {
  buildProviderConfigurationSetupSecrets,
  createInitialProviderConfigurationSetupDraft,
} from "./integration-connection-provider-configuration-setup-pane.js";
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

const WasenderTarget: IntegrationTarget = {
  targetKey: "wasenderapi-mcp",
  familyId: "wasenderapi",
  variantId: "wasenderapi-mcp",
  kind: "connector",
  enabled: true,
  config: {},
  displayName: "WasenderAPI",
  description: "WasenderAPI integration",
  connectionMethods: [
    {
      id: "api-key",
      label: "Personal access token",
      kind: "form",
      createBehavior: "draft-then-setup",
      setupFlow: {
        routeSegment: "provider-configuration",
        setupPane: {
          kind: "provider-configuration",
        },
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "secret-field",
              field: "personalAccessToken",
            },
            {
              kind: "secret-field",
              field: "webhookSecret",
            },
            {
              kind: "config-field",
              field: "provider_configuration_setup_completed",
            },
          ],
        },
        providerConfigurationSetup: {
          title: "Set up WasenderAPI",
          description: "Configure the WasenderAPI session webhook and credentials.",
          webhookCallback: {
            title: "Webhook callback",
            description: "Copy this URL into the Webhook URL field in WasenderAPI.",
            label: "Webhook URL",
            errorTitle: "Could not load webhook URL",
            missingTitle: "Webhook URL is not available yet",
            missingMessage:
              "WasenderAPI setup requires a webhook URL, but this connection does not have one yet.",
          },
          instructions: {
            title: "WasenderAPI setup",
            items: [
              "Create or edit a WhatsApp session in WasenderAPI.",
              "Paste the Mistle webhook URL into the session Webhook URL field.",
            ],
          },
          fields: {
            title: "WasenderAPI credentials",
            description: "Save the WasenderAPI credentials.",
            saveLabel: "Save WasenderAPI setup",
            saveErrorMessage: "Could not save WasenderAPI setup.",
            configFields: [],
            secretFields: [
              {
                name: "personalAccessToken",
                label: "Personal access token",
                placeholder: "Enter personal access token",
                inputType: "password",
                required: true,
                secretLabel: "personal access token",
              },
              {
                name: "webhookSecret",
                label: "Webhook secret",
                placeholder: "Enter webhook secret",
                inputType: "password",
                required: true,
                secretLabel: "webhook secret",
              },
            ],
          },
        },
      },
      secretFields: [
        {
          name: "personalAccessToken",
          label: "Personal access token",
          inputType: "password",
        },
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

const IncompleteWasenderConnection: IntegrationConnection = {
  id: "icn_wasender_incomplete",
  targetKey: "wasenderapi-mcp",
  displayName: "WasenderAPI Production",
  status: "active",
  connectionMethodId: "api-key",
  connectionMethodLabel: "Personal access token",
  config: {
    connection_method: "api-key",
  },
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

const WasenderWebhookCallbackUrl =
  "https://control-plane.example.com/p/integration/webhooks/wasenderapi-mcp/eps_wasender_setup";

const WasenderWebhookSource: IntegrationWebhookSource = {
  id: "iws_wasender_setup",
  targetKey: "wasenderapi-mcp",
  integrationConnectionId: IncompleteWasenderConnection.id,
  displayName: "WasenderAPI webhook",
  endpointKey: "eps_wasender_setup",
  callbackUrl: WasenderWebhookCallbackUrl,
  status: "active",
  providerMetadata: {},
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

const WhapiTarget: IntegrationTarget = {
  targetKey: "whapi-mcp",
  familyId: "whapi",
  variantId: "whapi-mcp",
  kind: "connector",
  enabled: true,
  config: {},
  displayName: "Whapi",
  description: "Whapi integration",
  connectionMethods: [
    {
      id: "api-key",
      label: "API token",
      kind: "form",
      createBehavior: "draft-then-setup",
      setupFlow: {
        routeSegment: "provider-configuration",
        setupPane: {
          kind: "provider-configuration",
        },
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "secret-field",
              field: "apiToken",
            },
            {
              kind: "config-field",
              field: "provider_configuration_setup_completed",
            },
          ],
        },
        providerConfigurationSetup: {
          title: "Set up Whapi",
          description:
            "Save the API token so Mistle can configure this channel's webhook with the displayed callback URL.",
          webhookCallback: {
            title: "Webhook callback",
            description: "Mistle registers this callback URL in Whapi channel settings.",
            label: "Webhook URL",
            errorTitle: "Could not load webhook URL",
            missingTitle: "Webhook URL is not available yet",
            missingMessage:
              "Whapi setup requires a webhook URL, but this connection does not have one yet.",
          },
          instructions: {
            title: "Whapi setup",
            items: [
              "Enter the Whapi API token for the WhatsApp channel.",
              "Save setup so Mistle can register the webhook URL and supported events in Whapi.",
            ],
          },
          fields: {
            title: "Whapi credentials",
            description: "Save the Whapi credentials.",
            saveLabel: "Save Whapi setup",
            saveErrorMessage: "Could not save Whapi setup.",
            configFields: [],
            secretFields: [
              {
                name: "apiToken",
                label: "API token",
                placeholder: "Enter API token",
                inputType: "password",
                required: true,
                secretLabel: "API token",
              },
            ],
          },
        },
      },
      secretFields: [
        {
          name: "apiToken",
          label: "API token",
          inputType: "password",
        },
      ],
    },
  ],
  targetHealth: {
    configStatus: "valid",
  },
};

const IncompleteWhapiConnection: IntegrationConnection = {
  id: "icn_whapi_incomplete",
  targetKey: "whapi-mcp",
  displayName: "Whapi Production",
  status: "active",
  connectionMethodId: "api-key",
  connectionMethodLabel: "API token",
  config: {
    connection_method: "api-key",
  },
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

const WhapiWebhookCallbackUrl =
  "https://control-plane.example.com/p/integration/webhooks/whapi-mcp/eps_whapi_setup";

const WhapiWebhookSource: IntegrationWebhookSource = {
  id: "iws_whapi_setup",
  targetKey: "whapi-mcp",
  integrationConnectionId: IncompleteWhapiConnection.id,
  displayName: "Whapi webhook",
  endpointKey: "eps_whapi_setup",
  callbackUrl: WhapiWebhookCallbackUrl,
  status: "active",
  providerMetadata: {},
  createdAt: "2026-04-23T00:00:00.000Z",
  updatedAt: "2026-04-23T00:00:00.000Z",
};

function getWhapiProviderConfigurationSetup(): IntegrationFormConnectionMethodProviderConfigurationSetup {
  const method = WhapiTarget.connectionMethods?.find((candidate) => candidate.id === "api-key");
  const providerConfigurationSetup =
    method?.kind === "form" ? method.setupFlow?.providerConfigurationSetup : undefined;
  if (providerConfigurationSetup === undefined) {
    throw new Error("Whapi test target is missing provider configuration setup.");
  }

  return providerConfigurationSetup;
}

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

  it("renders provider configuration setup routes with provider-specific fields", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [WasenderTarget],
      connections: [IncompleteWasenderConnection],
    });
    queryClient.setQueryData(
      ["integration-webhook-sources", IncompleteWasenderConnection.id],
      [WasenderWebhookSource],
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
          "/integrations/wasenderapi-mcp/icn_wasender_incomplete/provider-configuration/setup",
        ],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Set up WasenderAPI" })).toBeTruthy();
    });
    expect(screen.getByText(WasenderWebhookCallbackUrl)).toBeTruthy();
    expect(screen.getByText("Personal access token")).toBeTruthy();
    expect(screen.getByText("Webhook secret")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save WasenderAPI setup" })).toBeTruthy();
    expect(screen.queryByText("Could not load setup")).toBeNull();
  });

  it("renders provider configuration setup fields", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [WhapiTarget],
      connections: [IncompleteWhapiConnection],
    });
    queryClient.setQueryData(
      ["integration-webhook-sources", IncompleteWhapiConnection.id],
      [WhapiWebhookSource],
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
          "/integrations/whapi-mcp/icn_whapi_incomplete/provider-configuration/setup",
        ],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Set up Whapi" })).toBeTruthy();
    });
    expect(screen.getByText(WhapiWebhookCallbackUrl)).toBeTruthy();
    expect(
      screen.getByText(
        "Save setup so Mistle can register the webhook URL and supported events in Whapi.",
      ),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText("Enter webhook secret")).toBeNull();
    expect(screen.getByPlaceholderText("Enter API token")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Whapi setup" })).toBeTruthy();
  });

  it("includes provider configuration secrets in the setup save payload", () => {
    const setup = getWhapiProviderConfigurationSetup();
    const draft = createInitialProviderConfigurationSetupDraft({
      connection: IncompleteWhapiConnection,
      setup,
    });
    const secrets = buildProviderConfigurationSetupSecrets({
      draft: {
        ...draft,
        apiToken: "whapi-api-token",
      },
      setup,
    });

    expect(secrets).toEqual({
      apiToken: "whapi-api-token",
    });
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
