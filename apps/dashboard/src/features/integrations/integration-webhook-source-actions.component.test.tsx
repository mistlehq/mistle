// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { useIntegrationWebhookSourceActions } from "./integration-webhook-source-actions.js";
import type { IntegrationConnection } from "./integrations-service.js";

function WebhookSourceActionsHarness(input: { connection: IntegrationConnection }) {
  const [syncedValue, setSyncedValue] = useState<string | null>(null);
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(null);
  const flow = useIntegrationWebhookSourceActions({
    connections: [input.connection],
    refreshTriggerCapabilities: (payload) => {
      const bodyValues = Object.entries(payload.body)
        .map(([key, value]) => `${key}:${String(value)}`)
        .join(",");
      setSyncedValue(`${payload.connectionId}:${bodyValues}`);
      setPendingConnectionId(payload.connectionId);
    },
    refreshingTriggerCapabilitiesConnectionId: pendingConnectionId,
  });

  return (
    <>
      {flow.renderWebhookSourceActions({ connectionId: input.connection.id })}
      {syncedValue === null ? null : <p>Synced {syncedValue}</p>}
      {flow.dialog}
    </>
  );
}

function createConnection(input: {
  action?: IntegrationConnection["webhookTriggerCapabilitiesRefreshAction"];
}): IntegrationConnection {
  return {
    id: "conn_webhook",
    targetKey: "provider-default",
    displayName: "Provider connection",
    status: "active",
    supportsWebhookSources: true,
    ...(input.action === undefined
      ? {}
      : { webhookTriggerCapabilitiesRefreshAction: input.action }),
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
}

const DirectRefreshAction: IntegrationConnection["webhookTriggerCapabilitiesRefreshAction"] = {
  actionLabel: "Sync webhook events",
  pendingLabel: "Syncing...",
};

const FormRefreshAction: IntegrationConnection["webhookTriggerCapabilitiesRefreshAction"] = {
  actionLabel: "Sync webhook events",
  pendingLabel: "Syncing...",
  bodyForm: {
    title: "Sync webhook events",
    submitLabel: "Sync",
    fields: [
      {
        name: "appConfigToken",
        label: "App configuration token",
        inputType: "password",
        required: true,
        placeholder: "xoxe.xoxp-...",
        description: "Generate a temporary app configuration token and paste it below",
        actions: [
          {
            label: "https://api.slack.com/apps",
            href: "https://api.slack.com/apps",
            opensInNewWindow: true,
          },
        ],
      },
    ],
  },
};

describe("useIntegrationWebhookSourceActions", () => {
  it("syncs webhook events directly when the provider action has no body form", () => {
    render(
      <WebhookSourceActionsHarness
        connection={createConnection({ action: DirectRefreshAction })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sync webhook events" }));

    expect(screen.getByText("Synced conn_webhook:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Syncing..." }).hasAttribute("disabled")).toBe(true);
  });

  it("syncs webhook events through provider-owned form metadata", () => {
    render(
      <WebhookSourceActionsHarness connection={createConnection({ action: FormRefreshAction })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sync webhook events" }));
    fireEvent.change(screen.getByPlaceholderText("xoxe.xoxp-..."), {
      target: { value: "xoxe.xoxp-temporary-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    expect(
      screen.getByText("Synced conn_webhook:appConfigToken:xoxe.xoxp-temporary-token"),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Syncing..." }).hasAttribute("disabled")).toBe(true);
  });

  it("explains disabled provider refresh actions", () => {
    render(
      <WebhookSourceActionsHarness
        connection={createConnection({
          action: {
            ...DirectRefreshAction,
            disabledMessage: "Install the provider app before syncing webhook events.",
          },
        })}
      />,
    );

    const syncButton = screen.getByRole("button", { name: "Sync webhook events" });

    expect(syncButton.getAttribute("disabled")).toBe("");
    fireEvent.mouseEnter(syncButton.parentElement ?? syncButton);
    expect(
      screen.getByText("Install the provider app before syncing webhook events."),
    ).toBeTruthy();
  });

  it("does not offer sync when the connection has no refresh action", () => {
    render(<WebhookSourceActionsHarness connection={createConnection({})} />);

    expect(screen.queryByRole("button", { name: "Sync webhook events" })).toBeNull();
  });
});
