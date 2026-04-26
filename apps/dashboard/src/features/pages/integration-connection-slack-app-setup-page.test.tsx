// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { SlackAppSetupPane } from "./integration-connection-slack-app-setup-page.js";

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

function renderSlackAppSetupPane(input?: {
  connection?: IntegrationConnection;
  installSucceeded?: boolean;
}) {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const connection = input?.connection ?? createSlackConnection();
  const paneProps =
    input?.installSucceeded === undefined
      ? { connection }
      : { connection, installSucceeded: input.installSucceeded };

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <SlackAppSetupPane {...paneProps} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SlackAppSetupPane", () => {
  it("defaults an incomplete Slack connection to manifest setup", () => {
    renderSlackAppSetupPane();

    expect(screen.getByRole("tab", { name: "Create from manifest", selected: true })).toBeTruthy();
    expect(screen.getByText("App configuration token")).toBeTruthy();
    expect(screen.getByText("Slack app manifest")).toBeTruthy();
    expect(
      screen.getByText(
        "Create a Slack app from a basic manifest. You can still change the settings later in Slack.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Slack App" }).hasAttribute("disabled")).toBe(
      true,
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
    expect(screen.getByDisplayValue("123.456")).toBeTruthy();
    expect(screen.getByText("Bot token is already configured.")).toBeTruthy();
    expect(screen.getByText("Signing secret is already configured.")).toBeTruthy();
    expect(screen.getByText("Client secret is already configured.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Slack App" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("shows installed success after Slack OAuth returns", () => {
    renderSlackAppSetupPane({
      installSucceeded: true,
    });

    expect(screen.getByText("Slack app installed")).toBeTruthy();
    expect(screen.getByText("Continue with Slack")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.queryByText("Choose a setup method")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Use existing app" })).toBeNull();
  });
});
