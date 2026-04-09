import { describe, expect, it } from "vitest";

import {
  assertOpenAiChatGptDeviceCodeConnectionConfig,
  OpenAiConnectionConfigSchema,
  resolveOpenAiCredentialSecretType,
  resolveOpenAiCredentialSlotKey,
} from "./auth.js";

describe("OpenAI auth", () => {
  it("parses the api-key connection method", () => {
    expect(
      OpenAiConnectionConfigSchema.parse({
        connection_method: "api-key",
      }),
    ).toEqual({ connection_method: "api-key" });
  });

  it("parses the chatgpt-device-code connection method", () => {
    expect(
      OpenAiConnectionConfigSchema.parse({
        connection_method: "chatgpt-device-code",
        auth_mode: "chatgpt",
        chatgpt_account_id: "acct_123",
        chatgpt_plan_type: "pro",
      }),
    ).toEqual({
      connection_method: "chatgpt-device-code",
      auth_mode: "chatgpt",
      chatgpt_account_id: "acct_123",
      chatgpt_plan_type: "pro",
    });
  });

  it("resolves credential secret type for the supported connection method", () => {
    expect(resolveOpenAiCredentialSecretType({ connection_method: "api-key" })).toBe("api_key");
    expect(
      resolveOpenAiCredentialSecretType({
        connection_method: "chatgpt-device-code",
        auth_mode: "chatgpt",
        chatgpt_account_id: "acct_123",
      }),
    ).toBe("oauth2_access_token");
  });

  it("resolves the credential slot key for each supported connection method", () => {
    expect(
      resolveOpenAiCredentialSlotKey({
        familyId: "openai",
        variantId: "openai-default",
        connectionConfig: {
          connection_method: "api-key",
        },
      }),
    ).toBe("openai.openai-default.api-key.api-key");

    expect(
      resolveOpenAiCredentialSlotKey({
        familyId: "openai",
        variantId: "openai-default",
        connectionConfig: {
          connection_method: "chatgpt-device-code",
          auth_mode: "chatgpt",
          chatgpt_account_id: "acct_123",
        },
      }),
    ).toBe("openai.openai-default.oauth2-authorization-code.access-token");
  });

  it("asserts the ChatGPT device-code connection config shape", () => {
    expect(
      assertOpenAiChatGptDeviceCodeConnectionConfig({
        connection_method: "chatgpt-device-code",
        auth_mode: "chatgpt",
        chatgpt_account_id: "acct_123",
        chatgpt_plan_type: "pro",
      }),
    ).toEqual({
      connection_method: "chatgpt-device-code",
      auth_mode: "chatgpt",
      chatgpt_account_id: "acct_123",
      chatgpt_plan_type: "pro",
    });

    expect(() =>
      assertOpenAiChatGptDeviceCodeConnectionConfig({
        connection_method: "api-key",
      }),
    ).toThrow("Expected OpenAI ChatGPT device-code connection config");
  });
});
