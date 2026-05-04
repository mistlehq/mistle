/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  StartedProviderAppSetupResponseSchema,
  StartProviderAppSetupBadRequestResponseSchema,
  StartProviderAppSetupNotFoundResponseSchema,
} from "../src/integration-connections/start-provider-app-setup/schema.js";
import { createFormConnection, seedIntegrationTarget } from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

type StartedProviderAppSetupResponse = z.infer<typeof StartedProviderAppSetupResponseSchema>;
type StartedProviderAppSetupRedirect = Extract<
  StartedProviderAppSetupResponse,
  { kind: "redirect" }
>;

describe.concurrent("GitHub App setup start integration connections", () => {
  it("creates a GitHub App installation authorization URL and persists redirect state", async ({
    env,
  }) => {
    await seedGitHubCloudTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-github-app-installation-start@example.com",
    });
    const connectionId = await createGitHubAppConnection(env, {
      targetKey: "github-cloud",
      cookie: session.cookie,
      displayName: "GitHub Prod",
      appId: "123",
      appSlug: "mistle-github-app",
      clientId: "Iv1.client123",
      includeClientSecret: true,
    });

    const { authorizationUrl, state } = await startGitHubAppInstallation(env, {
      cookie: session.cookie,
      connectionId,
    });

    expect(authorizationUrl.origin).toBe("https://github.com");
    expect(authorizationUrl.pathname).toBe("/apps/mistle-github-app/installations/select_target");
    await expectRedirectSession(env, {
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      state,
    });
  });

  it("starts GitHub Enterprise Server App installation through the generic setup route", async ({
    env,
  }) => {
    await seedGitHubEnterpriseServerTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-github-enterprise-app-installation-start@example.com",
    });
    const connectionId = await createGitHubAppConnection(env, {
      targetKey: "github-enterprise-server",
      cookie: session.cookie,
      displayName: "GitHub Enterprise",
      appId: "456",
      appSlug: "mistle-github-enterprise-app",
      clientId: "Iv1.enterpriseclient123",
      includeClientSecret: false,
    });

    const { authorizationUrl, state } = await startGitHubAppInstallation(env, {
      cookie: session.cookie,
      connectionId,
    });

    expect(authorizationUrl.origin).toBe("https://github.enterprise.example.com");
    expect(authorizationUrl.pathname).toBe(
      "/github-apps/mistle-github-enterprise-app/installations/select_target",
    );
    await expectRedirectSession(env, {
      organizationId: session.organizationId,
      targetKey: "github-enterprise-server",
      state,
    });
  });

  it("returns 400 when the connection does not use GitHub App installation auth", async ({
    env,
  }) => {
    await seedGitHubCloudTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-github-app-installation-unsupported-connection@example.com",
    });
    const connectionId = await createGitHubApiKeyConnection(env, {
      cookie: session.cookie,
      displayName: "GitHub API key",
    });

    const response = await env.controlPlaneApi.http.fetch(
      `/v1/integration/connections/${encodeURIComponent(
        connectionId,
      )}/setup/github-app-installation/start`,
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    const responseBody = StartProviderAppSetupBadRequestResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("GITHUB_APP_INSTALLATION_NOT_SUPPORTED");
  });

  it("returns 404 when the GitHub App installation start connection does not exist", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-github-app-installation-missing-connection@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections/icn_missing/setup/github-app-installation/start",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = StartProviderAppSetupNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("CONNECTION_NOT_FOUND");
  });
});

async function seedGitHubCloudTarget(env: IntegrationTestEnvironment): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "github-cloud",
    familyId: "github",
    variantId: "github-cloud",
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
}

async function seedGitHubEnterpriseServerTarget(env: IntegrationTestEnvironment): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "github-enterprise-server",
    familyId: "github",
    variantId: "github-enterprise-server",
    config: {
      api_base_url: "https://github.enterprise.example.com/api/v3",
      web_base_url: "https://github.enterprise.example.com",
    },
  });
}

async function createGitHubAppConnection(
  env: IntegrationTestEnvironment,
  input: {
    targetKey: string;
    cookie: string;
    displayName: string;
    appId: string;
    appSlug: string;
    clientId: string;
    includeClientSecret: boolean;
  },
): Promise<string> {
  const response = await createFormConnection({
    env,
    targetKey: input.targetKey,
    cookie: input.cookie,
    body: {
      displayName: input.displayName,
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: input.appId,
        app_slug: input.appSlug,
        client_id: input.clientId,
      },
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        ...(input.includeClientSecret ? { clientSecret: "github-client-secret" } : {}),
        webhookSecret: "github-webhook-secret",
      },
    },
  });

  expect(response.status).toBe(201);
  const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
  return createdConnection.id;
}

async function createGitHubApiKeyConnection(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    displayName: string;
  },
): Promise<string> {
  const response = await createFormConnection({
    env,
    targetKey: "github-cloud",
    cookie: input.cookie,
    body: {
      displayName: input.displayName,
      methodId: IntegrationConnectionMethodIds.API_KEY,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      secrets: {
        apiKey: "github-api-key",
      },
    },
  });

  expect(response.status).toBe(201);
  const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
  return createdConnection.id;
}

async function startGitHubAppInstallation(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    connectionId: string;
  },
): Promise<{ authorizationUrl: URL; state: string }> {
  const response = await env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(
      input.connectionId,
    )}/setup/github-app-installation/start`,
    {
      method: "POST",
      headers: {
        cookie: input.cookie,
      },
    },
  );

  expect(response.status).toBe(200);
  const responseBody = await parseStartedProviderAppSetupRedirect(response);
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

async function parseStartedProviderAppSetupRedirect(
  response: Response,
): Promise<StartedProviderAppSetupRedirect> {
  const responseBody = StartedProviderAppSetupResponseSchema.parse(await response.json());
  if (responseBody.kind !== "redirect") {
    throw new Error("Expected provider app setup start to return a redirect.");
  }

  return responseBody;
}

async function expectRedirectSession(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    targetKey: string;
    state: string;
  },
): Promise<void> {
  const redirectSession =
    await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.targetKey, input.targetKey),
          eq(table.state, input.state),
        ),
    });

  if (redirectSession === undefined) {
    throw new Error("Expected persisted redirect session.");
  }

  expect(Date.parse(redirectSession.expiresAt)).toBeGreaterThan(
    Date.parse(redirectSession.createdAt),
  );
  expect(redirectSession.usedAt).toBeNull();
}
