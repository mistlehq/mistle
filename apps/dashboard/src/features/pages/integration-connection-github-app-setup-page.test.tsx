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
import { GitHubAppSetupPane } from "./integration-connection-github-app-setup-page.js";

function createGitHubAppSetupConnection(input?: {
  configuredSecretNames?: readonly string[];
}): IntegrationConnection {
  return {
    id: "icn_github_app_setup",
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
    id: "iws_github_app_setup",
    targetKey: "github-cloud",
    integrationConnectionId: "icn_github_app_setup",
    displayName: "GitHub App webhook",
    endpointKey: "eps_github_app_setup",
    callbackUrl:
      "https://control-plane.example.com/p/integration/webhooks/github-cloud/eps_github_app_setup",
    status: "active",
    providerMetadata: {},
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
  };
}

function renderGitHubAppSetupPane(input?: {
  connection?: IntegrationConnection;
  manifestCreationSucceeded?: boolean;
  webhookSources?: readonly IntegrationWebhookSource[];
}) {
  globalThis.__MISTLE_RUNTIME_CONFIG__ = {
    controlPlaneApiOrigin: "https://control-plane.example.com",
  };
  resetDashboardConfigForTest();

  const connection = input?.connection ?? createGitHubAppSetupConnection();
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  queryClient.setQueryData(
    ["integration-webhook-sources", connection.id],
    [...(input?.webhookSources ?? [createWebhookSourceFixture()])],
  );

  const paneProps =
    input?.manifestCreationSucceeded === undefined
      ? { connection }
      : {
          connection,
          manifestCreationSucceeded: input.manifestCreationSucceeded,
        };

  return render(
    <QueryClientProvider client={queryClient}>
      <GitHubAppSetupPane {...paneProps} />
    </QueryClientProvider>,
  );
}

describe("GitHubAppSetupPane", () => {
  afterEach(() => {
    globalThis.__MISTLE_RUNTIME_CONFIG__ = undefined;
    resetDashboardConfigForTest();
  });

  it("defaults a blank draft connection to the manifest setup mode", () => {
    renderGitHubAppSetupPane({
      connection: {
        ...createGitHubAppSetupConnection(),
        config: {
          connection_method: "github-app-installation",
        },
        configuredSecretNames: undefined,
      },
    });

    expect(screen.getByRole("tab", { name: "Create from manifest", selected: true })).toBeTruthy();
    expect(screen.getByText("GitHub App Manifest")).toBeTruthy();
    expect(
      screen.getByText(
        "Create a GitHub App from a basic manifest. You can still change the settings later in GitHub.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Which account should the app be created in?")).toBeTruthy();
    expect(screen.queryByText("Choose where GitHub should create the app.")).toBeNull();
    expect(screen.getByRole("radio", { name: "Personal account" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Organization" })).toBeTruthy();
    expect(screen.queryByLabelText("GitHub organization")).toBeNull();
    expect(screen.queryByRole("button", { name: "Format JSON" })).toBeNull();
    expect(screen.queryByText("Needs setup")).toBeNull();
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Draft")).toBeNull();
    expect(screen.queryByText("Webhook callback URL")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create app in GitHub" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("defaults a prefilled connection to the existing app setup mode", () => {
    renderGitHubAppSetupPane();

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
    const installButton = screen.getByRole("button", { name: "Install GitHub App" });
    expect(installButton.hasAttribute("disabled")).toBe(true);
    expect(installButton.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("keeps installation available when required secrets are already configured on the server", () => {
    renderGitHubAppSetupPane({
      connection: createGitHubAppSetupConnection({
        configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
      }),
    });

    const installButton = screen.getByRole("button", { name: "Install GitHub App" });
    expect(installButton.hasAttribute("disabled")).toBe(false);
    expect(installButton.querySelector("svg")).toBeNull();
  });

  it("marks installed connections as external management actions", () => {
    const connection = createGitHubAppSetupConnection({
      configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
    });

    renderGitHubAppSetupPane({
      connection: {
        ...connection,
        config: {
          ...connection.config,
          installation_id: "12345",
        },
      },
    });

    const manageButton = screen.getByRole("button", { name: "Manage Installation" });
    expect(manageButton.hasAttribute("disabled")).toBe(false);
    expect(manageButton.querySelector("svg")).toBeTruthy();
  });

  it("shows a GitHub App creation success view with an install app action", () => {
    renderGitHubAppSetupPane({
      connection: createGitHubAppSetupConnection({
        configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
      }),
      manifestCreationSucceeded: true,
    });

    const successTitle = screen.getByText("GitHub App created successfully");
    expect(successTitle).toBeTruthy();
    expect(successTitle.closest("[data-slot='notice']")).toBeTruthy();
    expect(
      screen.getByText("The app credentials have been saved to this Mistle connection."),
    ).toBeTruthy();
    expect(screen.getByText("Install GitHub App")).toBeTruthy();
    expect(
      screen.getByText(
        "Click Install App to open GitHub, choose the account and repositories Mistle can access, and finish linking this connection.",
      ),
    ).toBeTruthy();
    const installAppButton = screen.getByRole("button", { name: "Install App" });
    expect(installAppButton.hasAttribute("disabled")).toBe(false);
    expect(installAppButton.querySelector("svg")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Use existing app" })).toBeNull();
  });
});
