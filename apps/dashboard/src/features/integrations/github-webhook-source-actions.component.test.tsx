// @vitest-environment jsdom

import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { useGitHubWebhookSourceActions } from "./github-webhook-source-actions.js";
import type { IntegrationConnection } from "./integrations-service.js";

function GitHubWebhookSourceActionsHarness(input: { connection: IntegrationConnection }) {
  const [syncedConnectionId, setSyncedConnectionId] = useState<string | null>(null);
  const flow = useGitHubWebhookSourceActions({
    connections: [input.connection],
    refreshTriggerCapabilities: (payload, options) => {
      if (Object.keys(payload.body).length !== 0) {
        throw new Error("GitHub webhook event sync does not accept body fields.");
      }

      setSyncedConnectionId(payload.connectionId);
      options?.onSuccess?.();
    },
    refreshingTriggerCapabilitiesConnectionId: null,
  });

  return (
    <>
      {flow.renderWebhookSourceActions({ connectionId: input.connection.id })}
      {syncedConnectionId === null ? null : <p>Synced {syncedConnectionId}</p>}
      {flow.dialog}
    </>
  );
}

function createConnection(input: {
  connectionMethodId?: string;
  installationId?: string;
}): IntegrationConnection {
  return {
    id: "conn_github",
    targetKey: "github-cloud",
    displayName: "GitHub app",
    status: "active",
    connectionMethodId:
      input.connectionMethodId ?? IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    connectionMethodLabel: "GitHub App installation",
    config:
      input.installationId === undefined
        ? { connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION }
        : {
            connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
            installation_id: input.installationId,
          },
    supportsWebhookSources: true,
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
}

describe("useGitHubWebhookSourceActions", () => {
  it("syncs GitHub webhook events without provider-specific user input", () => {
    render(
      <GitHubWebhookSourceActionsHarness
        connection={createConnection({ installationId: "12345" })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sync webhook events" }));

    expect(screen.getByText("Synced conn_github")).toBeTruthy();
  });

  it("does not offer sync for GitHub App connections before installation", () => {
    render(<GitHubWebhookSourceActionsHarness connection={createConnection({})} />);

    expect(screen.queryByRole("button", { name: "Sync webhook events" })).toBeNull();
  });
});
