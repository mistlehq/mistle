// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionDialogState,
} from "./integration-connection-dialog.js";

const dialog: IntegrationConnectionDialogState = {
  displayName: "OpenAI",
  methods: [IntegrationConnectionMethodIds.API_KEY, IntegrationConnectionMethodIds.OAUTH],
  mode: "create",
  targetKey: "openai",
};

describe("IntegrationConnectionDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables 1Password autofill for API key input", () => {
    render(
      <IntegrationConnectionDialog
        apiKeyValue=""
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue=""
        connectError={null}
        connectMethodId={IntegrationConnectionMethodIds.API_KEY}
        dialog={dialog}
        hasChanges={true}
        isApiKeyChanged={false}
        isConnectionDisplayNameChanged={false}
        onApiKeyChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
        onClose={() => {}}
        onMethodChange={() => {}}
        onSubmit={() => {}}
        pending={false}
      />,
    );

    const input = screen.getByPlaceholderText("Enter API key");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("does not render auth method selection in update mode", () => {
    render(
      <IntegrationConnectionDialog
        apiKeyValue=""
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue="Existing connection"
        connectError={null}
        connectMethodId={IntegrationConnectionMethodIds.API_KEY}
        dialog={{
          connectionId: "icn_123",
          currentMethodId: IntegrationConnectionMethodIds.API_KEY,
          displayName: "OpenAI",
          initialConnectionDisplayName: "Existing connection",
          mode: "update",
          targetKey: "openai",
        }}
        hasChanges={false}
        isApiKeyChanged={false}
        isConnectionDisplayNameChanged={false}
        onApiKeyChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
        onClose={() => {}}
        onMethodChange={() => {}}
        onSubmit={() => {}}
        pending={false}
      />,
    );

    expect(screen.queryByText("Authentication method")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("renders Save for OAuth connections in update mode", () => {
    render(
      <IntegrationConnectionDialog
        apiKeyValue=""
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue="Existing OAuth connection"
        connectError={null}
        connectMethodId={IntegrationConnectionMethodIds.OAUTH}
        dialog={{
          connectionId: "icn_456",
          currentMethodId: IntegrationConnectionMethodIds.OAUTH,
          displayName: "OpenAI",
          initialConnectionDisplayName: "Existing OAuth connection",
          mode: "update",
          targetKey: "openai",
        }}
        hasChanges={true}
        isApiKeyChanged={false}
        isConnectionDisplayNameChanged={true}
        onApiKeyChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
        onClose={() => {}}
        onMethodChange={() => {}}
        onSubmit={() => {}}
        pending={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue with OAuth" })).toBeNull();
    expect(screen.getByText("Save to update this connection name.")).toBeTruthy();
    expect(
      screen.queryByText("Continue to generate an OAuth authorization URL and redirect."),
    ).toBeNull();
  });
});
