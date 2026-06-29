import { describe, expect, it } from "vitest";

import {
  createInitialIntegrationConnectionEditorState,
  resolveConnectionMethodFormUiModel,
} from "./use-integration-connection-editor-state-helpers.js";

describe("createInitialIntegrationConnectionEditorState", () => {
  it("preserves device authorization reauthorization input on update editors", () => {
    const { editor } = createInitialIntegrationConnectionEditorState({
      defaultMethodId: "chatgpt-device-code",
      initialEditorInput: {
        mode: "update",
        connectionId: "icn_openai_chatgpt",
        connectionConfig: {
          connection_method: "chatgpt-device-code",
          auth_mode: "chatgpt",
        },
        currentMethod: {
          id: "chatgpt-device-code",
          label: "ChatGPT subscription",
          kind: "device-authorization",
          ui: {
            create: {
              submitLabel: "Connect",
            },
            reauthorize: {
              actionLabel: "Re-authorize",
              pendingLabel: "Starting...",
            },
          },
        },
        reauthorization: {
          kind: "device-authorization",
        },
        targetConfig: {},
        targetDisplayName: "OpenAI",
        targetFamilyId: "openai",
        targetKey: "openai-default",
        targetVariantId: "openai-default",
      },
    });

    expect(editor).toMatchObject({
      mode: "update",
      connectionId: "icn_openai_chatgpt",
      reauthorization: {
        kind: "device-authorization",
      },
    });
  });
});

describe("resolveConnectionMethodFormUiModel", () => {
  it("hides the Modal connection method discriminator while preserving the selected method value", () => {
    const formUiModel = resolveConnectionMethodFormUiModel({
      editor: {
        methods: [
          {
            id: "api-key",
            label: "Token",
            kind: "form",
            secretFields: [
              {
                name: "tokenId",
                label: "Token ID",
                inputType: "password",
              },
              {
                name: "tokenSecret",
                label: "Token secret",
                inputType: "password",
              },
            ],
          },
        ],
        mode: "create",
        targetConfig: {},
        targetDisplayName: "Modal",
        targetFamilyId: "modal",
        targetKey: "modal-default",
        targetVariantId: "modal-default",
      },
      methodId: "api-key",
      currentValue: {},
    });

    expect(formUiModel).toMatchObject({
      mode: "form",
      value: {
        connection_method: "api-key",
      },
      uiSchema: {
        connection_method: {
          "ui:widget": "hidden",
        },
      },
      visiblePropertyKeys: [],
    });
  });

  it("keeps connection method hidden when a multi-method integration has visible config fields", () => {
    const formUiModel = resolveConnectionMethodFormUiModel({
      editor: {
        methods: [
          {
            id: "jira-personal-api-token",
            label: "Personal API token",
            kind: "form",
            secretFields: [
              {
                name: "apiKey",
                label: "Personal API token",
                inputType: "password",
              },
            ],
          },
        ],
        mode: "create",
        targetConfig: {},
        targetDisplayName: "Jira",
        targetFamilyId: "jira",
        targetKey: "jira-default",
        targetVariantId: "jira-default",
      },
      methodId: "jira-personal-api-token",
      currentValue: {},
    });

    expect(formUiModel).toMatchObject({
      mode: "form",
      value: {
        connection_method: "jira-personal-api-token",
      },
      uiSchema: {
        connection_method: {
          "ui:widget": "hidden",
        },
      },
    });
    if (formUiModel.mode !== "form") {
      throw new Error("Expected Jira form UI model.");
    }

    expect(formUiModel.visiblePropertyKeys).toContain("site_url");
    expect(formUiModel.visiblePropertyKeys).toContain("email");
    expect(formUiModel.visiblePropertyKeys).not.toContain("connection_method");
  });
});
