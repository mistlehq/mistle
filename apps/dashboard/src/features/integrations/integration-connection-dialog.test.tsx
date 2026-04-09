// @vitest-environment jsdom

import { JiraConnectionMethodIds } from "@mistle/integrations-definitions";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { resolveConnectionMethodFormUiModel } from "../pages/use-integration-connection-dialog-state-helpers.js";
import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionDialogState,
} from "./integration-connection-dialog.js";

const GitHubAppInstallationSecretFields = [
  {
    name: "appPrivateKeyPem",
    label: "App private key PEM",
    placeholder: "-----BEGIN PRIVATE KEY-----",
    inputType: "textarea" as const,
  },
  {
    name: "webhookSecret",
    label: "Webhook secret",
    placeholder: "Enter webhook secret",
    inputType: "password" as const,
  },
] as const;

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
      kind: "form",
      secretFields: [...GitHubAppInstallationSecretFields],
    },
  ],
  mode: "create",
  targetConfig: {
    api_base_url: "https://api.github.com",
    web_base_url: "https://github.com",
  },
  targetDisplayName: "GitHub",
  targetFamilyId: "github",
  targetKey: "github-cloud",
  targetVariantId: "github-cloud",
};

function renderDialog(input: Partial<ComponentProps<typeof IntegrationConnectionDialog>> = {}) {
  const props: ComponentProps<typeof IntegrationConnectionDialog> = {
    configForm: {
      mode: "none",
    },
    configValue: {},
    connectionDisplayNamePlaceholder: "OpenAI connection",
    connectionDisplayNameValue: "",
    connectError: null,
    dialog: createDialog,
    hasChanges: true,
    isConnectionDisplayNameChanged: false,
    isSecretChanged: false,
    methodId: IntegrationConnectionMethodIds.API_KEY,
    onClose: () => {},
    onConfigChange: () => {},
    onConnectionDisplayNameChange: () => {},
    onMethodChange: () => {},
    onSecretChange: () => {},
    onSubmit: () => {},
    pending: false,
    secrets: {},
    ...input,
  };

  render(<IntegrationConnectionDialog {...props} />);
}

function createUpdateFormDialog(
  input: Partial<Extract<IntegrationConnectionDialogState, { mode: "update" }>> = {},
): Extract<IntegrationConnectionDialogState, { mode: "update" }> {
  return {
    connectionConfig: {
      connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      app_id: "123",
      app_slug: "mistle-github-app",
    },
    connectionId: "icn_456",
    currentConnectionConfig: {
      connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      app_id: "123",
      app_slug: "mistle-github-app",
    },
    currentMethod: {
      id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      label: "GitHub App installation",
      kind: "form",
      secretFields: [...GitHubAppInstallationSecretFields],
    },
    initialConnectionDisplayName: "Existing GitHub App installation connection",
    mode: "update",
    targetConfig: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
    targetDisplayName: "GitHub",
    targetFamilyId: "github",
    targetKey: "github-cloud",
    targetVariantId: "github-cloud",
    ...input,
  };
}

function createJiraCreateDialog(
  method: Extract<IntegrationConnectionDialogState, { mode: "create" }>["methods"][number],
): Extract<IntegrationConnectionDialogState, { mode: "create" }> {
  return {
    methods: [method],
    mode: "create",
    targetConfig: {},
    targetDisplayName: "Jira",
    targetFamilyId: "jira",
    targetKey: "jira-default",
    targetVariantId: "jira-default",
  };
}

describe("IntegrationConnectionDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables 1Password autofill for form secret input", () => {
    renderDialog();

    const input = screen.getByPlaceholderText("Enter API key");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("renders definition-driven config fields for form methods", () => {
    renderDialog({
      configForm: {
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
      },
      configValue: {
        endpoint: "https://api.example.com",
      },
      connectionDisplayNamePlaceholder: "Example connection",
      dialog: {
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
      },
      methodId: "custom-form",
    });

    expect(screen.getByLabelText("Endpoint")).toBeTruthy();
    expect(screen.getByPlaceholderText("Paste token")).toBeTruthy();
  });

  it("does not render auth method selection in update mode", () => {
    renderDialog({
      configValue: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      connectionDisplayNameValue: "Existing connection",
      dialog: {
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
      },
      hasChanges: false,
    });

    expect(screen.queryByRole("combobox", { name: "Authentication method" })).toBeNull();
  });

  it("renders auth method selection as a select in create mode", () => {
    renderDialog();

    expect(screen.getByRole("combobox", { name: "Authentication method" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("does not preselect an auth method in create mode", () => {
    renderDialog({
      methodId: "",
    });

    expect(
      screen.getByRole("combobox", { name: "Authentication method" }).textContent ?? "",
    ).toContain("Select authentication method");
    expect(screen.queryByPlaceholderText("Enter API key")).toBeNull();
    expect(screen.queryByPlaceholderText("-----BEGIN PRIVATE KEY-----")).toBeNull();
  });

  it.each([
    {
      name: "renders Save for GitHub App form connections in update mode",
      connectionDisplayNameValue: "Existing GitHub App installation connection",
      hasChanges: false,
      isConnectionDisplayNameChanged: false,
      expectedDisabled: true,
    },
    {
      name: "renders Save when only the connection name changes in update mode",
      connectionDisplayNameValue: "Updated GitHub App installation connection",
      hasChanges: true,
      isConnectionDisplayNameChanged: true,
      expectedDisabled: false,
    },
  ])(
    "$name",
    ({
      connectionDisplayNameValue,
      hasChanges,
      isConnectionDisplayNameChanged,
      expectedDisabled,
    }) => {
      renderDialog({
        connectionDisplayNameValue,
        dialog: createUpdateFormDialog(),
        hasChanges,
        isConnectionDisplayNameChanged,
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      });

      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(
        expectedDisabled,
      );
    },
  );

  it("renders Jira personal token configuration fields", () => {
    const dialog = createJiraCreateDialog({
      id: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
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
    });

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      currentValue: {},
    });

    renderDialog({
      configForm,
      connectionDisplayNamePlaceholder: "Jira connection",
      dialog,
      methodId: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
    });

    expect(screen.getByLabelText(/Site URL/)).toBeTruthy();
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter personal API token")).toBeTruthy();
  });

  it("hides GitHub API key discriminator config and the nested rjsf submit button", () => {
    const dialog: IntegrationConnectionDialogState = {
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
      ],
      mode: "create",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      targetDisplayName: "GitHub",
      targetFamilyId: "github",
      targetKey: "github-cloud",
      targetVariantId: "github-cloud",
    };

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: IntegrationConnectionMethodIds.API_KEY,
      currentValue: {},
    });

    expect(configForm).toMatchObject({
      mode: "form",
      visiblePropertyKeys: [],
    });

    renderDialog({
      configForm,
      connectionDisplayNamePlaceholder: "GitHub connection",
      dialog,
      methodId: IntegrationConnectionMethodIds.API_KEY,
    });

    expect(screen.queryByText("Configuration")).toBeNull();
    expect(screen.queryByLabelText("connection_method")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.getByPlaceholderText("Enter API key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create connection" })).toBeTruthy();
  });

  it("renders GitHub App form fields in create mode", () => {
    renderDialog({
      configForm: {
        mode: "form",
        schema: {
          type: "object",
          properties: {
            connection_method: {
              type: "string",
              default: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
            },
            app_id: {
              type: "string",
              title: "App ID",
            },
            app_slug: {
              type: "string",
              title: "App slug",
            },
          },
        },
        uiSchema: {
          connection_method: {
            "ui:widget": "hidden",
          },
        },
        value: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        },
        visiblePropertyKeys: ["app_id", "app_slug"],
      },
      connectionDisplayNamePlaceholder: "GitHub connection",
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    });

    expect(screen.getByLabelText("App ID")).toBeTruthy();
    expect(screen.getByLabelText("App slug")).toBeTruthy();
    const privateKeyField = screen.getByPlaceholderText("-----BEGIN PRIVATE KEY-----");
    expect(privateKeyField.tagName).toBe("TEXTAREA");
    expect(screen.getByPlaceholderText("Enter webhook secret")).toBeTruthy();
    expect(screen.queryByLabelText("installation_id")).toBeNull();
    expect(screen.queryByLabelText("setup_action")).toBeNull();
    expect(screen.getByRole("button", { name: "Create connection" })).toBeTruthy();
  });

  it("hides callback-managed GitHub App config fields from the form", () => {
    const configForm = resolveConnectionMethodFormUiModel({
      dialog: createDialog,
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      currentValue: {},
    });

    expect(configForm).toMatchObject({
      mode: "form",
      visiblePropertyKeys: ["app_id", "app_slug"],
    });

    if (configForm.mode !== "form") {
      throw new Error("Expected GitHub App connection form.");
    }

    expect(configForm.uiSchema.installation_id).toMatchObject({
      "ui:widget": "hidden",
    });
    expect(configForm.uiSchema.setup_action).toMatchObject({
      "ui:widget": "hidden",
    });
  });

  it("does not throw while resolving Jira personal token fields for an incomplete site url", () => {
    const dialog = createJiraCreateDialog({
      id: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
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
    });

    expect(() =>
      resolveConnectionMethodFormUiModel({
        dialog,
        methodId: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
        currentValue: {
          connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
          site_url: "https://",
        },
      }),
    ).not.toThrow();

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      currentValue: {
        connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://",
      },
    });

    expect(configForm).toMatchObject({
      mode: "form",
      visiblePropertyKeys: ["site_url", "email"],
    });
  });

  it("renders Jira service account token configuration fields", () => {
    const dialog = createJiraCreateDialog({
      id: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
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
    });

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      currentValue: {},
    });

    renderDialog({
      configForm,
      connectionDisplayNamePlaceholder: "Jira connection",
      dialog,
      methodId: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
    });

    expect(screen.getByLabelText(/Cloud ID/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter service account API token")).toBeTruthy();
  });

  it("renders Jira service account OAuth client credentials configuration fields", () => {
    const dialog = createJiraCreateDialog({
      id: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      label: "Service account OAuth client credentials",
      kind: "form",
      secretFields: [
        {
          name: "clientSecret",
          label: "Client secret",
          placeholder: "Enter service account OAuth client secret",
          inputType: "password",
        },
      ],
    });

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      currentValue: {},
    });

    renderDialog({
      configForm,
      connectionDisplayNamePlaceholder: "Jira connection",
      dialog,
      methodId: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
    });

    expect(screen.getByLabelText(/Cloud ID/)).toBeTruthy();
    expect(screen.getByLabelText(/Client ID/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter service account OAuth client secret")).toBeTruthy();
  });
});
