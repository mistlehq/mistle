// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupTestQueryClients, createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { renderSelectedConnectionSetupBody } from "./integrations-page.js";

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
