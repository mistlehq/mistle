// @vitest-environment jsdom

import { AtlassianConnectionMethodIds } from "@mistle/integrations-definitions";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { resolveConnectionMethodFormUiModel } from "../pages/use-integration-connection-dialog-state-helpers.js";
import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionDialogState,
} from "./integration-connection-dialog.js";

const GitHubAppInstallationCreateUi = {
  create: {
    submitLabel: "Install GitHub App",
    helperText: "Continue to GitHub to install the app and finish connecting this account.",
  },
} as const;

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
      ui: GitHubAppInstallationCreateUi,
    },
  ],
  mode: "create",
  targetConfig: {},
  targetDisplayName: "OpenAI",
  targetFamilyId: "openai",
  targetKey: "openai",
  targetVariantId: "openai-default",
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

function createUpdateRedirectDialog(
  input: Partial<Extract<IntegrationConnectionDialogState, { mode: "update" }>> = {},
): Extract<IntegrationConnectionDialogState, { mode: "update" }> {
  return {
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
      ui: GitHubAppInstallationCreateUi,
    },
    initialConnectionDisplayName: "Existing GitHub App installation connection",
    mode: "update",
    targetConfig: {},
    targetDisplayName: "OpenAI",
    targetFamilyId: "openai",
    targetKey: "openai",
    targetVariantId: "openai-default",
    ...input,
  };
}

function createAtlassianCreateDialog(
  method: Extract<IntegrationConnectionDialogState, { mode: "create" }>["methods"][number],
): Extract<IntegrationConnectionDialogState, { mode: "create" }> {
  return {
    methods: [method],
    mode: "create",
    targetConfig: {},
    targetDisplayName: "Atlassian",
    targetFamilyId: "atlassian",
    targetKey: "atlassian-default",
    targetVariantId: "atlassian-default",
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

    expect(screen.queryByRole("radio")).toBeNull();
  });

  it.each([
    {
      name: "renders Save for redirect connections in update mode",
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
        dialog: createUpdateRedirectDialog(),
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

  it("renders Atlassian personal token configuration fields", () => {
    const dialog = createAtlassianCreateDialog({
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
    });

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
      currentValue: {},
    });

    renderDialog({
      configForm,
      connectionDisplayNamePlaceholder: "Atlassian connection",
      dialog,
      methodId: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
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

  it("renders method-defined redirect create copy", () => {
    renderDialog({
      connectionDisplayNamePlaceholder: "GitHub connection",
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    });

    expect(
      screen.getByText("Continue to GitHub to install the app and finish connecting this account."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install GitHub App" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("does not throw while resolving Atlassian personal token fields for an incomplete site url", () => {
    const dialog = createAtlassianCreateDialog({
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
    });

    expect(() =>
      resolveConnectionMethodFormUiModel({
        dialog,
        methodId: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
        currentValue: {
          connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
          site_url: "https://",
        },
      }),
    ).not.toThrow();

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
      currentValue: {
        connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://",
      },
    });

    expect(configForm).toMatchObject({
      mode: "form",
      visiblePropertyKeys: ["site_url", "email"],
    });
  });

  it("renders Atlassian service account token configuration fields", () => {
    const dialog = createAtlassianCreateDialog({
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
    });

    const configForm = resolveConnectionMethodFormUiModel({
      dialog,
      methodId: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      currentValue: {},
    });

    renderDialog({
      configForm,
      connectionDisplayNamePlaceholder: "Atlassian connection",
      dialog,
      methodId: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
    });

    expect(screen.getByLabelText(/Cloud ID/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter service account API token")).toBeTruthy();
  });

  it("renders Atlassian service account OAuth client credentials configuration fields", () => {
    const dialog = createAtlassianCreateDialog({
      id: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
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
      methodId: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      currentValue: {},
    });

    renderDialog({
      configForm,
      connectionDisplayNamePlaceholder: "Atlassian connection",
      dialog,
      methodId: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
    });

    expect(screen.getByLabelText(/Cloud ID/)).toBeTruthy();
    expect(screen.getByLabelText(/Client ID/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter service account OAuth client secret")).toBeTruthy();
  });
});
