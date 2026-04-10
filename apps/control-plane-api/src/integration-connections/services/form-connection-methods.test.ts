import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  parseFormConnectionConfigOrThrow,
  parseCreateFormSecretsOrThrow,
  parseUpdateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
  resolvePersistedSecretRefOrThrow,
} from "./form-connection-methods.js";

describe("resolveFormConnectionMethodOrThrow", () => {
  it("returns the selected form method", () => {
    const method = resolveFormConnectionMethodOrThrow({
      targetKey: "github-cloud",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      connectionMethods: [
        {
          id: IntegrationConnectionMethodIds.API_KEY,
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              secretType: IntegrationCredentialSecretKinds.API_KEY,
              slotKey: "test.api-key",
            },
          ],
          configSchema: z
            .object({
              connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
            })
            .loose(),
        },
      ],
      invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
    });

    expect(method.id).toBe(IntegrationConnectionMethodIds.API_KEY);
    expect(method.kind).toBe("form");
  });

  it("throws when the selected method is not a form method", () => {
    let thrownError: unknown = null;

    try {
      resolveFormConnectionMethodOrThrow({
        targetKey: "oauth2-only-target",
        methodId: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        connectionMethods: [
          {
            id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
            label: "OAuth",
            kind: "redirect",
            ui: {
              create: {
                submitLabel: "Continue to provider",
                helperText: "Continue to the provider to complete this connection.",
              },
            },
          },
        ],
        invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestError);
    if (!(thrownError instanceof BadRequestError)) {
      throw new Error("Expected unsupported form method to throw.");
    }
    expect(thrownError.code).toBe("FORM_CONNECTION_METHOD_NOT_SUPPORTED");
    expect(thrownError.message).toBe(
      "Integration target 'oauth2-only-target' does not support form connection method 'oauth2-authorization-code'.",
    );
  });

  it("throws when the selected method is a device-authorization method", () => {
    let thrownError: unknown = null;

    try {
      resolveFormConnectionMethodOrThrow({
        targetKey: "openai-device-auth-only-target",
        methodId: "chatgpt-device-code",
        connectionMethods: [
          {
            id: "chatgpt-device-code",
            label: "ChatGPT subscription",
            kind: "device-authorization",
            ui: {
              create: {
                submitLabel: "Continue",
                helperText: "Continue to device authorization.",
              },
              pending: {
                title: "Waiting for approval",
                description: "Finish approval in your browser.",
              },
            },
          },
        ],
        invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestError);
    if (!(thrownError instanceof BadRequestError)) {
      throw new Error("Expected device-authorization method to throw.");
    }
    expect(thrownError.code).toBe("FORM_CONNECTION_METHOD_NOT_SUPPORTED");
    expect(thrownError.message).toBe(
      "Integration target 'openai-device-auth-only-target' does not support form connection method 'chatgpt-device-code'.",
    );
  });
});

describe("parseFormConnectionConfigOrThrow", () => {
  it("returns parsed config objects", () => {
    const parsedConfig = parseFormConnectionConfigOrThrow({
      targetKey: "openai-default",
      method: {
        id: IntegrationConnectionMethodIds.API_KEY,
        label: "API key",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "API key",
            inputType: "password",
            secretType: IntegrationCredentialSecretKinds.API_KEY,
            slotKey: "test.api-key",
          },
        ],
        configSchema: z
          .object({
            connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
          })
          .loose(),
      },
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
    });

    expect(parsedConfig).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });
  });

  it("throws a bad request error for invalid config", () => {
    let thrownError: unknown = null;

    try {
      parseFormConnectionConfigOrThrow({
        targetKey: "openai-default",
        method: {
          id: IntegrationConnectionMethodIds.API_KEY,
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
              secretType: IntegrationCredentialSecretKinds.API_KEY,
              slotKey: "test.api-key",
            },
          ],
          configSchema: z
            .object({
              connection_method: z.literal(IntegrationConnectionMethodIds.API_KEY),
            })
            .loose(),
        },
        config: {},
        invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestError);
    if (!(thrownError instanceof BadRequestError)) {
      throw new Error("Expected invalid config to throw.");
    }
    expect(thrownError.code).toBe("INVALID_CREATE_CONNECTION_INPUT");
    expect(thrownError.message).toBe("Connection config for method 'api-key' is invalid.");
  });
});

describe("resolvePersistedSecretRefOrThrow", () => {
  it("maps api_key to persisted secret kind and slot key", () => {
    expect(
      resolvePersistedSecretRefOrThrow({
        slotKey: "test.api-key",
        secretType: IntegrationCredentialSecretKinds.API_KEY,
        invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
      }),
    ).toEqual({
      secretKind: IntegrationCredentialSecretKinds.API_KEY,
      slotKey: "test.api-key",
    });
  });

  it("maps aws_secret_access_key to persisted secret kind and slot key", () => {
    expect(
      resolvePersistedSecretRefOrThrow({
        slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
        secretType: IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
        invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
      }),
    ).toEqual({
      secretKind: IntegrationCredentialSecretKinds.AWS_SECRET_ACCESS_KEY,
      slotKey: "aws.aws-cli-default.aws-assume-role.secret-access-key",
    });
  });

  it("maps oauth2_client_secret to persisted secret kind and slot key", () => {
    expect(
      resolvePersistedSecretRefOrThrow({
        slotKey: "test.client-secret",
        secretType: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
        invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
      }),
    ).toEqual({
      secretKind: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
      slotKey: "test.client-secret",
    });
  });

  it("throws for unsupported persisted secret types", () => {
    let thrownError: unknown = null;

    try {
      resolvePersistedSecretRefOrThrow({
        slotKey: "test.github-installation",
        secretType: "github_app_installation_token",
        invalidInputCode: "INVALID_UPDATE_CONNECTION_INPUT",
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(BadRequestError);
    if (!(thrownError instanceof BadRequestError)) {
      throw new Error("Expected unsupported secret type to throw.");
    }
    expect(thrownError.code).toBe("INVALID_UPDATE_CONNECTION_INPUT");
    expect(thrownError.message).toBe(
      "Unsupported persisted secret type 'github_app_installation_token'.",
    );
  });
});

describe("parseCreateFormSecretsOrThrow", () => {
  it("returns normalized persisted secrets for all declared secret fields", () => {
    const parsedSecrets = parseCreateFormSecretsOrThrow({
      targetKey: "openai-default",
      method: {
        id: IntegrationConnectionMethodIds.API_KEY,
        label: "API key",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "API key",
            inputType: "password",
            secretType: IntegrationCredentialSecretKinds.API_KEY,
            slotKey: "test.api-key",
          },
        ],
        configSchema: z.object({}).loose(),
      },
      secrets: {
        apiKey: "  sk-test-api-key  ",
      },
      invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
    });

    expect(parsedSecrets).toEqual([
      {
        field: {
          name: "apiKey",
          label: "API key",
          inputType: "password",
          secretType: IntegrationCredentialSecretKinds.API_KEY,
          slotKey: "test.api-key",
        },
        normalizedValue: "sk-test-api-key",
        persistedSecretRef: {
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          slotKey: "test.api-key",
        },
      },
    ]);
  });
});

describe("parseUpdateFormSecretsOrThrow", () => {
  it("returns only the provided secrets during update", () => {
    const parsedSecrets = parseUpdateFormSecretsOrThrow({
      targetKey: "openai-default",
      method: {
        id: IntegrationConnectionMethodIds.API_KEY,
        label: "API key",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "API key",
            inputType: "password",
            secretType: IntegrationCredentialSecretKinds.API_KEY,
            slotKey: "test.api-key",
          },
        ],
        configSchema: z.object({}).loose(),
      },
      secrets: {
        apiKey: "  sk-rotated-api-key  ",
      },
      invalidInputCode: "INVALID_UPDATE_CONNECTION_INPUT",
    });

    expect(parsedSecrets).toEqual([
      {
        field: {
          name: "apiKey",
          label: "API key",
          inputType: "password",
          secretType: IntegrationCredentialSecretKinds.API_KEY,
          slotKey: "test.api-key",
        },
        normalizedValue: "sk-rotated-api-key",
        persistedSecretRef: {
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          slotKey: "test.api-key",
        },
      },
    ]);
  });
});
