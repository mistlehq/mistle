// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../../config.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { ProviderAppSetupPane } from "./integration-connection-provider-app-setup-pane.js";
import {
  resolveIntegrationSetupAppManifestDraftBuilderOrThrow,
  resolveIntegrationProviderAppSetupOrThrow,
  resolveIntegrationSetupStartFormOrThrow,
} from "./integration-connection-setup-manifest-draft.js";

function createSlackConnection(input?: {
  appId?: string;
  configuredSecretNames?: readonly string[];
  clientId?: string;
}): IntegrationConnection {
  return {
    id: "icn_slack_app_setup",
    targetKey: "slack-default",
    displayName: "Engineering Slack",
    status: "active",
    connectionMethodId: "slack-bot-token",
    connectionMethodLabel: "Slack app",
    config: {
      connection_method: "slack-bot-token",
      ...(input?.appId === undefined ? {} : { app_id: input.appId }),
      ...(input?.clientId === undefined ? {} : { client_id: input.clientId }),
    },
    ...(input?.configuredSecretNames === undefined
      ? {}
      : { configuredSecretNames: [...input.configuredSecretNames] }),
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

function createGitHubConnection(input?: {
  config?: Record<string, unknown>;
  configuredSecretNames?: readonly string[];
  externalSubjectId?: string;
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
      ...(input?.config ?? {}),
    },
    ...(input?.configuredSecretNames === undefined
      ? {}
      : { configuredSecretNames: [...input.configuredSecretNames] }),
    ...(input?.externalSubjectId === undefined
      ? {}
      : { externalSubjectId: input.externalSubjectId }),
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

function getTextControlById(id: string): HTMLInputElement | HTMLTextAreaElement {
  const element = document.getElementById(id);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element;
  }

  throw new Error(`Expected text control '${id}' to be rendered.`);
}

function renderProviderAppSetupPane(input?: {
  connection?: IntegrationConnection;
  initialEntry?: string;
  methodId?: string;
  routeSegment?: string;
  webhookCallbackUrl?: string;
  webhookSource?: IntegrationWebhookSource | null;
}) {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: "https://control-plane.example.com",
  });
  resetDashboardConfigForTest();

  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const connection = input?.connection ?? createSlackConnection();
  const methodId = input?.methodId ?? "slack-bot-token";
  const routeSegment = input?.routeSegment ?? "slack-app";
  const defaultWebhookSource = {
    id: "iws_provider_app_setup",
    targetKey: connection.targetKey,
    integrationConnectionId: connection.id,
    displayName: "Provider app webhook",
    endpointKey: "eps_provider_app_setup",
    callbackUrl:
      input?.webhookCallbackUrl ??
      `https://control-plane.example.com/p/integration/webhooks/${connection.targetKey}/eps_provider_app_setup`,
    status: "active",
    providerMetadata: {},
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  } satisfies IntegrationWebhookSource;
  const webhookSource =
    input?.webhookSource === undefined ? defaultWebhookSource : input.webhookSource;
  queryClient.setQueryData(
    ["integration-webhook-sources", connection.id],
    webhookSource === null ? [] : [webhookSource],
  );

  return render(
    <MemoryRouter
      initialEntries={[
        input?.initialEntry ??
          `/integrations/${connection.targetKey}/${connection.id}/${routeSegment}/setup`,
      ]}
    >
      <QueryClientProvider client={queryClient}>
        <ProviderAppSetupPane
          connection={connection}
          manifestDraftBuilder={resolveIntegrationSetupAppManifestDraftBuilderOrThrow({
            connection,
            setupRoute: {
              methodId,
              routeSegment,
            },
          })}
          methodId={methodId}
          routeSegment={routeSegment}
          setupStartForm={resolveIntegrationSetupStartFormOrThrow({
            connection,
            setupRoute: {
              methodId,
              routeSegment,
            },
          })}
          providerAppSetup={resolveIntegrationProviderAppSetupOrThrow({
            connection,
            setupRoute: {
              methodId,
              routeSegment,
            },
          })}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ProviderAppSetupPane", () => {
  afterEach(() => {
    Object.assign(import.meta.env, {
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
    });
    resetDashboardConfigForTest();
  });

  it("defaults an incomplete Slack connection to manifest setup", async () => {
    const rendered = renderProviderAppSetupPane();

    expect(screen.getByRole("tab", { name: "Create from manifest", selected: true })).toBeTruthy();
    expect(screen.getByText("App configuration token")).toBeTruthy();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P" &&
          element?.textContent ===
            "Generate a temporary token from https://api.slack.com/apps and paste it below",
      ),
    ).toBeTruthy();
    const generateTokenLink = screen.getByRole("link", { name: "https://api.slack.com/apps" });
    expect(generateTokenLink.getAttribute("href")).toBe("https://api.slack.com/apps");
    expect(screen.getByPlaceholderText("xoxe.xoxp-...")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Slack app manifest" })).toBeTruthy();
    expect(
      screen.getByText(
        "Create a Slack app from a basic manifest. You can still change the settings later in Slack.",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_provider_app_setup",
      );
    });
    expect(rendered.container.textContent).toContain(
      "https://control-plane.example.com/p/integration/callbacks/setup/slack-app-installation",
    );
    expect(rendered.container.textContent).toContain(
      "https://control-plane.example.com/p/identity-linking/callbacks/slack",
    );
    expect(rendered.container.textContent).not.toContain("mistle.example.com");
    expect(
      screen.getByRole("button", { name: "Create and connect Slack app" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("uses the provider-facing webhook callback base for generated redirect URLs", async () => {
    const rendered = renderProviderAppSetupPane({
      webhookCallbackUrl:
        "https://public-control-plane.example.com/base/p/integration/webhooks/slack-default/eps_public",
    });

    await waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "https://public-control-plane.example.com/base/p/integration/webhooks/slack-default/eps_public",
      );
    });
    expect(rendered.container.textContent).toContain(
      "https://public-control-plane.example.com/base/p/integration/callbacks/setup/slack-app-installation",
    );
    expect(rendered.container.textContent).toContain(
      "https://public-control-plane.example.com/base/p/identity-linking/callbacks/slack",
    );
    expect(rendered.container.textContent).not.toContain(
      "http://localhost:3000/p/integration/callbacks/setup/slack-app-installation",
    );
  });

  it("defaults a configured Slack connection to the existing app setup", () => {
    renderProviderAppSetupPane({
      connection: createSlackConnection({
        appId: "A0123456789",
        clientId: "123.456",
        configuredSecretNames: ["botToken", "signingSecret", "clientSecret"],
      }),
    });

    expect(screen.getByRole("tab", { name: "Use existing app", selected: true })).toBeTruthy();
    expect(screen.getByText("Existing Slack App")).toBeTruthy();
    expect(screen.getByText("Secrets")).toBeTruthy();
    expect(screen.getByDisplayValue("A0123456789")).toBeTruthy();
    expect(screen.getByDisplayValue("123.456")).toBeTruthy();
    expect(screen.getAllByPlaceholderText("••••••")).toHaveLength(3);
    expect(screen.queryByText("Bot token is already configured.")).toBeNull();
    expect(screen.queryByText("Signing secret is already configured.")).toBeNull();
    expect(screen.queryByText("Client secret is already configured.")).toBeNull();
    expect(screen.getByText("Slack app URLs")).toBeTruthy();
    expect(screen.getByText("Events API Request URL")).toBeTruthy();
    expect(
      screen.getByText(
        "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_provider_app_setup",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Slack App" })).toBeNull();
    const connectButton = screen.getByRole("button", { name: "Connect Slack to Mistle" });
    expect(connectButton.hasAttribute("disabled")).toBe(false);
  });

  it("stages configured existing app secret replacements without opening a confirmation dialog", () => {
    renderProviderAppSetupPane({
      connection: createSlackConnection({
        appId: "A0123456789",
        clientId: "123.456",
        configuredSecretNames: ["botToken", "signingSecret", "clientSecret"],
      }),
    });

    const signingSecretInput = getTextControlById("slack-app-signingSecret");
    fireEvent.change(signingSecretInput, {
      target: { value: "replacement-signing-secret" },
    });
    fireEvent.blur(signingSecretInput);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("Replace on save")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Connect Slack to Mistle" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("renders GitHub provider-owned manifest setup fields", async () => {
    renderProviderAppSetupPane({
      connection: createGitHubConnection(),
      methodId: "github-app-installation",
      routeSegment: "github-app",
    });

    expect(screen.getByRole("tab", { name: "Create from manifest", selected: true })).toBeTruthy();
    expect(
      screen.getByRole("radio", {
        name: "Personal account",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Organization" })).toBeTruthy();
    expect(screen.queryByLabelText("GitHub organization")).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "GitHub App Manifest" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Create app in GitHub").hasAttribute("disabled")).toBe(true);
    });
  });

  it("focuses the GitHub organization field when the organization owner option reveals it", () => {
    renderProviderAppSetupPane({
      connection: createGitHubConnection(),
      methodId: "github-app-installation",
      routeSegment: "github-app",
    });

    fireEvent.click(screen.getByRole("radio", { name: "Organization" }));

    const organizationInput = getTextControlById("integration-setup-start-form-organizationSlug");
    expect(document.activeElement).toBe(organizationInput);
  });

  it("renders GitHub provider-owned existing app setup fields", () => {
    renderProviderAppSetupPane({
      connection: createGitHubConnection({
        config: {
          app_id: "12345",
          app_slug: "mistle-github-app",
          client_id: "Iv1.providerowned",
        },
        configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
      }),
      methodId: "github-app-installation",
      routeSegment: "github-app",
    });

    expect(screen.getByRole("tab", { name: "Use existing app", selected: true })).toBeTruthy();
    expect(screen.getByText("Existing GitHub App")).toBeTruthy();
    expect(screen.getByDisplayValue("12345")).toBeTruthy();
    expect(screen.getByDisplayValue("mistle-github-app")).toBeTruthy();
    expect(screen.getByDisplayValue("Iv1.providerowned")).toBeTruthy();
    expect(screen.getByText("Hook URLs")).toBeTruthy();
    expect(screen.getByText("Post-installation setup URL")).toBeTruthy();
    expect(
      screen.getByText(
        "https://control-plane.example.com/p/integration/callbacks/setup/github-app-installation",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Install GitHub App" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("enables GitHub existing app install after the required setup draft is complete", () => {
    renderProviderAppSetupPane({
      connection: createGitHubConnection(),
      methodId: "github-app-installation",
      routeSegment: "github-app",
    });

    fireEvent.click(screen.getByRole("tab", { name: "Use existing app" }));

    const installButton = screen.getByRole("button", { name: "Install GitHub App" });
    expect(installButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(getTextControlById("github-app-appId"), {
      target: { value: "12345" },
    });
    fireEvent.change(getTextControlById("github-app-appSlug"), {
      target: { value: "mistle-github-app" },
    });
    fireEvent.change(getTextControlById("github-app-clientId"), {
      target: { value: "Iv1.providerowned" },
    });
    fireEvent.change(getTextControlById("github-app-appPrivateKeyPem"), {
      target: { value: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----" },
    });
    fireEvent.change(getTextControlById("github-app-clientSecret"), {
      target: { value: "github-client-secret" },
    });
    fireEvent.change(getTextControlById("github-app-webhookSecret"), {
      target: { value: "github-webhook-secret" },
    });

    expect(installButton.hasAttribute("disabled")).toBe(false);
  });

  it("renders a dedicated GitHub App created screen after the manifest callback", () => {
    renderProviderAppSetupPane({
      connection: createGitHubConnection({
        config: {
          app_id: "12345",
          app_slug: "mistle-github-app",
          client_id: "Iv1.providerowned",
        },
        configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
      }),
      initialEntry:
        "/integrations/github-cloud/icn_github_app_setup/github-app/setup?githubAppManifest=created",
      methodId: "github-app-installation",
      routeSegment: "github-app",
    });

    expect(screen.getByText("GitHub App created")).toBeTruthy();
    expect(
      screen.getByText(
        "Your GitHub App is ready. Continue the installation in GitHub to connect it to Mistle.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Existing GitHub App")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Create from manifest" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Use existing app" })).toBeNull();
    expect(screen.queryByText("Hook URLs")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Install GitHub App" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("keeps the existing Slack app completion action disabled until required local setup is ready", () => {
    renderProviderAppSetupPane({
      connection: createSlackConnection({
        appId: "A0123456789",
        clientId: "123.456",
        configuredSecretNames: ["botToken"],
      }),
    });

    fireEvent.click(screen.getByRole("tab", { name: "Use existing app" }));

    expect(screen.getByText("Slack app URLs")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Connect Slack to Mistle" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("keeps the existing Slack app completion action disabled when the Events API URL is unavailable", () => {
    renderProviderAppSetupPane({
      connection: createSlackConnection({
        appId: "A0123456789",
        clientId: "123.456",
        configuredSecretNames: ["botToken", "signingSecret"],
      }),
      webhookSource: null,
    });

    expect(screen.getByText("Events API Request URL is not available yet")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Connect Slack to Mistle" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
