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
  methods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          placeholder: "Enter API key",
          inputType: "password",
        },
      ],
    },
    {
      id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      label: "GitHub App installation",
      kind: "redirect",
    },
  ],
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
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue=""
        connectError={null}
        connectMethodId={IntegrationConnectionMethodIds.API_KEY}
        dialog={dialog}
        hasChanges={true}
        isSecretsChanged={false}
        isConnectionDisplayNameChanged={false}
        onConnectionDisplayNameChange={() => {}}
        onClose={() => {}}
        onMethodChange={() => {}}
        onSecretChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        secrets={{}}
      />,
    );

    const input = screen.getByPlaceholderText("Enter API key");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("does not render auth method selection in update mode", () => {
    render(
      <IntegrationConnectionDialog
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue="Existing connection"
        connectError={null}
        connectMethodId={IntegrationConnectionMethodIds.API_KEY}
        dialog={{
          connectionId: "icn_123",
          currentMethod: {
            id: IntegrationConnectionMethodIds.API_KEY,
            label: "API key",
            kind: "form",
            secretFields: [
              {
                name: "apiKey",
                label: "API key",
                inputType: "password",
              },
            ],
          },
          displayName: "OpenAI",
          initialConnectionDisplayName: "Existing connection",
          mode: "update",
          targetKey: "openai",
        }}
        hasChanges={false}
        isSecretsChanged={false}
        isConnectionDisplayNameChanged={false}
        onConnectionDisplayNameChange={() => {}}
        onClose={() => {}}
        onMethodChange={() => {}}
        onSecretChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        secrets={{}}
      />,
    );

    expect(screen.queryByText("Authentication method")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("renders Save for redirect connections in update mode", () => {
    render(
      <IntegrationConnectionDialog
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue="Existing GitHub App installation connection"
        connectError={null}
        connectMethodId={IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION}
        dialog={{
          connectionId: "icn_456",
          currentMethod: {
            id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
            label: "GitHub App installation",
            kind: "redirect",
          },
          displayName: "OpenAI",
          initialConnectionDisplayName: "Existing GitHub App installation connection",
          mode: "update",
          targetKey: "openai",
        }}
        hasChanges={true}
        isSecretsChanged={false}
        isConnectionDisplayNameChanged={true}
        onConnectionDisplayNameChange={() => {}}
        onClose={() => {}}
        onMethodChange={() => {}}
        onSecretChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        secrets={{}}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByText("Save to update this connection name.")).toBeTruthy();
    expect(screen.queryByText("Continue to start the connection flow.")).toBeNull();
  });
});
