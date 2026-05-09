import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  type AnyIntegrationDefinition,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildFormConnectionMethodContextOrThrow,
  parseFormConnectionConfigOrThrow,
  parseCreateFormSecretsOrThrow,
  parseUpdateFormSecretsOrThrow,
  resolveFormConnectionMethodOrThrow,
  resolvePersistedSecretRefOrThrow,
} from "./form-connection-methods.js";

const SlackTargetKey = "slack-default";
const SlackConnectionMethodId = "slack-bot-token";

const SlackTarget = {
  familyId: "slack",
  variantId: SlackTargetKey,
  config: {
    api_base_url: "https://slack.com/api",
  },
};

const SlackDefinition: Pick<AnyIntegrationDefinition, "kind" | "targetConfigSchema"> = {
  kind: "connector",
  targetConfigSchema: z.object({
    api_base_url: z.url(),
  }),
};

function expectBadRequestError(
  error: unknown,
  expected: {
    code: string;
    message: string;
  },
): void {
  expect(error).toBeInstanceOf(BadRequestError);
  if (!(error instanceof BadRequestError)) {
    throw new Error("Expected a bad request error.");
  }
  expect(error.code).toBe(expected.code);
  expect(error.message).toBe(expected.message);
}

describe("buildFormConnectionMethodContextOrThrow", () => {
  it("returns parsed target and connection config for update form context", () => {
    const context = buildFormConnectionMethodContextOrThrow({
      targetKey: SlackTargetKey,
      target: SlackTarget,
      definition: SlackDefinition,
      currentValue: {
        connection_method: SlackConnectionMethodId,
        app_id: "A123",
      },
      connection: {
        id: "icn_slack",
        config: {
          connection_method: SlackConnectionMethodId,
          app_id: "A000",
        },
      },
      invalidInputCode: "INVALID_UPDATE_CONNECTION_INPUT",
    });

    expect(context).toEqual({
      familyId: "slack",
      variantId: SlackTargetKey,
      kind: "connector",
      target: {
        rawConfig: {
          api_base_url: "https://slack.com/api",
        },
        config: {
          api_base_url: "https://slack.com/api",
        },
      },
      currentValue: {
        connection_method: SlackConnectionMethodId,
        app_id: "A123",
      },
      connection: {
        id: "icn_slack",
        rawConfig: {
          connection_method: SlackConnectionMethodId,
          app_id: "A000",
        },
        config: {
          connection_method: SlackConnectionMethodId,
          app_id: "A000",
        },
      },
    });
  });

  it("throws a bad request error when stored target config is invalid", () => {
    let thrownError: unknown = null;

    try {
      buildFormConnectionMethodContextOrThrow({
        targetKey: SlackTargetKey,
        target: {
          ...SlackTarget,
          config: {
            api_base_url: "",
          },
        },
        definition: SlackDefinition,
        currentValue: {
          connection_method: SlackConnectionMethodId,
        },
        invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
      });
    } catch (error) {
      thrownError = error;
    }

    expectBadRequestError(thrownError, {
      code: "INVALID_CREATE_CONNECTION_INPUT",
      message: "Integration target 'slack-default' has invalid config.",
    });
  });

  it("throws a bad request error when stored connection config is not an object", () => {
    let thrownError: unknown = null;

    try {
      buildFormConnectionMethodContextOrThrow({
        targetKey: SlackTargetKey,
        target: SlackTarget,
        definition: SlackDefinition,
        currentValue: {
          connection_method: SlackConnectionMethodId,
        },
        connection: {
          id: "icn_slack",
          config: null,
        },
        invalidInputCode: "INVALID_UPDATE_CONNECTION_INPUT",
      });
    } catch (error) {
      thrownError = error;
    }

    expectBadRequestError(thrownError, {
      code: "INVALID_UPDATE_CONNECTION_INPUT",
      message: "Integration connection 'icn_slack' has invalid config.",
    });
  });
});

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

    expectBadRequestError(thrownError, {
      code: "FORM_CONNECTION_METHOD_NOT_SUPPORTED",
      message:
        "Integration target 'oauth2-only-target' does not support form connection method 'oauth2-authorization-code'.",
    });
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

    expectBadRequestError(thrownError, {
      code: "FORM_CONNECTION_METHOD_NOT_SUPPORTED",
      message:
        "Integration target 'openai-device-auth-only-target' does not support form connection method 'chatgpt-device-code'.",
    });
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

    expectBadRequestError(thrownError, {
      code: "INVALID_CREATE_CONNECTION_INPUT",
      message: "Connection config for method 'api-key' is invalid.",
    });
  });

  it("throws a bad request error when a required visible config field is missing", () => {
    let thrownError: unknown = null;

    try {
      parseFormConnectionConfigOrThrow({
        targetKey: SlackTargetKey,
        method: {
          id: SlackConnectionMethodId,
          label: "Slack app",
          kind: "form",
          secretFields: [],
          configSchema: z
            .object({
              connection_method: z.literal(SlackConnectionMethodId),
              app_id: z.string().min(1).optional(),
            })
            .strict(),
          configForm: {
            schema: {
              properties: {
                connection_method: {
                  default: SlackConnectionMethodId,
                },
                app_id: {
                  title: "App ID",
                },
              },
              required: ["connection_method", "app_id"],
            },
            uiSchema: {
              connection_method: {
                "ui:widget": "hidden",
              },
            },
          },
        },
        config: {
          connection_method: SlackConnectionMethodId,
        },
        formContext: {
          familyId: "slack",
          variantId: SlackTargetKey,
          kind: "connector",
          currentValue: {
            connection_method: SlackConnectionMethodId,
          },
        },
        invalidInputCode: "INVALID_UPDATE_CONNECTION_INPUT",
      });
    } catch (error) {
      thrownError = error;
    }

    expectBadRequestError(thrownError, {
      code: "INVALID_UPDATE_CONNECTION_INPUT",
      message: "Connection config field 'App ID' is required for method 'slack-bot-token'.",
    });
  });

  it("throws a bad request error when resolved required config fields are malformed", () => {
    let thrownError: unknown = null;

    try {
      parseFormConnectionConfigOrThrow({
        targetKey: SlackTargetKey,
        method: {
          id: SlackConnectionMethodId,
          label: "Slack app",
          kind: "form",
          secretFields: [],
          configSchema: z
            .object({
              connection_method: z.literal(SlackConnectionMethodId),
            })
            .strict(),
          configForm: {
            schema: {
              required: ["connection_method", 123],
            },
          },
        },
        config: {
          connection_method: SlackConnectionMethodId,
        },
        formContext: {
          familyId: "slack",
          variantId: SlackTargetKey,
          kind: "connector",
        },
        invalidInputCode: "INVALID_UPDATE_CONNECTION_INPUT",
      });
    } catch (error) {
      thrownError = error;
    }

    expectBadRequestError(thrownError, {
      code: "INVALID_UPDATE_CONNECTION_INPUT",
      message: "Connection config for method 'slack-bot-token' is invalid.",
    });
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

    expectBadRequestError(thrownError, {
      code: "INVALID_UPDATE_CONNECTION_INPUT",
      message: "Unsupported persisted secret type 'github_app_installation_token'.",
    });
  });
});

describe("parseCreateFormSecretsOrThrow", () => {
  it("returns normalized persisted secrets for all declared secret fields", () => {
    const parsedSecrets = parseCreateFormSecretsOrThrow({
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

  it("allows optional secret fields to be omitted during create", () => {
    const parsedSecrets = parseCreateFormSecretsOrThrow({
      method: {
        id: "slack-bot-token",
        label: "Slack app",
        kind: "form",
        secretFields: [
          {
            name: "botToken",
            label: "Bot token",
            inputType: "password",
            secretType: IntegrationCredentialSecretKinds.API_KEY,
            slotKey: "slack.slack-default.slack-bot-token.bot-token",
          },
          {
            name: "clientSecret",
            label: "Client secret (Linked User Auth)",
            inputType: "password",
            optional: true,
            secretType: IntegrationCredentialSecretKinds.OAUTH2_CLIENT_SECRET,
            slotKey: "slack.slack-default.slack-bot-token.client-secret",
          },
        ],
        configSchema: z.object({}).loose(),
      },
      secrets: {
        botToken: "xoxb-slack-bot-token",
      },
      invalidInputCode: "INVALID_CREATE_CONNECTION_INPUT",
    });

    expect(parsedSecrets).toEqual([
      {
        field: {
          name: "botToken",
          label: "Bot token",
          inputType: "password",
          secretType: IntegrationCredentialSecretKinds.API_KEY,
          slotKey: "slack.slack-default.slack-bot-token.bot-token",
        },
        normalizedValue: "xoxb-slack-bot-token",
        persistedSecretRef: {
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          slotKey: "slack.slack-default.slack-bot-token.bot-token",
        },
      },
    ]);
  });
});

describe("parseUpdateFormSecretsOrThrow", () => {
  it("returns only the provided secrets during update", () => {
    const parsedSecrets = parseUpdateFormSecretsOrThrow({
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
