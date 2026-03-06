// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { IntegrationConnection } from "./integrations-service.js";
import { ViewConnectionsDialog } from "./view-connections-dialog.js";

function createConnection(input: {
  id: string;
  status: IntegrationConnection["status"];
  authScheme?: "api-key" | "oauth";
}): IntegrationConnection {
  return {
    id: input.id,
    targetKey: "openai-default",
    status: input.status,
    ...(input.authScheme === undefined ? {} : { config: { auth_scheme: input.authScheme } }),
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-03T00:00:00.000Z",
  };
}

describe("ViewConnectionsDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an update API-key action only for API-key connections", () => {
    let selectedConnectionId: string | null = null;

    render(
      <ViewConnectionsDialog
        connections={[
          createConnection({ id: "icn_api_key", status: "active", authScheme: "api-key" }),
          createConnection({ id: "icn_oauth", status: "active", authScheme: "oauth" }),
        ]}
        dialog={{ targetKey: "openai-default", displayName: "OpenAI" }}
        onClose={() => {}}
        onOpenUpdateApiKeyDialog={(connectionId) => {
          selectedConnectionId = connectionId;
        }}
      />,
    );

    const updateButtons = screen.getAllByRole("button", {
      name: "Update API key",
    });
    expect(updateButtons).toHaveLength(1);

    const firstUpdateButton = updateButtons[0];
    if (firstUpdateButton === undefined) {
      throw new Error("Expected Update API key button.");
    }

    fireEvent.click(firstUpdateButton);
    expect(selectedConnectionId).toBe("icn_api_key");
  });
});
