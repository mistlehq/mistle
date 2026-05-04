/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationCredentialSecretKinds,
  OrganizationIdentityLinkProviderConfigStatus,
} from "@mistle/db/control-plane";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  CreateFormConnectionBodySchema,
  CreateFormConnectionNotFoundResponseSchema,
} from "../src/integration-connections/create-form-connection/schema.js";
import {
  CreatedFormIntegrationConnectionSchema,
  IntegrationConnectionSchema,
} from "../src/integration-connections/schemas.js";
import {
  UpdateFormConnectionBadRequestResponseSchema,
  UpdateFormConnectionBodySchema,
  UpdateFormConnectionConflictResponseSchema,
  UpdateFormConnectionNotFoundResponseSchema,
} from "../src/integration-connections/update-form-connection/schema.js";
import {
  createFormConnection,
  expectCredentialSlots,
  readCredentialIds,
  seedIntegrationTarget,
  updateFormConnection,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("OpenAI form integration connections", () => {
  it("creates an active API-key connection with an encrypted credential", async ({ env }) => {
    await seedOpenAiTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-create-openai@example.com",
    });
    const body = CreateFormConnectionBodySchema.parse({
      displayName: "Primary OpenAI key",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      secrets: {
        apiKey: "sk-test-connection-api-key",
      },
    });

    const response = await createFormConnection({
      env,
      targetKey: "openai-default",
      cookie: session.cookie,
      body,
    });

    expect(response.status).toBe(201);
    const connection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
    expect(connection.targetKey).toBe("openai-default");
    expect(connection.displayName).toBe("Primary OpenAI key");
    expect(connection.status).toBe("active");
    expect(connection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });
    expect(connection.targetSnapshotConfig).toEqual({
      api_base_url: "https://api.openai.com",
    });

    await expectCredentialSlots({
      env,
      connectionId: connection.id,
      organizationId: session.organizationId,
      expected: [
        {
          slotKey: "openai.openai-default.api-key.api-key",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          intendedFamilyId: "openai",
          plaintext: body.secrets.apiKey,
        },
      ],
    });
  });

  it("rotates an API-key credential without changing the connection id", async ({ env }) => {
    await seedOpenAiTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-openai@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "openai-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "OpenAI primary",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-original-api-key",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );
    const previousCredentialIds = await readCredentialIds({
      env,
      connectionId: createdConnection.id,
    });

    const updateResponse = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: UpdateFormConnectionBodySchema.parse({
        displayName: "OpenAI rotated",
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-rotated-api-key",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.id).toBe(createdConnection.id);
    expect(updatedConnection.targetKey).toBe("openai-default");
    expect(updatedConnection.displayName).toBe("OpenAI rotated");
    expect(updatedConnection.status).toBe("active");

    await expectCredentialSlots({
      env,
      connectionId: createdConnection.id,
      organizationId: session.organizationId,
      previousCredentialIds,
      expected: [
        {
          slotKey: "openai.openai-default.api-key.api-key",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          intendedFamilyId: "openai",
          plaintext: "sk-test-rotated-api-key",
        },
      ],
    });
  });

  it("keeps the existing credential when an update omits the secret", async ({ env }) => {
    await seedOpenAiTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-openai-name-only@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "openai-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "OpenAI primary",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-original-api-key",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );
    const previousCredentialIds = await readCredentialIds({
      env,
      connectionId: createdConnection.id,
    });

    const updateResponse = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: UpdateFormConnectionBodySchema.parse({
        displayName: "OpenAI renamed",
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("OpenAI renamed");
    expect(
      await readCredentialIds({
        env,
        connectionId: createdConnection.id,
      }),
    ).toEqual(previousCredentialIds);
  });

  it("rejects form updates for connections used by active identity linking", async ({ env }) => {
    await seedOpenAiTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-openai-identity-linking@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "openai-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "OpenAI primary",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-original-api-key",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.organizationIdentityLinkProviderConfigs)
      .values({
        organizationId: session.organizationId,
        providerFamily: "openai",
        status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
        integrationTargetKey: "openai-default",
        integrationConnectionId: createdConnection.id,
        createdByUserId: session.userId,
        updatedByUserId: session.userId,
      });

    const response = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: UpdateFormConnectionBodySchema.parse({
        displayName: "OpenAI rotated",
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-rotated-api-key",
        },
      }),
    });

    expect(response.status).toBe(409);
    expect(UpdateFormConnectionConflictResponseSchema.parse(await response.json())).toEqual({
      code: "CONNECTION_USED_BY_IDENTITY_LINKING",
      message:
        "This integration connection cannot be edited while it is configured for Identity Linking.",
    });
  });

  it("rejects missing or disabled targets", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-create-openai-targets@example.com",
    });
    await seedIntegrationTarget(env, {
      targetKey: "openai-disabled",
      familyId: "openai",
      variantId: "openai-default",
      enabled: false,
      config: {
        api_base_url: "https://api.openai.com",
      },
    });

    const requestBody = CreateFormConnectionBodySchema.parse({
      displayName: "Missing target",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      secrets: {
        apiKey: "sk-test-missing-target",
      },
    });
    const missingResponse = await createFormConnection({
      env,
      targetKey: "missing_target",
      cookie: session.cookie,
      body: requestBody,
    });
    const disabledResponse = await createFormConnection({
      env,
      targetKey: "openai-disabled",
      cookie: session.cookie,
      body: requestBody,
    });

    expect(missingResponse.status).toBe(404);
    expect(CreateFormConnectionNotFoundResponseSchema.parse(await missingResponse.json())).toEqual({
      code: "TARGET_NOT_FOUND",
      message: "Integration target 'missing_target' was not found.",
    });
    expect(disabledResponse.status).toBe(404);
    expect(
      CreateFormConnectionNotFoundResponseSchema.parse(await disabledResponse.json()).code,
    ).toBe("TARGET_NOT_FOUND");
  });

  it("rejects malformed create and update payloads", async ({ env }) => {
    await seedOpenAiTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-openai-validation@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "openai-default",
      cookie: session.cookie,
      body: {
        displayName: "",
        methodId: "",
        config: {},
        secrets: {
          apiKey: "",
        },
      },
    });
    expect(createResponse.status).toBe(400);
    expect(ValidationErrorResponseSchema.parse(await createResponse.json())).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });

    const validCreateResponse = await createFormConnection({
      env,
      targetKey: "openai-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "OpenAI primary",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-original-api-key",
        },
      }),
    });
    expect(validCreateResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await validCreateResponse.json(),
    );

    const whitespaceSecretResponse = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: {
        displayName: "OpenAI renamed",
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "   ",
        },
      },
    });
    expect(whitespaceSecretResponse.status).toBe(400);
    expect(
      UpdateFormConnectionBadRequestResponseSchema.parse(await whitespaceSecretResponse.json()),
    ).toEqual({
      code: "INVALID_UPDATE_CONNECTION_INPUT",
      message:
        "Secret field 'API key' must contain at least one non-whitespace character when provided.",
    });
  });

  it("returns 404 when updating a missing connection", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-openai-missing@example.com",
    });

    const response = await updateFormConnection({
      env,
      connectionId: "icn_missing",
      cookie: session.cookie,
      body: UpdateFormConnectionBodySchema.parse({
        displayName: "Missing connection",
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-rotated-api-key",
        },
      }),
    });

    expect(response.status).toBe(404);
    expect(UpdateFormConnectionNotFoundResponseSchema.parse(await response.json())).toEqual({
      code: "CONNECTION_NOT_FOUND",
      message: "Integration connection 'icn_missing' was not found.",
    });
  });
});

async function seedOpenAiTarget(env: Parameters<typeof seedIntegrationTarget>[0]): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "openai-default",
    familyId: "openai",
    variantId: "openai-default",
    config: {
      api_base_url: "https://api.openai.com",
    },
  });
}
