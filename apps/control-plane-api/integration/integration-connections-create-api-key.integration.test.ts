import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationCredentials,
  IntegrationCredentialSecretKinds,
  integrationTargets,
} from "@mistle/db/control-plane";
import { IntegrationSupportedAuthSchemes } from "@mistle/integrations-core";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
  CreateApiKeyConnectionBodySchema,
  IntegrationConnectionSchema,
  IntegrationConnectionsBadRequestResponseSchema,
  IntegrationConnectionsNotFoundResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/integration-connections/contracts.js";
import {
  decryptCredentialUtf8,
  decryptIntegrationConnectionSecrets,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/integration-credentials/crypto.js";
import { it } from "./test-context.js";

describe("integration connections create api key integration", () => {
  it("creates connection + encrypted credential + link for an enabled target", async ({
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
      email: "integration-connections-create-api-key@example.com",
    });

    const requestBody = CreateApiKeyConnectionBodySchema.parse({
      apiKey: "sk-test-connection-api-key",
    });

    const response = await fixture.request("/v1/integration/connections/openai-default/api-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());

    expect(responseBody.targetKey).toBe("openai-default");
    expect(responseBody.status).toBe("active");
    expect(responseBody.config).toEqual({
      auth_scheme: IntegrationSupportedAuthSchemes.API_KEY,
    });
    expect(responseBody.targetSnapshotConfig).toEqual({
      api_base_url: "https://api.openai.com",
    });

    const createdConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, responseBody.id),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(createdConnection).toBeDefined();

    if (createdConnection === undefined) {
      throw new Error("Expected created integration connection.");
    }
    expect(createdConnection.config).toEqual({
      auth_scheme: IntegrationSupportedAuthSchemes.API_KEY,
    });

    const createdConnectionCredential =
      await fixture.db.query.integrationConnectionCredentials.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.connectionId, createdConnection.id), eq(table.purpose, "api_key")),
      });
    expect(createdConnectionCredential).toBeDefined();

    if (createdConnectionCredential === undefined) {
      throw new Error("Expected integration connection credential link.");
    }

    const createdCredential = await fixture.db.query.integrationCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, createdConnectionCredential.credentialId),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(createdCredential).toBeDefined();

    if (createdCredential === undefined) {
      throw new Error("Expected integration credential.");
    }

    expect(createdCredential.secretKind).toBe(IntegrationCredentialSecretKinds.API_KEY);
    expect(createdCredential.intendedFamilyId).toBe("openai");
    expect(createdCredential.ciphertext).not.toContain(requestBody.apiKey);

    const organizationCredentialKey = await fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.version, createdCredential.organizationCredentialKeyVersion),
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
      nonce: createdCredential.nonce,
      ciphertext: createdCredential.ciphertext,
    });

    expect(decryptedApiKey).toBe(requestBody.apiKey);
  }, 60_000);

  it("returns 404 when target does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-api-key-missing-target@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/missing_target/api-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        apiKey: "sk-test-missing-target",
      }),
    });

    expect(response.status).toBe(404);
    const responseBody = IntegrationConnectionsNotFoundResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      code: "TARGET_NOT_FOUND",
      message: "Integration target 'missing_target' was not found.",
    });
  }, 60_000);

  it("stores encrypted connection secrets when provided for a target secret slot", async ({
    fixture,
  }) => {
    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey: "github-cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
        },
      })
      .onConflictDoUpdate({
        target: integrationTargets.targetKey,
        set: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            api_base_url: "https://api.github.com",
          },
        },
      });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-api-key-github-secrets@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/github-cloud/api-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        apiKey: "ghp_test_secret",
        secrets: {
          webhook_secret: "whsec_123",
        },
      }),
    });

    expect(response.status).toBe(201);
    const responseBody = IntegrationConnectionSchema.parse(await response.json());
    expect(responseBody.config).toEqual({
      auth_scheme: IntegrationSupportedAuthSchemes.API_KEY,
    });

    const persistedConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, responseBody.id),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(persistedConnection).toBeDefined();

    if (persistedConnection === undefined) {
      throw new Error("Expected persisted integration connection.");
    }
    expect(persistedConnection.config).toEqual({
      auth_scheme: IntegrationSupportedAuthSchemes.API_KEY,
    });

    expect(persistedConnection.secrets).not.toBeNull();
    if (persistedConnection.secrets === null) {
      throw new Error("Expected encrypted connection secrets.");
    }

    const decryptedConnectionSecrets = decryptStoredConnectionSecrets({
      encryptedSecrets: persistedConnection.secrets,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
    });
    expect(decryptedConnectionSecrets).toEqual({
      webhook_secret: "whsec_123",
    });
  }, 60_000);

  it("returns 400 when request secrets include unsupported keys", async ({ fixture }) => {
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
      email: "integration-connections-create-api-key-unsupported-secret@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/openai-default/api-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        apiKey: "sk-test-secret-value",
        secrets: {
          webhook_secret: "unsupported-for-openai",
        },
      }),
    });

    expect(response.status).toBe(400);
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_CREATE_CONNECTION_INPUT");
    expect(responseBody.message).toContain("unsupported key 'webhook_secret'");
  }, 60_000);

  it("returns 404 when target exists but is disabled", async ({ fixture }) => {
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-disabled",
      familyId: "openai",
      variantId: "openai-default",
      enabled: false,
      config: {
        api_base_url: "https://api.openai.com",
      },
    });

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-api-key-disabled-target@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/openai-disabled/api-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        apiKey: "sk-test-disabled-target",
      }),
    });

    expect(response.status).toBe(404);
    const responseBody = IntegrationConnectionsNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("TARGET_NOT_FOUND");
  }, 60_000);

  it("returns 400 for invalid create body payload", async ({ fixture }) => {
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
      email: "integration-connections-create-api-key-validation@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/openai-default/api-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        apiKey: "",
      }),
    });

    expect(response.status).toBe(400);
    const responseBody = ValidationErrorResponseSchema.parse(await response.json());
    expect(responseBody.success).toBe(false);
    expect(responseBody.error.name).toBe("ZodError");
  }, 60_000);

  it("returns 401 when request is unauthenticated", async ({ fixture }) => {
    const response = await fixture.request("/v1/integration/connections/openai-default/api-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apiKey: "sk-test-unauthenticated",
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  }, 60_000);

  it("does not create connection records when target lookup fails", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-create-api-key-no-records@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/missing_target/api-key", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        apiKey: "sk-test-no-records",
      }),
    });

    expect(response.status).toBe(404);

    const connectionRows = await fixture.db
      .select({
        id: integrationConnections.id,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, authenticatedSession.organizationId));
    expect(connectionRows).toHaveLength(0);

    const credentialRows = await fixture.db
      .select({
        id: integrationCredentials.id,
      })
      .from(integrationCredentials)
      .where(eq(integrationCredentials.organizationId, authenticatedSession.organizationId));
    expect(credentialRows).toHaveLength(0);

    const connectionCredentialRows = await fixture.db
      .select({
        connectionId: integrationConnectionCredentials.connectionId,
      })
      .from(integrationConnectionCredentials)
      .innerJoin(
        integrationConnections,
        eq(integrationConnections.id, integrationConnectionCredentials.connectionId),
      )
      .where(eq(integrationConnections.organizationId, authenticatedSession.organizationId));
    expect(connectionCredentialRows).toHaveLength(0);
  }, 60_000);
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

function decryptStoredConnectionSecrets(input: {
  encryptedSecrets: {
    masterKeyVersion: number;
    nonce: string;
    ciphertext: string;
  };
  masterEncryptionKeys: Record<string, string>;
}): Record<string, string> {
  const masterKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: input.encryptedSecrets.masterKeyVersion,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });

  return decryptIntegrationConnectionSecrets({
    nonce: input.encryptedSecrets.nonce,
    ciphertext: input.encryptedSecrets.ciphertext,
    masterEncryptionKeyMaterial: masterKeyMaterial,
  });
}
