// @vitest-environment jsdom

import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { IntegrationConnection } from "./integrations-service.js";
import { useSlackWebhookSourceActions } from "./slack-webhook-source-actions.js";

function SlackWebhookSourceActionsHarness(input: { connection: IntegrationConnection }) {
  const [syncedValue, setSyncedValue] = useState<string | null>(null);
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(null);
  const flow = useSlackWebhookSourceActions({
    connections: [input.connection],
    refreshTriggerCapabilities: (payload) => {
      setSyncedValue(`${payload.connectionId}:${String(payload.body["appConfigToken"])}`);
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
  appId?: string;
  connectionMethodId?: string;
}): IntegrationConnection {
  return {
    id: "conn_slack",
    targetKey: "slack-default",
    displayName: "Slack workspace",
    status: "active",
    connectionMethodId: input.connectionMethodId ?? SlackConnectionMethodId,
    connectionMethodLabel: "Slack app",
    config:
      input.appId === undefined
        ? { connection_method: SlackConnectionMethodId }
        : {
            connection_method: SlackConnectionMethodId,
            app_id: input.appId,
          },
    supportsWebhookSources: true,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
  };
}

describe("useSlackWebhookSourceActions", () => {
  it("syncs Slack webhook events through the provider-specific dialog", () => {
    render(<SlackWebhookSourceActionsHarness connection={createConnection({ appId: "A123" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Sync webhook events" }));
    fireEvent.change(screen.getByPlaceholderText("xoxe.xoxp-..."), {
      target: { value: "xoxe.xoxp-temporary-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));

    expect(screen.getByText("Synced conn_slack:xoxe.xoxp-temporary-token")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Syncing..." }).hasAttribute("disabled")).toBe(true);
  });

  it("explains disabled sync for Slack connections without a saved app id", () => {
    render(<SlackWebhookSourceActionsHarness connection={createConnection({})} />);

    const syncButton = screen.getByRole("button", { name: "Sync webhook events" });

    expect(syncButton.getAttribute("disabled")).toBe("");
    fireEvent.mouseEnter(syncButton.parentElement ?? syncButton);
    expect(screen.getByText("Add the Slack App ID before syncing webhook events.")).toBeTruthy();
  });

  it("does not offer sync for non-Slack app connections", () => {
    render(
      <SlackWebhookSourceActionsHarness
        connection={createConnection({
          appId: "A123",
          connectionMethodId: "api-key",
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Sync webhook events" })).toBeNull();
  });
});
