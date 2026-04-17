// @vitest-environment jsdom

import { JiraConnectionMethodIds } from "@mistle/integrations-definitions/jira";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { resolveConnectionMethodFormUiModel } from "../pages/use-integration-connection-editor-state-helpers.js";
import {
  IntegrationConnectionEditorPage,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionEditorState,
} from "./integration-connection-editor.js";

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

const createEditor: IntegrationConnectionEditorState = {
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

function renderEditorPage(
  input: Partial<ComponentProps<typeof IntegrationConnectionEditorPage>> = {},
) {
  const props: ComponentProps<typeof IntegrationConnectionEditorPage> = {
    closeDisabled: false,
    configForm: {
      mode: "none",
    },
    configValue: {},
    connectionDisplayNamePlaceholder: "OpenAI connection",
    connectionDisplayNameValue: "",
    connectError: null,
    editor: createEditor,
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

  render(<IntegrationConnectionEditorPage {...props} />);
}

function createUpdateFormEditor(
  input: Partial<Extract<IntegrationConnectionEditorState, { mode: "update" }>> = {},
): Extract<IntegrationConnectionEditorState, { mode: "update" }> {
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

function createJiraCreateEditor(
  method: Extract<IntegrationConnectionEditorState, { mode: "create" }>["methods"][number],
): Extract<IntegrationConnectionEditorState, { mode: "create" }> {
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

describe("IntegrationConnectionEditorPage", () => {
  it("disables 1Password autofill for form secret input", () => {
    renderEditorPage();

    const input = screen.getByPlaceholderText("Enter API key");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("renders definition-driven config fields for form methods", () => {
    renderEditorPage({
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
      editor: {
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
    renderEditorPage({
      configValue: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      connectionDisplayNameValue: "Existing connection",
      editor: {
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
    renderEditorPage();

    expect(screen.getByRole("combobox", { name: "Authentication method" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("does not preselect an auth method in create mode", () => {
    renderEditorPage({
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
      renderEditorPage({
        connectionDisplayNameValue,
        editor: createUpdateFormEditor(),
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

  it("disables Cancel while a non-device submit is pending", () => {
    renderEditorPage({
      closeDisabled: true,
      pending: true,
    });

    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
  });

  it("renders Jira personal token configuration fields", () => {
    const editor = createJiraCreateEditor({
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
      editor,
      methodId: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      currentValue: {},
    });

    renderEditorPage({
      configForm,
      connectionDisplayNamePlaceholder: "Jira connection",
      editor,
      methodId: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
    });

    expect(screen.getByLabelText(/Site URL/)).toBeTruthy();
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter personal API token")).toBeTruthy();
  });

  it("renders definition-driven config fields for redirect methods", () => {
    const editor: Extract<IntegrationConnectionEditorState, { mode: "create" }> = {
      methods: [
        {
          id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
          label: "SigNoz OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect SigNoz",
              helperText: "Authorize SigNoz hosted MCP access.",
            },
          },
        },
      ],
      mode: "create",
      targetConfig: {},
      targetDisplayName: "SigNoz",
      targetFamilyId: "signoz",
      targetKey: "signoz-mcp",
      targetVariantId: "signoz-mcp",
    };

    const configForm = resolveConnectionMethodFormUiModel({
      editor,
      methodId: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      currentValue: {},
    });

    renderEditorPage({
      configForm,
      connectionDisplayNamePlaceholder: "SigNoz connection",
      editor,
      methodId: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
    });

    expect(screen.getByLabelText("Region")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect SigNoz" })).toBeTruthy();
  });

  it("does not render persisted redirect config fields when no start config schema is declared", () => {
    const editor: Extract<IntegrationConnectionEditorState, { mode: "create" }> = {
      methods: [
        {
          id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
          label: "PlanetScale OAuth",
          kind: "redirect",
          ui: {
            create: {
              submitLabel: "Connect PlanetScale",
              helperText: "Authorize PlanetScale hosted MCP access.",
            },
          },
        },
      ],
      mode: "create",
      targetConfig: {},
      targetDisplayName: "PlanetScale",
      targetFamilyId: "planetscale",
      targetKey: "planetscale-mcp",
      targetVariantId: "planetscale-mcp",
    };

    expect(
      resolveConnectionMethodFormUiModel({
        editor,
        methodId: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        currentValue: {},
      }),
    ).toEqual({
      mode: "none",
    });
  });

  it("renders device-authorization pending instructions and controls", () => {
    renderEditorPage({
      deviceAuthorizationPending: {
        targetKey: "openai-default",
        attemptId: "ida_123",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-1234",
        expiresAt: "2099-04-01T00:00:00.000Z",
        method: {
          id: "chatgpt-device-code",
          label: "ChatGPT subscription",
          kind: "device-authorization",
          ui: {
            create: {
              submitLabel: "Connect",
              helperText: "Connect with device authorization",
            },
            pending: {
              title: "Approve In ChatGPT",
              description: "Open the verification link and enter the code.",
            },
          },
        },
      },
    });

    expect(screen.getByText("Approve In ChatGPT")).toBeTruthy();
    expect(screen.getByText("Open the verification link and enter the code.")).toBeTruthy();
    expect(screen.getByDisplayValue("ABCD-1234")).toBeTruthy();
    expect(screen.getByRole("link", { name: "https://auth.openai.com/codex/device" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel authorization" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cancel authorization" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Add connection" })).toBeNull();
  });

  it("hides GitHub API key discriminator config and the nested rjsf submit button", () => {
    const editor: IntegrationConnectionEditorState = {
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
      editor,
      methodId: IntegrationConnectionMethodIds.API_KEY,
      currentValue: {},
    });

    expect(configForm).toMatchObject({
      mode: "form",
      visiblePropertyKeys: [],
    });

    renderEditorPage({
      configForm,
      connectionDisplayNamePlaceholder: "GitHub connection",
      editor,
      methodId: IntegrationConnectionMethodIds.API_KEY,
    });

    expect(screen.queryByText("Configuration")).toBeNull();
    expect(screen.queryByLabelText("connection_method")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.getByPlaceholderText("Enter API key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add connection" })).toBeTruthy();
  });

  it("renders GitHub App form fields in create mode", () => {
    renderEditorPage({
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
    expect(screen.getByRole("button", { name: "Add connection" })).toBeTruthy();
  });

  it("hides callback-managed GitHub App config fields from the form", () => {
    const configForm = resolveConnectionMethodFormUiModel({
      editor: createEditor,
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
});
