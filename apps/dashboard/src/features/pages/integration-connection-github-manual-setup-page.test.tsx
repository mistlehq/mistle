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

  it("defaults a blank draft connection to the manifest setup mode", () => {
    renderGitHubManualSetupPane({
      connection: {
        ...createGitHubManualSetupConnection(),
        config: {
          connection_method: "github-app-installation",
        },
        configuredSecretNames: undefined,
      },
    });

    expect(screen.getByRole("tab", { name: "Create from manifest", selected: true })).toBeTruthy();
    expect(screen.getByText("GitHub App manifest")).toBeTruthy();
    expect(
      screen.getByText(
        "Create a new GitHub App with Mistle's recommended permissions, events, and callback URLs. You can still adjust the settings after creation in Github.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Needs setup")).toBeNull();
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.queryByText("Webhook callback URL")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create app in GitHub" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("defaults a prefilled connection to the manual setup mode", () => {
    renderGitHubManualSetupPane();

    expect(screen.getByRole("tab", { name: "Use existing app", selected: true })).toBeTruthy();
    expect(screen.getByDisplayValue("12345")).toBeTruthy();
    expect(screen.getByText("Existing GitHub App")).toBeTruthy();
    expect(
      screen.getByText(
        "Paste values from a GitHub App you already created or configured in GitHub.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Secrets")).toBeTruthy();
    expect(screen.getByText("Hook URLs")).toBeTruthy();
    expect(
      screen.getByText(
        "Copy these URLs into your GitHub App settings so Mistle can receive installation callbacks and webhook events.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Install GitHub App" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("keeps installation available when required secrets are already configured on the server", () => {
    renderGitHubManualSetupPane({
      connection: createGitHubManualSetupConnection({
        configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
      }),
    });

    expect(
      screen.getByRole("button", { name: "Install GitHub App" }).hasAttribute("disabled"),
    ).toBe(false);
  });
});
