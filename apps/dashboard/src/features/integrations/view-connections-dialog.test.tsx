// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { IntegrationConnection } from "./integrations-service.js";
import { ViewConnectionsDialog } from "./view-connections-dialog.js";

function createConnection(input: {
  id: string;
  displayName: string;
  status: IntegrationConnection["status"];
  authScheme?: "api-key" | "oauth";
}): IntegrationConnection {
  return {
    id: input.id,
    displayName: input.displayName,
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

  it("opens edit actions with the current auth method", () => {
    let selectedConnectionId: string | null = null;
    let selectedConnectionDisplayName: string | null = null;
    let selectedConnectionMethodId: "api-key" | "oauth" | null = null;

    render(
      <ViewConnectionsDialog
        connections={[
          createConnection({
            id: "icn_api_key",
            displayName: "API key connection",
            status: "active",
            authScheme: "api-key",
          }),
          createConnection({
            id: "icn_oauth",
            displayName: "OAuth connection",
            status: "active",
            authScheme: "oauth",
          }),
        ]}
        dialog={{ targetKey: "openai-default", displayName: "OpenAI" }}
        onClose={() => {}}
        onOpenEditConnectionDialog={(input) => {
          selectedConnectionId = input.connectionId;
          selectedConnectionDisplayName = input.connectionDisplayName;
          selectedConnectionMethodId = input.connectionMethodId;
        }}
      />,
    );

    const updateButtons = screen.getAllByRole("button", {
      name: "Edit connection",
    });
    expect(updateButtons).toHaveLength(2);
    expect(screen.getByText("Auth method: API key")).toBeTruthy();
    expect(screen.getByText("Auth method: OAuth")).toBeTruthy();

    const firstUpdateButton = updateButtons[0];
    if (firstUpdateButton === undefined) {
      throw new Error("Expected Edit connection button.");
    }

    fireEvent.click(firstUpdateButton);
    expect(selectedConnectionId).toBe("icn_api_key");
    expect(selectedConnectionDisplayName).toBe("API key connection");
    expect(selectedConnectionMethodId).toBe("api-key");
  });
});
