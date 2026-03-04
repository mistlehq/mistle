import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationOauthSessions,
  integrationTargets,
} from "@mistle/db/control-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
  CompleteOAuthConnectionBodySchema,
  IntegrationConnectionSchema,
  IntegrationConnectionsBadRequestResponseSchema,
  StartOAuthConnectionResponseSchema,
} from "../src/integration-connections/contracts.js";
import {
  decryptIntegrationConnectionSecrets,
  resolveMasterEncryptionKeyMaterial,
} from "../src/integration-credentials/crypto.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

async function ensureGithubCloudTarget(fixture: ControlPlaneApiIntegrationFixture): Promise<void> {
  await fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: "github-cloud",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
        app_slug: "mistle-github-app",
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
          web_base_url: "https://github.com",
          app_slug: "mistle-github-app",
        },
      },
    });
}

async function ensureOpenAiDefaultTarget(
  fixture: ControlPlaneApiIntegrationFixture,
): Promise<void> {
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
}

describe("integration connections oauth integration", () => {
  it("creates an oauth authorization URL and persists oauth session state", async ({ fixture }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth-start@example.com",
    });

    const response = await fixture.request("/v1/integration/connections/github-cloud/oauth/start", {
      method: "POST",
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);
    const responseBody = StartOAuthConnectionResponseSchema.parse(await response.json());
    const authorizationUrl = new URL(responseBody.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");

    expect(authorizationUrl.pathname).toBe("/apps/mistle-github-app/installations/new");
    expect(state).toBeTruthy();

    if (state === null) {
      throw new Error("Expected oauth state in authorization URL.");
    }

    const oauthSession = await fixture.db.query.integrationOauthSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.targetKey, "github-cloud"),
          eq(table.state, state),
        ),
    });

    expect(oauthSession).toBeDefined();
    if (oauthSession === undefined) {
      throw new Error("Expected persisted oauth session.");
    }

    expect(Date.parse(oauthSession.expiresAt)).toBeGreaterThan(Date.parse(oauthSession.createdAt));
    expect(oauthSession.usedAt).toBeNull();
  });

  it("creates an oauth-backed connection and marks oauth state as used", async ({ fixture }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth-complete@example.com",
    });

    const startResponse = await fixture.request(
      "/v1/integration/connections/github-cloud/oauth/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(startResponse.status).toBe(200);
    const startBody = StartOAuthConnectionResponseSchema.parse(await startResponse.json());
    const startUrl = new URL(startBody.authorizationUrl);
    const state = startUrl.searchParams.get("state");

    if (state === null || state.length === 0) {
      throw new Error("Expected oauth state in authorization URL.");
    }

    const requestBody = CompleteOAuthConnectionBodySchema.parse({
      query: {
        state,
        installation_id: "12345",
        setup_action: "install",
      },
      secrets: {
        webhook_secret: "whsec_oauth_flow",
      },
    });

    const completeResponse = await fixture.request(
      "/v1/integration/connections/github-cloud/oauth/complete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify(requestBody),
      },
    );

    expect(completeResponse.status).toBe(201);
    const completeBody = IntegrationConnectionSchema.parse(await completeResponse.json());

    expect(completeBody.targetKey).toBe("github-cloud");
    expect(completeBody.status).toBe("active");
    expect(completeBody.externalSubjectId).toBe("12345");
    expect(completeBody.config).toEqual({
      auth_scheme: "oauth",
      installation_id: "12345",
      setup_action: "install",
    });

    const persistedConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.id, completeBody.id),
          eq(table.organizationId, authenticatedSession.organizationId),
        ),
    });
    expect(persistedConnection).toBeDefined();
    if (persistedConnection === undefined) {
      throw new Error("Expected persisted oauth-backed connection.");
    }

    expect(persistedConnection.targetSnapshotConfig).toEqual({
      apiBaseUrl: "https://api.github.com/",
      webBaseUrl: "https://github.com/",
      appSlug: "mistle-github-app",
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
      webhook_secret: "whsec_oauth_flow",
    });

    const oauthSession = await fixture.db.query.integrationOauthSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.targetKey, "github-cloud"),
          eq(table.state, state),
        ),
    });
    expect(oauthSession).toBeDefined();
    if (oauthSession === undefined) {
      throw new Error("Expected persisted oauth session.");
    }

    expect(oauthSession.usedAt).not.toBeNull();

    const linkedCredentials = await fixture.db
      .select({
        connectionId: integrationConnectionCredentials.connectionId,
      })
      .from(integrationConnectionCredentials)
      .where(eq(integrationConnectionCredentials.connectionId, completeBody.id));
    expect(linkedCredentials).toHaveLength(0);
  });

  it("returns 400 when oauth completion secrets include unsupported keys", async ({ fixture }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth-complete-unsupported-secret@example.com",
    });

    const startResponse = await fixture.request(
      "/v1/integration/connections/github-cloud/oauth/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(startResponse.status).toBe(200);
    const startBody = StartOAuthConnectionResponseSchema.parse(await startResponse.json());
    const startUrl = new URL(startBody.authorizationUrl);
    const state = startUrl.searchParams.get("state");
    if (state === null || state.length === 0) {
      throw new Error("Expected oauth state in authorization URL.");
    }

    const response = await fixture.request(
      "/v1/integration/connections/github-cloud/oauth/complete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          query: {
            state,
            installation_id: "12345",
            setup_action: "install",
          },
          secrets: {
            unknown_secret: "not-allowed",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_OAUTH_COMPLETE_INPUT");
    expect(responseBody.message).toContain("unsupported key 'unknown_secret'");
  });

  it("returns 400 when oauth completion state is missing", async ({ fixture }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth-complete-missing-state@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/github-cloud/oauth/complete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          query: {
            installation_id: "12345",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_OAUTH_COMPLETE_INPUT");
  });

  it("returns 400 when oauth completion state is invalid", async ({ fixture }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth-complete-invalid-state@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/github-cloud/oauth/complete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          query: {
            state: "ios_nonexistent",
            installation_id: "12345",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("OAUTH_STATE_INVALID");
  });

  it("returns 400 when oauth completion state has expired", async ({ fixture }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth-complete-expired-state@example.com",
    });

    await fixture.db.insert(integrationOauthSessions).values({
      organizationId: authenticatedSession.organizationId,
      targetKey: "github-cloud",
      state: "oauth_state_expired",
      expiresAt: new Date("2020-01-01T00:00:00.000Z").toISOString(),
    });

    const response = await fixture.request(
      "/v1/integration/connections/github-cloud/oauth/complete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          query: {
            state: "oauth_state_expired",
            installation_id: "12345",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("OAUTH_STATE_EXPIRED");

    const connectionRows = await fixture.db
      .select({
        id: integrationConnections.id,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, authenticatedSession.organizationId));
    expect(connectionRows).toHaveLength(0);
  });

  it("returns 400 when oauth completion state was already used", async ({ fixture }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth-complete-used-state@example.com",
    });

    await fixture.db.insert(integrationOauthSessions).values({
      organizationId: authenticatedSession.organizationId,
      targetKey: "github-cloud",
      state: "oauth_state_used",
      expiresAt: new Date("2030-01-01T00:00:00.000Z").toISOString(),
      usedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    });

    const response = await fixture.request(
      "/v1/integration/connections/github-cloud/oauth/complete",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          query: {
            state: "oauth_state_used",
            installation_id: "12345",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("OAUTH_STATE_ALREADY_USED");
  });

  it("returns 400 when the target does not support oauth", async ({ fixture }) => {
    await ensureOpenAiDefaultTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-oauth-unsupported-target@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default/oauth/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("OAUTH_NOT_SUPPORTED");
  });
});

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
