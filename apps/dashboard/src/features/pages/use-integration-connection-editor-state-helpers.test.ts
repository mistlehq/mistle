import { describe, expect, it } from "vitest";

import { createInitialIntegrationConnectionEditorState } from "./use-integration-connection-editor-state-helpers.js";

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
