// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../../config.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnection,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { resolveIntegrationSetupAppManifestDraftBuilderOrThrow } from "./integration-connection-setup-manifest-draft.js";
import { SlackAppSetupPane } from "./integration-connection-slack-app-setup-pane.js";

function createSlackConnection(input?: {
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
      ...(input?.clientId === undefined ? {} : { client_id: input.clientId }),
    },
    ...(input?.configuredSecretNames === undefined
      ? {}
      : { configuredSecretNames: [...input.configuredSecretNames] }),
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

function CurrentPath(): React.JSX.Element {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function renderSlackAppSetupPane(input?: {
  connection?: IntegrationConnection;
  controlPlaneApiOrigin?: string;
  webhookCallbackUrl?: string;
  webhookSource?: IntegrationWebhookSource | null;
}) {
  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN:
      input?.controlPlaneApiOrigin ?? "https://control-plane.example.com",
  });
  resetDashboardConfigForTest();

  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const connection = input?.connection ?? createSlackConnection();
  const defaultWebhookSource = {
    id: "iws_slack_app_setup",
    targetKey: connection.targetKey,
    integrationConnectionId: connection.id,
    displayName: "Slack Events API webhook",
    endpointKey: "eps_slack_app_setup",
    callbackUrl:
      input?.webhookCallbackUrl ??
      "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_slack_app_setup",
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
      initialEntries={[`/integrations/${connection.targetKey}/${connection.id}/slack-app/setup`]}
    >
      <QueryClientProvider client={queryClient}>
        <SlackAppSetupPane
          connection={connection}
          manifestDraftBuilder={resolveIntegrationSetupAppManifestDraftBuilderOrThrow({
            connection,
            setupRoute: {
              methodId: "slack-bot-token",
              routeSegment: "slack-app",
            },
          })}
        />
        <CurrentPath />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SlackAppSetupPane", () => {
  afterEach(() => {
    Object.assign(import.meta.env, {
      VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
    });
    resetDashboardConfigForTest();
  });

  it("defaults an incomplete Slack connection to manifest setup", async () => {
    const rendered = renderSlackAppSetupPane();

    expect(screen.getByRole("tab", { name: "Create from manifest", selected: true })).toBeTruthy();
    expect(screen.getByText("App configuration token")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Slack app manifest" })).toBeTruthy();
    expect(
      screen.getByText(
        "Create a Slack app from a basic manifest. You can still change the settings later in Slack.",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(rendered.container.textContent).toContain(
        "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_slack_app_setup",
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
    const rendered = renderSlackAppSetupPane({
      controlPlaneApiOrigin: "http://localhost:3000",
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
    renderSlackAppSetupPane({
      connection: createSlackConnection({
        clientId: "123.456",
        configuredSecretNames: ["botToken", "signingSecret", "clientSecret"],
      }),
    });

    expect(screen.getByRole("tab", { name: "Use existing app", selected: true })).toBeTruthy();
    expect(screen.getByText("Existing Slack App")).toBeTruthy();
    expect(screen.getByText("Secrets")).toBeTruthy();
    expect(screen.getByDisplayValue("123.456")).toBeTruthy();
    expect(screen.getAllByPlaceholderText("••••••")).toHaveLength(3);
    expect(screen.queryByText("Bot token is already configured.")).toBeNull();
    expect(screen.queryByText("Signing secret is already configured.")).toBeNull();
    expect(screen.queryByText("Client secret is already configured.")).toBeNull();
    expect(screen.getByText("Slack app URLs")).toBeTruthy();
    expect(screen.getByText("Events API Request URL")).toBeTruthy();
    expect(
      screen.getByText(
        "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_slack_app_setup",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Slack App" })).toBeNull();
    const connectButton = screen.getByRole("button", { name: "Connect Slack to Mistle" });
    expect(connectButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(connectButton);
    expect(screen.getByTestId("current-path").textContent).toBe("/integrations/slack-default");
  });

  it("keeps the existing Slack app completion action disabled until required local setup is ready", () => {
    renderSlackAppSetupPane({
      connection: createSlackConnection({
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
    renderSlackAppSetupPane({
      connection: createSlackConnection({
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
