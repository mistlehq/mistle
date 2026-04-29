import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationConnectionRedirectSessions,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
} from "@mistle/db/control-plane";
import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  CompleteProviderAppSetupCallbackBadRequestResponseSchema,
  CompleteProviderAppSetupCallbackNotFoundResponseSchema,
  CompleteProviderAppSetupCallbackQuerySchema,
} from "../src/integration-callbacks/provider-app-setup/schema.js";
import { ListIntegrationConnectionsResponseSchema } from "../src/integration-connections/list-integration-connections/schema.js";
import {
  CreatedFormIntegrationConnectionSchema,
  IntegrationConnectionSchema,
} from "../src/integration-connections/schemas.js";
import {
  StartProviderAppSetupBadRequestResponseSchema,
  StartProviderAppSetupNotFoundResponseSchema,
  StartedProviderAppSetupResponseSchema,
} from "../src/integration-connections/start-provider-app-setup/schema.js";
import { buildDashboardUrl } from "../src/lib/dashboard-url.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

const GitHubCloudTargetConfig = {
  api_base_url: "https://api.github.com",
  web_base_url: "https://github.com",
} as const;

const GitHubEnterpriseServerTargetConfig = {
  api_base_url: "https://github.enterprise.example.com/api/v3",
  web_base_url: "https://github.enterprise.example.com",
} as const;

type StartedProviderAppSetupResponse = z.infer<typeof StartedProviderAppSetupResponseSchema>;
type StartedProviderAppSetupFormPost = Extract<
  StartedProviderAppSetupResponse,
  { kind: "form-post" }
>;
type StartedProviderAppSetupRedirect = Extract<
  StartedProviderAppSetupResponse,
  { kind: "redirect" }
>;

async function parseStartedProviderAppSetupFormPost(
  response: Response,
): Promise<StartedProviderAppSetupFormPost> {
  const responseBody = StartedProviderAppSetupResponseSchema.parse(await response.json());
  if (responseBody.kind !== "form-post") {
    throw new Error("Expected provider app setup start to return a form post.");
  }

  return responseBody;
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

async function ensureGithubCloudTarget(fixture: ControlPlaneApiIntegrationFixture): Promise<void> {
  await fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: "github-cloud",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: GitHubCloudTargetConfig,
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: GitHubCloudTargetConfig,
      },
    });
}

async function ensureGithubEnterpriseServerTarget(
  fixture: ControlPlaneApiIntegrationFixture,
): Promise<void> {
  await fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: "github-enterprise-server",
      familyId: "github",
      variantId: "github-enterprise-server",
      enabled: true,
      config: GitHubEnterpriseServerTargetConfig,
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "github",
        variantId: "github-enterprise-server",
        enabled: true,
        config: GitHubEnterpriseServerTargetConfig,
      },
    });
}

function createDashboardOrganizationIntegrationsUrl(
  fixture: ControlPlaneApiIntegrationFixture,
  targetKey: string,
  options?: {
    connectionNotice?: string;
    connectionId?: string;
  },
): string {
  const searchParams = new URLSearchParams();
  if (options?.connectionId !== undefined) {
    searchParams.set("connectionId", options.connectionId);
  }
  if (options?.connectionNotice !== undefined) {
    searchParams.set("connectionNotice", options.connectionNotice);
  }
  const query = searchParams.size === 0 ? "" : `?${searchParams.toString()}`;

  return buildDashboardUrl(
    fixture.config.dashboard.baseUrl,
    `/integrations/${encodeURIComponent(targetKey)}${query}`,
  );
}

describe("integration connections GitHub App integration", () => {
  function createGitHubAppInstallationCompletePath(input: {
    query: Record<string, string>;
  }): string {
    const query = CompleteProviderAppSetupCallbackQuerySchema.parse(input.query);
    const searchParams = new URLSearchParams(query);
    return `/p/integration/callbacks/setup/github-app-installation?${searchParams.toString()}`;
  }

  function createGitHubAppManifestCompletePath(input: { query: Record<string, string> }): string {
    const query = CompleteProviderAppSetupCallbackQuerySchema.parse(input.query);
    const searchParams = new URLSearchParams(query);
    return `/p/integration/callbacks/setup/github-app-manifest?${searchParams.toString()}`;
  }

  function createProviderAppSetupCompletePath(input: {
    callbackRouteKey: string;
    query: Record<string, string>;
  }): string {
    const query = CompleteProviderAppSetupCallbackQuerySchema.parse(input.query);
    const searchParams = new URLSearchParams(query);
    return `/p/integration/callbacks/setup/${encodeURIComponent(input.callbackRouteKey)}?${searchParams.toString()}`;
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

    expect(authorizationUrl.pathname).toBe("/apps/mistle-github-app/installations/select_target");
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

  it("creates a GitHub App draft connection before app credentials are provided", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-draft@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/github-cloud/github-app-installation/draft",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Draft GitHub",
        }),
      },
    );

    expect(response.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(await response.json());

    expect(createdConnection.displayName).toBe("Draft GitHub");
    expect(createdConnection.config).toEqual({
      connection_method: "github-app-installation",
    });

    const persistedWebhookSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.integrationConnectionId, createdConnection.id),
        ),
    });
    expect(persistedWebhookSource).toBeDefined();
  });

  it("starts GitHub App manifest creation with injected callback URLs and persisted state", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-manifest-start@example.com",
    });
    const connectionId = await createGitHubAppDraftConnection(fixture, {
      authenticatedSession,
      displayName: "Draft GitHub",
    });

    const response = await fixture.request(
      `/v1/integration/connections/${connectionId}/setup/github-app/start`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          manifest: {
            name: "Mistle GitHub App",
            hook_attributes: {
              active: false,
              url: "https://example.invalid/webhook",
            },
            redirect_url: "https://example.invalid/manifest",
            callback_urls: ["https://example.invalid/oauth"],
            setup_url: "https://example.invalid/setup",
            default_events: ["issues", "pull_request"],
            default_permissions: {
              issues: "read",
              pull_requests: "write",
            },
          },
          owner: {
            kind: "organization",
            organizationSlug: "mistle-labs",
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = await parseStartedProviderAppSetupFormPost(response);
    const submissionUrl = new URL(responseBody.submissionUrl);
    expect(submissionUrl.origin).toBe("https://github.com");
    expect(submissionUrl.pathname).toBe("/organizations/mistle-labs/settings/apps/new");
    const state = resolveGitHubAppManifestSubmissionState(submissionUrl);
    expect(responseBody.fields).not.toHaveProperty("state");
    const manifestField = responseBody.fields["manifest"];
    if (manifestField === undefined) {
      throw new Error("Expected GitHub App manifest setup to return a manifest field.");
    }

    const manifest = z.record(z.string(), z.unknown()).parse(JSON.parse(manifestField));

    expect(manifest["name"]).toBe("Mistle GitHub App");
    expect(manifest["redirect_url"]).toBe(
      `${fixture.config.auth.baseUrl}/p/integration/callbacks/setup/github-app-manifest`,
    );
    expect(manifest["callback_urls"]).toEqual([
      `${fixture.config.auth.baseUrl}/p/identity-linking/callbacks/github`,
    ]);
    expect(manifest["setup_url"]).toBe(
      `${fixture.config.auth.baseUrl}/p/integration/callbacks/setup/github-app-installation`,
    );
    expect(manifest["hook_attributes"]).toEqual({
      active: true,
      url: expect.stringMatching(
        new RegExp(
          `^${fixture.config.auth.baseUrl}/p/integration/webhooks/github-cloud/[A-Za-z0-9_-]+$`,
        ),
      ),
    });
    expect(manifest["default_events"]).toEqual(["issues", "pull_request"]);
    expect(manifest["default_permissions"]).toEqual({
      issues: "read",
      pull_requests: "write",
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

    const webhookSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.integrationConnectionId, connectionId),
        ),
    });
    expect(webhookSource).toBeDefined();
    if (webhookSource === undefined) {
      throw new Error("Expected GitHub App manifest webhook source.");
    }

    expect(webhookSource.providerMetadata).toEqual({
      [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
        events: ["issues", "pull_request"],
        permissions: [
          {
            permission: "issues",
            access: "read",
          },
          {
            permission: "pull_requests",
            access: "write",
          },
          {
            permission: "pull_requests",
            access: "read",
          },
        ],
      },
    });
  });

  it("returns 400 when GitHub App manifest trigger capabilities are missing", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-manifest-missing-capabilities@example.com",
    });
    const connectionId = await createGitHubAppDraftConnection(fixture, {
      authenticatedSession,
      displayName: "Draft GitHub",
    });

    const response = await fixture.request(
      `/v1/integration/connections/${connectionId}/setup/github-app/start`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          manifest: {
            name: "Mistle GitHub App",
          },
          owner: {
            kind: "personal",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = StartProviderAppSetupBadRequestResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("INVALID_GITHUB_APP_MANIFEST_START_INPUT");

    const redirectSessions = await fixture.db.query.integrationConnectionRedirectSessions.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.targetKey, "github-cloud"),
        ),
    });
    expect(redirectSessions).toEqual([]);
  });

  it("starts and completes GitHub Enterprise Server App installation through the generic provider app setup route", async ({
    fixture,
  }) => {
    await ensureGithubEnterpriseServerTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubEnterpriseServerAppConnection(
      fixture,
      {
        email: "integration-connections-github-enterprise-app-installation-generic@example.com",
        displayName: "GitHub Enterprise",
      },
    );

    const response = await fixture.request(
      `/v1/integration/connections/${connectionId}/setup/github-app-installation/start`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = await parseStartedProviderAppSetupRedirect(response);

    const authorizationUrl = new URL(responseBody.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://github.enterprise.example.com");
    expect(authorizationUrl.pathname).toBe(
      "/github-apps/mistle-github-enterprise-app/installations/select_target",
    );
    const state = authorizationUrl.searchParams.get("state");
    if (state === null || state.length === 0) {
      throw new Error("Expected redirect state in authorization URL.");
    }

    const redirectSession = await fixture.db.query.integrationConnectionRedirectSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.targetKey, "github-enterprise-server"),
          eq(table.state, state),
        ),
    });
    expect(redirectSession).toBeDefined();

    const completeResponse = await fixture.request(
      createGitHubAppInstallationCompletePath({
        query: {
          state,
          installation_id: "98765",
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
      createDashboardOrganizationIntegrationsUrl(fixture, "github-enterprise-server", {
        connectionId,
        connectionNotice: "installed",
      }),
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
      throw new Error("Expected persisted GitHub Enterprise Server connection.");
    }

    expect(persistedConnection.externalSubjectId).toBe("98765");
    expect(persistedConnection.config).toEqual({
      connection_method: "github-app-installation",
      app_id: "456",
      app_slug: "mistle-github-enterprise-app",
      client_id: "Iv1.enterpriseclient123",
      installation_id: "98765",
      setup_action: "install",
    });
  });

  it("returns 400 when GitHub App manifest start connection uses API key auth", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-manifest-api-key-start@example.com",
    });
    const connectionId = await createGitHubApiKeyConnection(fixture, {
      authenticatedSession,
      displayName: "GitHub API key",
    });

    const response = await fixture.request(
      `/v1/integration/connections/${connectionId}/setup/github-app/start`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          manifest: {
            name: "Mistle GitHub App",
            default_events: ["issues"],
            default_permissions: {
              issues: "read",
            },
          },
          owner: {
            kind: "personal",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = StartProviderAppSetupBadRequestResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("GITHUB_APP_INSTALLATION_NOT_SUPPORTED");
  });

  it("returns the provider app setup completion code when the GitHub App manifest callback code is missing", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-manifest-complete-missing-code@example.com",
    });
    const connectionId = await createGitHubAppDraftConnection(fixture, {
      authenticatedSession,
      displayName: "Draft GitHub",
    });
    const startResponse = await fixture.request(
      `/v1/integration/connections/${connectionId}/setup/github-app/start`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          manifest: {
            name: "Mistle GitHub App",
            default_events: ["issues"],
            default_permissions: {
              issues: "read",
            },
          },
          owner: {
            kind: "personal",
          },
        }),
      },
    );
    expect(startResponse.status).toBe(200);
    const startResponseBody = await parseStartedProviderAppSetupFormPost(startResponse);
    const state = resolveGitHubAppManifestSubmissionState(new URL(startResponseBody.submissionUrl));

    const response = await fixture.request(
      createGitHubAppManifestCompletePath({
        query: {
          state,
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT");
    expect(responseBody.message).toContain("must include `code`");
  });

  it("returns 400 when GitHub App manifest completion connection no longer uses GitHub App installation auth", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-manifest-api-key-complete@example.com",
    });
    const connectionId = await createGitHubAppDraftConnection(fixture, {
      authenticatedSession,
      displayName: "Draft GitHub",
    });
    const startResponse = await fixture.request(
      `/v1/integration/connections/${connectionId}/setup/github-app/start`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          manifest: {
            name: "Mistle GitHub App",
            default_events: ["issues"],
            default_permissions: {
              issues: "read",
            },
          },
          owner: {
            kind: "personal",
          },
        }),
      },
    );
    expect(startResponse.status).toBe(200);
    const startResponseBody = await parseStartedProviderAppSetupFormPost(startResponse);
    const state = resolveGitHubAppManifestSubmissionState(new URL(startResponseBody.submissionUrl));

    await fixture.db
      .update(integrationConnections)
      .set({
        config: {
          connection_method: "api-key",
        },
      })
      .where(eq(integrationConnections.id, connectionId));

    const response = await fixture.request(
      createGitHubAppManifestCompletePath({
        query: {
          state,
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("GITHUB_APP_INSTALLATION_NOT_SUPPORTED");

    const persistedConnection = await fixture.db.query.integrationConnections.findFirst({
      where: (table, { eq: equals }) => equals(table.id, connectionId),
    });
    expect(persistedConnection?.config).toEqual({
      connection_method: "api-key",
    });
  });

  it("fails to start installation when a draft connection is still missing required GitHub App credentials", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-missing-credentials@example.com",
    });
    const connectionId = await createGitHubAppDraftConnection(fixture, {
      authenticatedSession,
      displayName: "Draft GitHub",
    });

    const updateResponse = await fixture.request(
      `/v1/integration/connections/${connectionId}/form`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Draft GitHub",
          config: {
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle-github-app",
            client_id: "Iv1.prefilledclientid",
          },
        }),
      },
    );
    expect(updateResponse.status).toBe(200);

    const startResponse = await fixture.request(
      `/v1/integration/connections/${connectionId}/setup/github-app-installation/start`,
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(startResponse.status).toBe(400);
    const responseBody = StartProviderAppSetupBadRequestResponseSchema.parse(
      await startResponse.json(),
    );
    expect(responseBody.code).toBe("INVALID_GITHUB_APP_INSTALLATION_START_INPUT");
    expect(responseBody.message).toContain("missing required setup credentials");
  });

  it("returns configured secret names for GitHub App connections in the list response", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubAppConnection(fixture, {
      email: "integration-connections-github-app-installation-configured-secrets@example.com",
      displayName: "GitHub Prod",
    });

    const response = await fixture.request("/v1/integration/connections?limit=20", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = ListIntegrationConnectionsResponseSchema.parse(await response.json());
    const listedConnection = payload.items.find((item) => item.id === connectionId);

    expect(listedConnection?.configuredSecretNames).toEqual([
      "appPrivateKeyPem",
      "clientSecret",
      "webhookSecret",
    ]);
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
      createDashboardOrganizationIntegrationsUrl(fixture, "github-cloud", {
        connectionId,
        connectionNotice: "installed",
      }),
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
      client_id: "Iv1.client123",
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
    expect(linkedCredentials).toHaveLength(3);

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

  it("completes GitHub App installation when the manifest setup URL returns with manifest flow state", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubAppConnection(fixture, {
      email: "integration-connections-github-app-manifest-setup-url-complete@example.com",
      displayName: "GitHub Prod",
    });

    const startResponse = await fixture.request(
      `/v1/integration/connections/${connectionId}/setup/github-app/start`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          manifest: {
            name: "Mistle GitHub App",
            default_events: ["issues"],
            default_permissions: {
              issues: "read",
            },
          },
          owner: {
            kind: "personal",
          },
        }),
      },
    );
    expect(startResponse.status).toBe(200);
    const startResponseBody = await parseStartedProviderAppSetupFormPost(startResponse);
    const state = resolveGitHubAppManifestSubmissionState(new URL(startResponseBody.submissionUrl));

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
      createDashboardOrganizationIntegrationsUrl(fixture, "github-cloud", {
        connectionId,
        connectionNotice: "installed",
      }),
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

    expect(persistedConnection.externalSubjectId).toBe("12345");
    expect(persistedConnection.config).toEqual({
      connection_method: "github-app-installation",
      app_id: "123",
      app_slug: "mistle-github-app",
      client_id: "Iv1.client123",
      installation_id: "12345",
      setup_action: "install",
    });
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
    const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT");
  });

  it("returns the provider app setup completion code when GitHub App installation_id is missing", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubAppConnection(fixture, {
      email:
        "integration-connections-github-app-installation-complete-missing-installation-id@example.com",
      displayName: "GitHub Prod",
    });
    const { state } = await startGitHubAppInstallationConnection(fixture, {
      authenticatedSession,
      connectionId,
    });

    const response = await fixture.request(
      createGitHubAppInstallationCompletePath({
        query: {
          state,
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT");
    expect(responseBody.message).toContain("must include `installation_id`");
  });

  it("returns 400 when the provider app callback route key does not match the started setup flow", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubAppConnection(fixture, {
      email:
        "integration-connections-github-app-installation-mismatched-callback-route@example.com",
      displayName: "GitHub Prod",
    });
    const { state } = await startGitHubAppInstallationConnection(fixture, {
      authenticatedSession,
      connectionId,
    });

    const response = await fixture.request(
      createProviderAppSetupCompletePath({
        callbackRouteKey: "github-app-manifest",
        query: {
          state,
          installation_id: "12345",
        },
      }),
      {
        method: "GET",
      },
    );

    expect(response.status).toBe(400);
    const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_PROVIDER_APP_SETUP_COMPLETE_INPUT");
    expect(responseBody.message).toContain("does not match setup flow 'github-app-installation'");

    const redirectSession = await fixture.db.query.integrationConnectionRedirectSessions.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.targetKey, "github-cloud"),
          eq(table.state, state),
        ),
    });
    expect(redirectSession?.usedAt).toBeNull();
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
    const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
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
    const responseBody = CompleteProviderAppSetupCallbackNotFoundResponseSchema.parse(
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
    const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
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
    const responseBody = CompleteProviderAppSetupCallbackBadRequestResponseSchema.parse(
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
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );

    const response = await fixture.request(
      `/v1/integration/connections/${createdConnection.id}/setup/github-app-installation/start`,
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    const responseBody = StartProviderAppSetupBadRequestResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("GITHUB_APP_INSTALLATION_NOT_SUPPORTED");
  });

  it("rejects GitHub App auth edits while the connection is configured for active identity linking", async ({
    fixture,
  }) => {
    await ensureGithubCloudTarget(fixture);

    const { authenticatedSession, connectionId } = await createGitHubAppConnection(fixture, {
      email: "integration-connections-github-app-installation-identity-linking@example.com",
      displayName: "GitHub Prod",
    });

    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      organizationId: authenticatedSession.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: connectionId,
      createdByUserId: authenticatedSession.userId,
      updatedByUserId: authenticatedSession.userId,
    });

    const response = await fixture.request(
      `/v1/integration/connections/${encodeURIComponent(connectionId)}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "GitHub Prod",
          config: {
            app_id: "123",
            app_slug: "mistle-github-app",
          },
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CONNECTION_USED_BY_IDENTITY_LINKING",
    });
  });

  it("returns 404 when the GitHub App install start connection does not exist", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-connections-github-app-installation-missing-connection@example.com",
    });

    const response = await fixture.request(
      "/v1/integration/connections/icn_missing/setup/github-app-installation/start",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = StartProviderAppSetupNotFoundResponseSchema.parse(await response.json());
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
        client_id: "Iv1.client123",
      },
      secrets: {
        appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
        clientSecret: "github-client-secret",
        webhookSecret: "github-webhook-secret",
      },
    }),
  });

  expect(response.status).toBe(201);
  const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());

  return {
    authenticatedSession,
    connectionId: createdConnection.id,
  };
}

async function createGitHubEnterpriseServerAppConnection(
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

  const response = await fixture.request(
    "/v1/integration/connections/github-enterprise-server/form",
    {
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
          app_id: "456",
          app_slug: "mistle-github-enterprise-app",
          client_id: "Iv1.enterpriseclient123",
        },
        secrets: {
          appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nenterprise\n-----END PRIVATE KEY-----",
          webhookSecret: "github-enterprise-webhook-secret",
        },
      }),
    },
  );

  expect(response.status).toBe(201);
  const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());

  return {
    authenticatedSession,
    connectionId: createdConnection.id,
  };
}

async function createGitHubAppDraftConnection(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    authenticatedSession: Awaited<ReturnType<ControlPlaneApiIntegrationFixture["authSession"]>>;
    displayName: string;
  },
): Promise<string> {
  const response = await fixture.request(
    "/v1/integration/connections/github-cloud/github-app-installation/draft",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: input.displayName,
      }),
    },
  );

  expect(response.status).toBe(201);
  const createdConnection = IntegrationConnectionSchema.parse(await response.json());
  return createdConnection.id;
}

async function createGitHubApiKeyConnection(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    authenticatedSession: Awaited<ReturnType<ControlPlaneApiIntegrationFixture["authSession"]>>;
    displayName: string;
  },
): Promise<string> {
  const response = await fixture.request("/v1/integration/connections/github-cloud/form", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: input.authenticatedSession.cookie,
    },
    body: JSON.stringify({
      displayName: input.displayName,
      methodId: "api-key",
      config: {
        connection_method: "api-key",
      },
      secrets: {
        apiKey: "github-api-key",
      },
    }),
  });

  expect(response.status).toBe(201);
  const createdConnection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
  return createdConnection.id;
}

async function startGitHubAppInstallationConnection(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    authenticatedSession: Awaited<ReturnType<ControlPlaneApiIntegrationFixture["authSession"]>>;
    connectionId: string;
  },
): Promise<{ authorizationUrl: URL; state: string }> {
  const response = await fixture.request(
    `/v1/integration/connections/${input.connectionId}/setup/github-app-installation/start`,
    {
      method: "POST",
      headers: {
        cookie: input.authenticatedSession.cookie,
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

function resolveGitHubAppManifestSubmissionState(submissionUrl: URL): string {
  const state = submissionUrl.searchParams.get("state");
  if (state === null || state.length === 0) {
    throw new Error("GitHub App manifest submission URL must include state.");
  }

  return state;
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
