import {
  integrationConnections,
  IntegrationCredentialSecretKinds,
  integrationTargets,
} from "@mistle/db/control-plane";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { describe, expect } from "vitest";

import { CreateFormConnectionBodySchema } from "../src/integration-connections/create-form-connection/schema.js";
import { IntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  UpdateFormConnectionBadRequestResponseSchema,
  UpdateFormConnectionBodySchema,
  UpdateFormConnectionNotFoundResponseSchema,
} from "../src/integration-connections/update-form-connection/schema.js";
import {
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

describe("integration connections update form integration", () => {
  it("updates an existing form connection credential for the same connection id", async ({
    fixture,
  }) => {
    await upsertOpenAiTarget({ fixture, targetKey: "openai-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form@example.com",
    });

    const createBody = CreateFormConnectionBodySchema.parse({
      displayName: "OpenAI primary",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      secrets: {
        apiKey: "sk-test-original-api-key",
      },
    });

    const createResponse = await fixture.request(
      "/v1/integration/connections/openai-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify(createBody),
      },
    );

    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const previousLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, createdConnection.id), eq(table.purpose, "api_key")),
    });
    expect(previousLink).toBeDefined();

    if (previousLink === undefined) {
      throw new Error("Expected an existing form credential link.");
    }

    const updateBody = UpdateFormConnectionBodySchema.parse({
      displayName: "OpenAI rotated",
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      secrets: {
        apiKey: "sk-test-rotated-api-key",
      },
    });

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify(updateBody),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.id).toBe(createdConnection.id);
    expect(updatedConnection.targetKey).toBe(createdConnection.targetKey);
    expect(updatedConnection.displayName).toBe("OpenAI rotated");
    expect(updatedConnection.status).toBe("active");

    const updatedLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, createdConnection.id), eq(table.purpose, "api_key")),
    });
    expect(updatedLink).toBeDefined();

    if (updatedLink === undefined) {
      throw new Error("Expected updated form credential link.");
    }

    expect(updatedLink.credentialId).not.toBe(previousLink.credentialId);

    const updatedCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, updatedLink.credentialId),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(updatedCredential).toBeDefined();

    if (updatedCredential === undefined) {
      throw new Error("Expected updated integration credential.");
    }

    expect(updatedCredential.secretKind).toBe(IntegrationCredentialSecretKinds.API_KEY);
    expect(updatedCredential.intendedFamilyId).toBe("openai");

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.version, updatedCredential.organizationCredentialKeyVersion),
        ),
    });
    expect(organizationCredentialKey).toBeDefined();

    if (organizationCredentialKey === undefined) {
      throw new Error("Expected organization credential key.");
    }

    const decryptedApiKey = decryptStoredApiKey({
      wrappedOrganizationKeyCiphertext: organizationCredentialKey.ciphertext,
      masterKeyVersion: organizationCredentialKey.masterKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
      nonce: updatedCredential.nonce,
      ciphertext: updatedCredential.ciphertext,
    });

    expect(decryptedApiKey).toBe("sk-test-rotated-api-key");
  });

  it("returns 404 when the connection does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form-missing@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/icn_missing/form", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify(
        UpdateFormConnectionBodySchema.parse({
          displayName: "Missing connection",
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "sk-test-rotated-api-key",
          },
        }),
      ),
    });

    expect(response.status).toBe(404);
    const responseBody = UpdateFormConnectionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "CONNECTION_NOT_FOUND",
      message: "Integration connection 'icn_missing' was not found.",
    });
  });

  it("returns 400 when the connection is not a form connection", async ({ fixture }) => {
    await upsertOpenAiTarget({ fixture, targetKey: "openai-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form-non-form@example.com",
    });

    const [createdConnection] = await fixture.db
      .insert(integrationConnections)
      .values({
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default",
        displayName: "Redirect-only connection",
        status: "active",
        config: {},
        targetSnapshotConfig: {
          api_base_url: "https://api.openai.com",
        },
      })
      .returning({
        id: integrationConnections.id,
      });

    if (createdConnection === undefined) {
      throw new Error("Expected integration connection.");
    }

    const response = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Redirect-only connection",
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "sk-test-rotated-api-key",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = UpdateFormConnectionBadRequestResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "FORM_CONNECTION_REQUIRED",
      message: `Integration connection '${createdConnection.id}' is not a form connection.`,
    });
  });

  it("keeps the existing credential when secret is omitted", async ({ fixture }) => {
    await upsertOpenAiTarget({ fixture, targetKey: "openai-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form-name-only@example.com",
    });

    const createResponse = await fixture.request(
      "/v1/integration/connections/openai-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI primary",
          methodId: IntegrationConnectionMethodIds.API_KEY,
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "sk-test-original-api-key",
          },
        }),
      },
    );

    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const previousLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, createdConnection.id), eq(table.purpose, "api_key")),
    });
    expect(previousLink).toBeDefined();

    if (previousLink === undefined) {
      throw new Error("Expected existing credential link.");
    }

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI renamed",
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
        }),
      },
    );

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("OpenAI renamed");

    const updatedLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, createdConnection.id), eq(table.purpose, "api_key")),
    });
    expect(updatedLink).toBeDefined();

    if (updatedLink === undefined) {
      throw new Error("Expected credential link to remain.");
    }

    expect(updatedLink.credentialId).toBe(previousLink.credentialId);
  });

  it("returns 400 when secret is provided as only whitespace", async ({ fixture }) => {
    await upsertOpenAiTarget({ fixture, targetKey: "openai-default" });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-form-whitespace-secret@example.com",
    });

    const createResponse = await fixture.request(
      "/v1/integration/connections/openai-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI primary",
          methodId: IntegrationConnectionMethodIds.API_KEY,
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "sk-test-original-api-key",
          },
        }),
      },
    );

    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "OpenAI renamed",
          config: {
            connection_method: IntegrationConnectionMethodIds.API_KEY,
          },
          secrets: {
            apiKey: "   ",
          },
        }),
      },
    );

    expect(updateResponse.status).toBe(400);
    const responseBody = ValidationErrorResponseSchema.parse(await updateResponse.json());
    expect(responseBody).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });
});

async function upsertOpenAiTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
}) {
  await input.fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com",
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
        },
      },
    });
}

function decryptStoredApiKey(input: {
  wrappedOrganizationKeyCiphertext: string;
  masterKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
  nonce: string;
  ciphertext: string;
}): string {
  const masterKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: input.masterKeyVersion,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });
  const organizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: input.wrappedOrganizationKeyCiphertext,
    masterEncryptionKeyMaterial: masterKeyMaterial,
  });

  try {
    return decryptCredentialUtf8({
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      organizationCredentialKey,
    });
  } finally {
    organizationCredentialKey.fill(0);
  }
}
