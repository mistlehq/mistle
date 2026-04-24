// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../../config.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { GitHubManualSetupPane } from "./integration-connection-github-manual-setup-page.js";

function createGitHubManualSetupConnection(input?: {
  configuredSecretNames?: readonly string[];
}): IntegrationConnection {
  return {
    id: "icn_github_manual_setup",
    targetKey: "github-cloud",
    displayName: "Engineering GitHub",
    status: "active",
    connectionMethodId: "github-app-installation",
    connectionMethodLabel: "GitHub App installation",
    config: {
      connection_method: "github-app-installation",
      app_id: "12345",
      app_slug: "mistle-github-app",
      client_id: "Iv1.prefilledclientid",
    },
    ...(input?.configuredSecretNames === undefined
      ? {}
      : { configuredSecretNames: [...input.configuredSecretNames] }),
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
  };
}

function createWebhookSourceFixture(): IntegrationWebhookSource {
  return {
    id: "iws_github_manual_setup",
    targetKey: "github-cloud",
    integrationConnectionId: "icn_github_manual_setup",
    displayName: "GitHub App webhook",
    endpointKey: "eps_github_manual_setup",
    callbackUrl:
      "https://control-plane.example.com/p/integration/webhooks/github-cloud/eps_github_manual_setup",
    status: "active",
    providerMetadata: {},
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
  };
}

function renderGitHubManualSetupPane(input?: {
  connection?: IntegrationConnection;
  webhookSources?: readonly IntegrationWebhookSource[];
}) {
  globalThis.__MISTLE_RUNTIME_CONFIG__ = {
    controlPlaneApiOrigin: "https://control-plane.example.com",
  };
  resetDashboardConfigForTest();

  const connection = input?.connection ?? createGitHubManualSetupConnection();
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  queryClient.setQueryData(
    ["integration-webhook-sources", connection.id],
    [...(input?.webhookSources ?? [createWebhookSourceFixture()])],
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <GitHubManualSetupPane connection={connection} />
    </QueryClientProvider>,
  );
}

describe("GitHubManualSetupPane", () => {
  afterEach(() => {
    globalThis.__MISTLE_RUNTIME_CONFIG__ = undefined;
    resetDashboardConfigForTest();
  });

  it("keeps installation available when required secrets are already configured on the server", () => {
    renderGitHubManualSetupPane({
      connection: createGitHubManualSetupConnection({
        configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
      }),
    });

    expect(screen.getByRole("button", { name: "Install App" }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});
