// @vitest-environment jsdom

import { AtlassianConnectionMethodIds } from "@mistle/integrations-definitions";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resolveConnectionMethodFormUiModel } from "../pages/use-integration-connection-dialog-state-helpers.js";
import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionDialogState,
} from "./integration-connection-dialog.js";

const createDialog: IntegrationConnectionDialogState = {
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
  targetConfig: {},
  targetDisplayName: "OpenAI",
  targetFamilyId: "openai",
  targetKey: "openai",
  targetVariantId: "openai-default",
};

describe("IntegrationConnectionDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables 1Password autofill for form secret input", () => {
    render(
      <IntegrationConnectionDialog
        configForm={{
          mode: "none",
        }}
        configValue={{}}
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue=""
        connectError={null}
        dialog={createDialog}
        hasChanges={true}
        isConnectionDisplayNameChanged={false}
        isSecretChanged={false}
        methodId={IntegrationConnectionMethodIds.API_KEY}
        onClose={() => {}}
        onConfigChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
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

  it("renders definition-driven config fields for form methods", () => {
    render(
      <IntegrationConnectionDialog
        configForm={{
          mode: "form",
          schema: {
            type: "object",
            properties: {
              endpoint: {
                type: "string",
                title: "Endpoint",
              },
            },
          },
          uiSchema: {},
          value: {
            endpoint: "https://api.example.com",
          },
          visiblePropertyKeys: ["endpoint"],
        }}
        configValue={{
          endpoint: "https://api.example.com",
        }}
        connectionDisplayNamePlaceholder="Example connection"
        connectionDisplayNameValue=""
        connectError={null}
        dialog={{
          methods: [
            {
              id: "custom-form",
              label: "Custom token",
              kind: "form",
              secretFields: [
                {
                  name: "token",
                  label: "Token",
                  placeholder: "Paste token",
                  inputType: "text",
                },
              ],
            },
          ],
          mode: "create",
          targetConfig: {},
          targetDisplayName: "Example",
          targetFamilyId: "example",
          targetKey: "example",
          targetVariantId: "example-default",
        }}
        hasChanges={true}
        isConnectionDisplayNameChanged={false}
        isSecretChanged={false}
        methodId="custom-form"
        onClose={() => {}}
        onConfigChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
        onMethodChange={() => {}}
        onSecretChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        secrets={{}}
      />,
    );

    expect(screen.getByText("Configuration")).toBeTruthy();
    expect(screen.getByLabelText("Endpoint")).toBeTruthy();
    expect(screen.getByPlaceholderText("Paste token")).toBeTruthy();
  });

  it("does not render auth method selection in update mode", () => {
    render(
      <IntegrationConnectionDialog
        configForm={{
          mode: "none",
        }}
        configValue={{
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        }}
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue="Existing connection"
        connectError={null}
        dialog={{
          connectionConfig: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          connectionId: "icn_123",
          currentConnectionConfig: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
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
          initialConnectionDisplayName: "Existing connection",
          mode: "update",
          targetConfig: {},
          targetDisplayName: "OpenAI",
          targetFamilyId: "openai",
          targetKey: "openai",
          targetVariantId: "openai-default",
        }}
        hasChanges={false}
        isConnectionDisplayNameChanged={false}
        isSecretChanged={false}
        methodId={IntegrationConnectionMethodIds.API_KEY}
        onClose={() => {}}
        onConfigChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
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
        configForm={{
          mode: "none",
        }}
        configValue={{}}
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue="Existing GitHub App installation connection"
        connectError={null}
        dialog={{
          connectionConfig: {
            connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          },
          connectionId: "icn_456",
          currentConnectionConfig: {
            connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          },
          currentMethod: {
            id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
            label: "GitHub App installation",
            kind: "redirect",
          },
          initialConnectionDisplayName: "Existing GitHub App installation connection",
          mode: "update",
          targetConfig: {},
          targetDisplayName: "OpenAI",
          targetFamilyId: "openai",
          targetKey: "openai",
          targetVariantId: "openai-default",
        }}
        hasChanges={false}
        isConnectionDisplayNameChanged={false}
        isSecretChanged={false}
        methodId={IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION}
        onClose={() => {}}
        onConfigChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
        onMethodChange={() => {}}
        onSecretChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        secrets={{}}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByText("Save to update this connection.")).toBeTruthy();
  });

  it("renders Save when only the connection name changes in update mode", () => {
    render(
      <IntegrationConnectionDialog
        configForm={{
          mode: "none",
        }}
        configValue={{}}
        connectionDisplayNamePlaceholder="OpenAI connection"
        connectionDisplayNameValue="Updated GitHub App installation connection"
        connectError={null}
        dialog={{
          connectionConfig: {
            connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          },
          connectionId: "icn_789",
          currentConnectionConfig: {
            connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          },
          currentMethod: {
            id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
            label: "GitHub App installation",
            kind: "redirect",
          },
          initialConnectionDisplayName: "Existing GitHub App installation connection",
          mode: "update",
          targetConfig: {},
          targetDisplayName: "OpenAI",
          targetFamilyId: "openai",
          targetKey: "openai",
          targetVariantId: "openai-default",
        }}
        hasChanges={true}
        isConnectionDisplayNameChanged={true}
        isSecretChanged={false}
        methodId={IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION}
        onClose={() => {}}
        onConfigChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
        onMethodChange={() => {}}
        onSecretChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        secrets={{}}
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByText("Save to update this connection.")).toBeTruthy();
  });

  it("renders Atlassian personal token configuration fields", () => {
    const dialog: IntegrationConnectionDialogState = {
      methods: [
        {
          id: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
          label: "Personal API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Personal API token",
              placeholder: "Enter personal API token",
              inputType: "password",
            },
          ],
        },
      ],
      mode: "create",
      targetConfig: {},
      targetDisplayName: "Atlassian",
      targetFamilyId: "atlassian",
      targetKey: "atlassian-default",
      targetVariantId: "atlassian-default",
    };

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
      currentValue: {},
    });

    render(
      <IntegrationConnectionDialog
        configForm={configForm}
        configValue={{}}
        connectionDisplayNamePlaceholder="Atlassian connection"
        connectionDisplayNameValue=""
        connectError={null}
        dialog={dialog}
        hasChanges={true}
        isConnectionDisplayNameChanged={false}
        isSecretChanged={false}
        methodId={AtlassianConnectionMethodIds.PERSONAL_API_TOKEN}
        onClose={() => {}}
        onConfigChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
        onMethodChange={() => {}}
        onSecretChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        secrets={{}}
      />,
    );

    expect(screen.getByLabelText(/Site URL/)).toBeTruthy();
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter personal API token")).toBeTruthy();
  });

  it("renders Atlassian service account token configuration fields", () => {
    const dialog: IntegrationConnectionDialogState = {
      methods: [
        {
          id: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          label: "Service account API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Service account API token",
              placeholder: "Enter service account API token",
              inputType: "password",
            },
          ],
        },
      ],
      mode: "create",
      targetConfig: {},
      targetDisplayName: "Atlassian",
      targetFamilyId: "atlassian",
      targetKey: "atlassian-default",
      targetVariantId: "atlassian-default",
    };

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      currentValue: {},
    });

    render(
      <IntegrationConnectionDialog
        configForm={configForm}
        configValue={{}}
        connectionDisplayNamePlaceholder="Atlassian connection"
        connectionDisplayNameValue=""
        connectError={null}
        dialog={dialog}
        hasChanges={true}
        isConnectionDisplayNameChanged={false}
        isSecretChanged={false}
        methodId={AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN}
        onClose={() => {}}
        onConfigChange={() => {}}
        onConnectionDisplayNameChange={() => {}}
        onMethodChange={() => {}}
        onSecretChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        secrets={{}}
      />,
    );

    expect(screen.getByLabelText(/Cloud ID/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter service account API token")).toBeTruthy();
  });
});
