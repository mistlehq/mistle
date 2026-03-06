import {
  integrationConnections,
  IntegrationCredentialSecretKinds,
  integrationTargets,
} from "@mistle/db/control-plane";
import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";
import { describe, expect } from "vitest";

import {
  CreateApiKeyConnectionBodySchema,
  IntegrationConnectionSchema,
  IntegrationConnectionsBadRequestResponseSchema,
  IntegrationConnectionsNotFoundResponseSchema,
  UpdateApiKeyConnectionBodySchema,
} from "../src/integration-connections/contracts.js";
import {
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/integration-credentials/crypto.js";
import { it } from "./test-context.js";

describe("integration connections update api key integration", () => {
  it("updates an existing API-key connection credential for the same connection id", async ({
    fixture,
  }) => {
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default",
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

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-api-key@example.com",
    });

    const createBody = CreateApiKeyConnectionBodySchema.parse({
      apiKey: "sk-test-original-api-key",
    });

    const createResponse = await fixture.request(
      "/v1/integration/connections/openai-default/api-key",
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
      throw new Error("Expected an existing API-key credential link.");
    }

    const updateBody = UpdateApiKeyConnectionBodySchema.parse({
      apiKey: "sk-test-rotated-api-key",
    });

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/api-key`,
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
    expect(updatedConnection.status).toBe("active");

    const updatedLink = await fixture.db.query.integrationConnectionCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.connectionId, createdConnection.id), eq(table.purpose, "api_key")),
    });
    expect(updatedLink).toBeDefined();

    if (updatedLink === undefined) {
      throw new Error("Expected updated API-key credential link.");
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

    expect(decryptedApiKey).toBe(updateBody.apiKey);
  });

  it("returns 404 when the connection does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-api-key-missing@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/icn_missing/api-key", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        apiKey: "sk-test-rotated-api-key",
      }),
    });

    expect(response.status).toBe(404);
    const responseBody = IntegrationConnectionsNotFoundResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "CONNECTION_NOT_FOUND",
      message: "Integration connection 'icn_missing' was not found.",
    });
  });

  it("returns 400 when the connection is not an API-key connection", async ({ fixture }) => {
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "openai-default",
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

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-update-api-key-non-api-key@example.com",
    });

    const [createdConnection] = await fixture.db
      .insert(integrationConnections)
      .values({
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default",
        status: "active",
        config: {
          auth_scheme: IntegrationSupportedAuthSchemes.OAUTH,
        },
        targetSnapshotConfig: {
          api_base_url: "https://api.openai.com",
        },
      })
      .returning({
        id: integrationConnections.id,
      });

    if (createdConnection === undefined) {
      throw new Error("Expected OAuth integration connection.");
    }

    const response = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(createdConnection.id)}/api-key`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          apiKey: "sk-test-rotated-api-key",
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      code: "API_KEY_CONNECTION_REQUIRED",
      message: `Integration connection '${createdConnection.id}' is not an API-key connection.`,
    });

    const credentialLinks = await fixture.db.query.integrationConnectionCredentials.findMany({
      where: (table, { eq }) => eq(table.connectionId, createdConnection.id),
    });
    expect(credentialLinks).toHaveLength(0);
  });
});

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
