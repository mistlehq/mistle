import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationConnectionRedirectSessions,
  integrationTargets,
} from "@mistle/db/control-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { buildDashboardUrl } from "../src/dashboard-url.js";
import {
  CompleteGitHubAppInstallationConnectionQuerySchema,
  IntegrationConnectionsBadRequestResponseSchema,
  StartGitHubAppInstallationConnectionResponseSchema,
} from "../src/integration-connections/contracts.js";
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

function createDashboardOrganizationIntegrationsUrl(
  fixture: ControlPlaneApiIntegrationFixture,
): string {
  return buildDashboardUrl(fixture.config.dashboard.baseUrl, "/settings/organization/integrations");
}

describe("integration connections GitHub App installation integration", () => {
  function createGitHubAppInstallationCompletePath(input: {
    targetKey: string;
    query: Record<string, string>;
  }): string {
    const query = CompleteGitHubAppInstallationConnectionQuerySchema.parse(input.query);
    const searchParams = new URLSearchParams(query);
    return `/v1/integration/connections/${input.targetKey}/github-app-installation/complete?${searchParams.toString()}`;
  }

  it("creates a GitHub App installation authorization URL and persists redirect session state", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-start@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/github-cloud/github-app-installation/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = StartGitHubAppInstallationConnectionResponseSchema.parse(
      await response.json(),
    );
    const authorizationUrl = new URL(responseBody.authorizationUrl);
    const state = authorizationUrl.searchParams.get("state");

    expect(authorizationUrl.pathname).toBe("/apps/mistle-github-app/installations/new");
    expect(state).toBeTruthy();

    if (state === null) {
      throw new Error("Expected redirect state in authorization URL.");
    }

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

  it("creates a GitHub App installation connection without requiring auth and marks redirect state as used", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-complete@example.com",
    });

    const startResponse = await fixture.request(
      "/v1/integration/connections/github-cloud/github-app-installation/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );
    expect(startResponse.status).toBe(200);
    const startBody = StartGitHubAppInstallationConnectionResponseSchema.parse(
      await startResponse.json(),
    );
    const startUrl = new URL(startBody.authorizationUrl);
    const state = startUrl.searchParams.get("state");

    if (state === null || state.length === 0) {
      throw new Error("Expected redirect state in authorization URL.");
    }

    const completeResponse = await fixture.request(
      createGitHubAppInstallationCompletePath({
        targetKey: "github-cloud",
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
          eq(table.targetKey, "github-cloud"),
          eq(table.externalSubjectId, "12345"),
        ),
    });
    expect(persistedConnection).toBeDefined();
    if (persistedConnection === undefined) {
      throw new Error("Expected persisted GitHub App installation connection.");
    }

    expect(persistedConnection.displayName).toBe("12345");
    expect(persistedConnection.status).toBe("active");
    expect(persistedConnection.externalSubjectId).toBe("12345");
    expect(persistedConnection.config).toEqual({
      connection_method: "github-app-installation",
      installation_id: "12345",
      setup_action: "install",
    });
    expect(persistedConnection.targetSnapshotConfig).toEqual({
      apiBaseUrl: "https://api.github.com",
      webBaseUrl: "https://github.com",
      appSlug: "mistle-github-app",
    });
    expect(persistedConnection.secrets).toBeNull();

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
    expect(linkedCredentials).toHaveLength(0);
  });

  it("preserves the requested display name when completing GitHub App installation connection creation", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-display-name@example.com",
    });

    const startResponse = await fixture.request(
      "/v1/integration/connections/github-cloud/github-app-installation/start",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "GitHub Prod",
        }),
      },
    );
    expect(startResponse.status).toBe(200);
    const startBody = StartGitHubAppInstallationConnectionResponseSchema.parse(
      await startResponse.json(),
    );
    const startUrl = new URL(startBody.authorizationUrl);
    const state = startUrl.searchParams.get("state");

    if (state === null || state.length === 0) {
      throw new Error("Expected redirect state in authorization URL.");
    }

    const completeResponse = await fixture.request(
      createGitHubAppInstallationCompletePath({
        targetKey: "github-cloud",
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
          eq(table.targetKey, "github-cloud"),
          eq(table.externalSubjectId, "12345"),
        ),
    });
    expect(persistedConnection).toBeDefined();
    if (persistedConnection === undefined) {
      throw new Error("Expected persisted GitHub App installation connection.");
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
        targetKey: "github-cloud",
        query: {
          installation_id: "12345",
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
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
        targetKey: "github-cloud",
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
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("REDIRECT_STATE_INVALID");
  });

  it("returns 400 when GitHub App installation completion state has expired", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-complete-expired-state@example.com",
    });

    await fixture.db.insert(integrationConnectionRedirectSessions).values({
      organizationId: authenticatedSession.organizationId,
      targetKey: "github-cloud",
      state: "redirect_state_expired",
      expiresAt: new Date("2020-01-01T00:00:00.000Z").toISOString(),
    });

    const response = await fixture.request(
      createGitHubAppInstallationCompletePath({
        targetKey: "github-cloud",
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
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
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

    await fixture.db.insert(integrationConnectionRedirectSessions).values({
      organizationId: authenticatedSession.organizationId,
      targetKey: "github-cloud",
      state: "redirect_state_used",
      expiresAt: new Date("2030-01-01T00:00:00.000Z").toISOString(),
      usedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    });

    const response = await fixture.request(
      createGitHubAppInstallationCompletePath({
        targetKey: "github-cloud",
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
    const responseBody = IntegrationConnectionsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("REDIRECT_STATE_ALREADY_USED");
  });

  it("returns 400 when the target does not support GitHub App installation", async ({
    fixture,
  }) => {
    await ensureOpenAiDefaultTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-unsupported-target@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/openai-default/github-app-installation/start",
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
    expect(responseBody.code).toBe("GITHUB_APP_INSTALLATION_NOT_SUPPORTED");
  });
});
