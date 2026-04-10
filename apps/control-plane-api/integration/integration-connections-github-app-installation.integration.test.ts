import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationConnectionRedirectSessions,
  integrationTargets,
} from "@mistle/db/control-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
  CompleteGitHubAppInstallationConnectionBadRequestResponseSchema,
  CompleteGitHubAppInstallationConnectionNotFoundResponseSchema,
  CompleteGitHubAppInstallationConnectionQuerySchema,
} from "../src/integration-connections/complete-github-app-installation-connection/schema.js";
import { IntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  StartGitHubAppInstallationConnectionBadRequestResponseSchema,
  StartGitHubAppInstallationConnectionNotFoundResponseSchema,
  StartGitHubAppInstallationConnectionResponseSchema,
} from "../src/integration-connections/start-github-app-installation-connection/schema.js";
import { buildDashboardUrl } from "../src/lib/dashboard-url.js";
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
        },
      },
    });
}

function createDashboardOrganizationIntegrationsUrl(
  fixture: ControlPlaneApiIntegrationFixture,
): string {
  return buildDashboardUrl(fixture.config.dashboard.baseUrl, "/integrations");
}

describe("integration connections GitHub App installation integration", () => {
  function createGitHubAppInstallationCompletePath(input: {
    query: Record<string, string>;
  }): string {
    const query = CompleteGitHubAppInstallationConnectionQuerySchema.parse(input.query);
    const searchParams = new URLSearchParams(query);
    return `/p/integration/callbacks/github-app-installation?${searchParams.toString()}`;
  }

  it("creates a GitHub App installation authorization URL for an existing connection and persists redirect session state", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubAppConnection(fixture, {
      email: "integration-connections-github-app-installation-start@example.com",
      displayName: "GitHub Prod",
    });
    const { state, authorizationUrl } = await startGitHubAppInstallationConnection(fixture, {
      authenticatedSession,
      connectionId,
    });

    expect(authorizationUrl.pathname).toBe("/apps/mistle-github-app/installations/new");
    expect(state).toBeTruthy();

    const redirectSession = await fixture.db.query.integrationConnectionRedirectSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.targetKey, "github-cloud"),
          eq(table.state, state),
        ),
    });

    expect(redirectSession).toBeDefined();
    if (redirectSession === undefined) {
      throw new Error("Expected persisted redirect session.");
    }

    expect(Date.parse(redirectSession.expiresAt)).toBeGreaterThan(
      Date.parse(redirectSession.createdAt),
    );
    expect(redirectSession.usedAt).toBeNull();
  });

  it("completes installation by updating the existing GitHub App connection without requiring auth", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubAppConnection(fixture, {
      email: "integration-connections-github-app-installation-complete@example.com",
      displayName: "GitHub Prod",
    });
    const { state } = await startGitHubAppInstallationConnection(fixture, {
      authenticatedSession,
      connectionId,
    });

    const completeResponse = await fixture.request(
      createGitHubAppInstallationCompletePath({
        query: {
          state,
          installation_id: "12345",
          setup_action: "install",
        },
      }),
      {
        method: "GET",
        redirect: "manual",
      },
    );

    expect(completeResponse.status).toBe(302);
    expect(completeResponse.headers.get("location")).toBe(
      createDashboardOrganizationIntegrationsUrl(fixture),
    );

    const persistedConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.id, connectionId),
        ),
    });
    expect(persistedConnection).toBeDefined();
    if (persistedConnection === undefined) {
      throw new Error("Expected persisted GitHub App connection.");
    }

    expect(persistedConnection.id).toBe(connectionId);
    expect(persistedConnection.displayName).toBe("GitHub Prod");
    expect(persistedConnection.status).toBe("active");
    expect(persistedConnection.externalSubjectId).toBe("12345");
    expect(persistedConnection.config).toEqual({
      connection_method: "github-app-installation",
      app_id: "123",
      app_slug: "mistle-github-app",
      installation_id: "12345",
      setup_action: "install",
    });
    expect(persistedConnection.targetSnapshotConfig).toEqual({
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    });

    const redirectSession = await fixture.db.query.integrationConnectionRedirectSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.targetKey, "github-cloud"),
          eq(table.state, state),
        ),
    });
    expect(redirectSession).toBeDefined();
    if (redirectSession === undefined) {
      throw new Error("Expected persisted redirect session.");
    }

    expect(redirectSession.usedAt).not.toBeNull();

    const linkedCredentials = await fixture.db
      .select({
        connectionId: integrationConnectionCredentials.connectionId,
      })
      .from(integrationConnectionCredentials)
      .where(eq(integrationConnectionCredentials.connectionId, persistedConnection.id));
    expect(linkedCredentials).toHaveLength(2);

    const persistedWebhookSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.integrationConnectionId, persistedConnection.id),
        ),
    });
    expect(persistedWebhookSource).toBeDefined();
    if (persistedWebhookSource === undefined) {
      throw new Error("Expected GitHub App implicit webhook source.");
    }
    expect(persistedWebhookSource.endpointKey).toBeTruthy();
  });

  it("preserves the existing connection display name when completing GitHub App installation", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubAppConnection(fixture, {
      email: "integration-connections-github-app-installation-display-name@example.com",
      displayName: "GitHub Prod",
    });
    const { state } = await startGitHubAppInstallationConnection(fixture, {
      authenticatedSession,
      connectionId,
    });

    const completeResponse = await fixture.request(
      createGitHubAppInstallationCompletePath({
        query: {
          state,
          installation_id: "12345",
          setup_action: "install",
        },
      }),
      {
        method: "GET",
        redirect: "manual",
      },
    );

    expect(completeResponse.status).toBe(302);
    expect(completeResponse.headers.get("location")).toBe(
      createDashboardOrganizationIntegrationsUrl(fixture),
    );

    const persistedConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.id, connectionId),
        ),
    });
    expect(persistedConnection).toBeDefined();
    if (persistedConnection === undefined) {
      throw new Error("Expected persisted GitHub App connection.");
    }

    expect(persistedConnection.displayName).toBe("GitHub Prod");
    expect(persistedConnection.externalSubjectId).toBe("12345");
  });

  it("returns 400 when GitHub App installation completion state is missing", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const response = await fixture.request(
      createGitHubAppInstallationCompletePath({
        query: {
          installation_id: "12345",
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CompleteGitHubAppInstallationConnectionBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT");
  });

  it("returns 400 when GitHub App installation completion state is invalid", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const response = await fixture.request(
      createGitHubAppInstallationCompletePath({
        query: {
          state: "ios_nonexistent",
          installation_id: "12345",
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CompleteGitHubAppInstallationConnectionBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("REDIRECT_STATE_INVALID");
  });

  it("returns 404 when the GitHub App installation completion connection no longer exists", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubAppConnection(fixture, {
      email:
        "integration-connections-github-app-installation-complete-missing-connection@example.com",
      displayName: "GitHub Prod",
    });
    const { state } = await startGitHubAppInstallationConnection(fixture, {
      authenticatedSession,
      connectionId,
    });

    await fixture.db
      .delete(integrationConnections)
      .where(eq(integrationConnections.id, connectionId));

    const response = await fixture.request(
      createGitHubAppInstallationCompletePath({
        query: {
          state,
          installation_id: "12345",
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(404);
    const responseBody = CompleteGitHubAppInstallationConnectionNotFoundResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("CONNECTION_NOT_FOUND");
  });

  it("returns 400 when GitHub App installation completion state has expired", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-complete-expired-state@example.com",
    });

    await insertRedirectSession(fixture, {
      organizationId: authenticatedSession.organizationId,
      state: "redirect_state_expired",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });

    const response = await fixture.request(
      createGitHubAppInstallationCompletePath({
        query: {
          state: "redirect_state_expired",
          installation_id: "12345",
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CompleteGitHubAppInstallationConnectionBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("REDIRECT_STATE_EXPIRED");

    const connectionRows = await fixture.db
      .select({
        id: integrationConnections.id,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.organizationId, authenticatedSession.organizationId));
    expect(connectionRows).toHaveLength(0);
  });

  it("returns 400 when GitHub App installation completion state was already used", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-complete-used-state@example.com",
    });

    await insertRedirectSession(fixture, {
      organizationId: authenticatedSession.organizationId,
      state: "redirect_state_used",
      expiresAt: "2030-01-01T00:00:00.000Z",
      usedAt: "2026-01-01T00:00:00.000Z",
    });

    const response = await fixture.request(
      createGitHubAppInstallationCompletePath({
        query: {
          state: "redirect_state_used",
          installation_id: "12345",
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CompleteGitHubAppInstallationConnectionBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("REDIRECT_STATE_ALREADY_USED");
  });

  it("returns 400 when the connection does not use GitHub App installation auth", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-unsupported-connection@example.com",
    });

    const createResponse = await fixture.request("/v1/integration/connections/github-cloud/form", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "GitHub API key",
        methodId: "api-key",
        config: {
          connection_method: "api-key",
        },
        secrets: {
          apiKey: "github-api-key",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await createResponse.json());

    const response = await fixture.request(
      `/v1/integration/connections/${createdConnection.id}/github-app-installation/start`,
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    const responseBody = StartGitHubAppInstallationConnectionBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("GITHUB_APP_INSTALLATION_NOT_SUPPORTED");
  });

  it("returns 404 when the GitHub App install start connection does not exist", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-missing-connection@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/icn_missing/github-app-installation/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = StartGitHubAppInstallationConnectionNotFoundResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("CONNECTION_NOT_FOUND");
  });
});

async function createGitHubAppConnection(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    email: string;
    displayName: string;
  },
): Promise<{
  authenticatedSession: Awaited<ReturnType<ControlPlaneApiIntegrationFixture["authSession"]>>;
  connectionId: string;
}> {
  const authenticatedSession = await fixture.authSession({
    email: input.email,
  });

  const response = await fixture.request("/v1/integration/connections/github-cloud/form", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: authenticatedSession.cookie,
    },
    body: JSON.stringify({
      displayName: input.displayName,
      methodId: "github-app-installation",
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
      },
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        webhookSecret: "github-webhook-secret",
      },
    }),
  });

  expect(response.status).toBe(201);
  const createdConnection = IntegrationConnectionSchema.parse(await response.json());

  return {
    authenticatedSession,
    connectionId: createdConnection.id,
  };
}

async function startGitHubAppInstallationConnection(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    authenticatedSession: Awaited<ReturnType<ControlPlaneApiIntegrationFixture["authSession"]>>;
    connectionId: string;
  },
): Promise<{ authorizationUrl: URL; state: string }> {
  const response = await fixture.request(
    `/v1/integration/connections/${input.connectionId}/github-app-installation/start`,
    {
      method: "POST",
      headers: {
        cookie: input.authenticatedSession.cookie,
      },
    },
  );

  expect(response.status).toBe(200);
  const responseBody = StartGitHubAppInstallationConnectionResponseSchema.parse(
    await response.json(),
  );
  const authorizationUrl = new URL(responseBody.authorizationUrl);
  const state = authorizationUrl.searchParams.get("state");

  if (state === null || state.length === 0) {
    throw new Error("Expected redirect state in authorization URL.");
  }

  return {
    authorizationUrl,
    state,
  };
}

async function insertRedirectSession(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    organizationId: string;
    state: string;
    expiresAt: string;
    usedAt?: string;
  },
): Promise<void> {
  await fixture.db.insert(integrationConnectionRedirectSessions).values({
    organizationId: input.organizationId,
    targetKey: "github-cloud",
    state: input.state,
    expiresAt: input.expiresAt,
    ...(input.usedAt === undefined ? {} : { usedAt: input.usedAt }),
  });
}
