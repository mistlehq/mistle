// @vitest-environment jsdom

import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";
import { JiraConnectionMethodIds } from "@mistle/integrations-definitions/jira";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { resolveConnectionMethodFormUiModel } from "../pages/use-integration-connection-editor-state-helpers.js";
import {
  formatDeviceAuthorizationExpiry,
  IntegrationConnectionEditorPage,
  type IntegrationConnectionMethod,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionEditorState,
} from "./integration-connection-editor.js";

const ChatGptDeviceAuthorizationMethodId = "chatgpt-device-code";
const ChatGptDeviceAuthorizationMethod = {
  id: ChatGptDeviceAuthorizationMethodId,
  label: "ChatGPT subscription",
  kind: "device-authorization",
  ui: {
    create: {
      submitLabel: "Connect",
    },
    pending: {
      title: "Approve via ChatGPT",
      description: "Open the link below and enter the code to approve access.",
    },
  },
} satisfies Extract<IntegrationConnectionMethod, { kind: "device-authorization" }>;

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
      createBehavior: "draft-then-setup",
      secretFields: [
        {
          name: "setupSecret",
          label: "Setup secret",
          placeholder: "Hidden setup secret",
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
    methodId: IntegrationConnectionMethodIds.API_KEY,
    changedSecretNames: [],
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
      secretFields: [
        {
          name: "appPrivateKeyPem",
          label: "App private key PEM",
          placeholder: "-----BEGIN PRIVATE KEY-----",
          inputType: "textarea",
        },
        {
          name: "webhookSecret",
          label: "Webhook secret",
          placeholder: "Enter webhook secret",
          inputType: "password",
        },
      ],
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

  it("keeps create password secrets masked while focused", () => {
    renderEditorPage({
      secrets: {
        apiKey: "new-api-key",
      },
    });

    const input = screen.getByDisplayValue("new-api-key");

    expect(input.getAttribute("type")).toBe("password");
    fireEvent.focus(input);
    expect(input.getAttribute("type")).toBe("password");
  });

  it("renders configured update secrets with a masked placeholder", () => {
    renderEditorPage({
      editor: createUpdateFormEditor({
        configuredSecretNames: ["webhookSecret"],
      }),
      connectionDisplayNameValue: "Existing GitHub App installation connection",
      hasChanges: false,
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    });

    expect(screen.getByPlaceholderText("••••••")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Leave blank to keep existing webhook secret")).toBeNull();
  });

  it("does not show a dialog for configured secret replacements", () => {
    renderEditorPage({
      editor: createUpdateFormEditor({
        configuredSecretNames: ["webhookSecret"],
      }),
      connectionDisplayNameValue: "Existing GitHub App installation connection",
      hasChanges: false,
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      secrets: {
        webhookSecret: "replacement-secret",
      },
    });

    const input = screen.getByDisplayValue("replacement-secret");

    expect(input.getAttribute("type")).toBe("password");
    fireEvent.focus(input);
    expect(input.getAttribute("type")).toBe("text");
    fireEvent.blur(input);

    expect(input.getAttribute("type")).toBe("password");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("does not show a dialog for unconfigured update secrets", () => {
    renderEditorPage({
      editor: createUpdateFormEditor(),
      connectionDisplayNameValue: "Existing GitHub App installation connection",
      hasChanges: true,
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      secrets: {
        webhookSecret: "new-webhook-secret",
      },
    });

    fireEvent.blur(screen.getByDisplayValue("new-webhook-secret"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("marks only changed secrets as updating", () => {
    renderEditorPage({
      changedSecretNames: ["webhookSecret"],
      editor: createUpdateFormEditor({
        configuredSecretNames: ["appPrivateKeyPem", "webhookSecret"],
      }),
      connectionDisplayNameValue: "Existing GitHub App installation connection",
      hasChanges: true,
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----",
        webhookSecret: "replacement-secret",
      },
    });

    expect(screen.getAllByText("Replace on save")).toHaveLength(1);
  });

  it("renders optional secret descriptions as tooltip affordances without optional label suffixes", () => {
    renderEditorPage({
      editor: createUpdateFormEditor({
        connectionConfig: {
          connection_method: SlackConnectionMethodId,
        },
        currentConnectionConfig: {
          connection_method: SlackConnectionMethodId,
        },
        currentMethod: {
          id: SlackConnectionMethodId,
          label: "Slack app",
          kind: "form",
          secretFields: [
            {
              name: "clientSecret",
              label: "Client secret (Linked User Auth)",
              description:
                "Required only for Identity Linking / linked user authorization. Not required for standard Slack app bot-token usage.",
              inputType: "password",
              optional: true,
            },
          ],
        },
        targetConfig: {
          api_base_url: "https://slack.com/api",
        },
        targetDisplayName: "Slack",
        targetFamilyId: "slack",
        targetKey: "slack-default",
        targetVariantId: "slack-default",
      }),
      connectionDisplayNameValue: "Existing Slack connection",
      methodId: SlackConnectionMethodId,
    });

    expect(screen.getByLabelText("Client secret (Linked User Auth)")).toBeTruthy();
    expect(screen.queryByText("Client secret (Linked User Auth) (Optional)")).toBeNull();

    const labelContainer = screen.getByText("Client secret (Linked User Auth)").closest("div");
    if (labelContainer === null) {
      throw new Error("Expected Client secret label container.");
    }

    const descriptionButton = within(labelContainer).getByRole("button", {
      name: "Field description",
    });
    fireEvent.mouseEnter(descriptionButton);
    expect(
      screen.getByText(
        "Required only for Identity Linking / linked user authorization. Not required for standard Slack app bot-token usage.",
      ),
    ).toBeTruthy();
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

    expect(screen.getByLabelText(/Site name/)).toBeTruthy();
    expect(screen.getByText("https://")).toBeTruthy();
    expect(screen.getByText(".atlassian.net")).toBeTruthy();
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

  it("does not render device-authorization pending instructions before authorization starts", () => {
    const editor: Extract<IntegrationConnectionEditorState, { mode: "create" }> = {
      methods: [ChatGptDeviceAuthorizationMethod],
      mode: "create",
      targetConfig: {},
      targetDisplayName: "OpenAI",
      targetFamilyId: "openai",
      targetKey: "openai-default",
      targetVariantId: "openai-default",
    };

    renderEditorPage({
      editor,
      methodId: ChatGptDeviceAuthorizationMethodId,
    });

    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.queryByText("Approve via ChatGPT")).toBeNull();
  });

  it("renders device-authorization pending instructions and controls", () => {
    renderEditorPage({
      deviceAuthorizationPending: {
        targetKey: "openai-default",
        attemptId: "ida_123",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "ABCD-1234",
        expiresAt: "2099-04-01T00:00:00.000Z",
        method: ChatGptDeviceAuthorizationMethod,
      },
    });

    expect(screen.getByText("Approve via ChatGPT")).toBeTruthy();
    expect(
      screen.getByText("Open the link below and enter the code to approve access."),
    ).toBeTruthy();
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Code" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "https://auth.openai.com/codex/device" })).toBeTruthy();
    expect(screen.getByText(/^This code expires in .* at /u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel authorization" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cancel authorization" }).hasAttribute("disabled"),
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Add connection" })).toBeNull();
  });

  it("formats device-authorization expiry relative to the current time", () => {
    expect(
      formatDeviceAuthorizationExpiry({
        expiresAt: "2026-04-27T08:10:01.000Z",
        now: new Date("2026-04-27T08:00:00.000Z"),
      }),
    ).toBe(
      `This code expires in 11 minutes at ${new Date("2026-04-27T08:10:01.000Z").toLocaleTimeString(
        [],
        {
          hour: "numeric",
          minute: "2-digit",
        },
      )}.`,
    );

    expect(
      formatDeviceAuthorizationExpiry({
        expiresAt: "2026-04-27T08:00:30.000Z",
        now: new Date("2026-04-27T08:00:00.000Z"),
      }),
    ).toBe(
      `This code expires in less than 1 minute at ${new Date(
        "2026-04-27T08:00:30.000Z",
      ).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}.`,
    );

    expect(
      formatDeviceAuthorizationExpiry({
        expiresAt: "2026-04-27T08:00:00.000Z",
        now: new Date("2026-04-27T08:00:01.000Z"),
      }),
    ).toBe(
      `This code expired at ${new Date("2026-04-27T08:00:00.000Z").toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}.`,
    );
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

  it("skips create-time setup fields for GitHub App installation", () => {
    renderEditorPage({
      configForm: {
        mode: "form",
        schema: {
          type: "object",
          properties: {
            ignored_setup_field: {
              type: "string",
              title: "Ignored setup field",
            },
          },
        },
        uiSchema: {},
        value: {},
        visiblePropertyKeys: ["ignored_setup_field"],
      },
      connectionDisplayNamePlaceholder: "GitHub connection",
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    });

    expect(screen.queryByLabelText("Ignored setup field")).toBeNull();
    expect(screen.queryByPlaceholderText("Hidden setup secret")).toBeNull();
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
      visiblePropertyKeys: ["app_id", "app_slug", "client_id"],
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

  it("requires the Slack app id in the connection configuration form", () => {
    const editor: IntegrationConnectionEditorState = {
      mode: "update",
      connectionId: "icn_slack",
      currentConnectionConfig: {
        connection_method: SlackConnectionMethodId,
      },
      currentMethod: {
        id: SlackConnectionMethodId,
        label: "Slack app",
        kind: "form",
        secretFields: [],
      },
      targetConfig: {
        api_base_url: "https://slack.com/api",
      },
      targetDisplayName: "Slack",
      targetFamilyId: "slack",
      targetKey: "slack-default",
      targetVariantId: "slack-default",
    };

    const configForm = resolveConnectionMethodFormUiModel({
      editor,
      methodId: SlackConnectionMethodId,
      currentValue: {
        connection_method: SlackConnectionMethodId,
      },
    });

    expect(configForm).toMatchObject({
      mode: "form",
      schema: {
        required: ["connection_method", "app_id"],
      },
      visiblePropertyKeys: ["app_id", "client_id"],
    });
  });
});
