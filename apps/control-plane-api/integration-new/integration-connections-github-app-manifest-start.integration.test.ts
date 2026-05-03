/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
} from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CreateDraftFormConnectionBodySchema } from "../src/integration-connections/create-draft-form-connection/schema.js";
import {
  CreatedFormIntegrationConnectionSchema,
  IntegrationConnectionSchema,
} from "../src/integration-connections/schemas.js";
import {
  StartedProviderAppSetupResponseSchema,
  StartProviderAppSetupBadRequestResponseSchema,
} from "../src/integration-connections/start-provider-app-setup/schema.js";
import { createFormConnection, seedIntegrationTarget } from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

type StartedProviderAppSetupResponse = z.infer<typeof StartedProviderAppSetupResponseSchema>;
type StartedProviderAppSetupFormPost = Extract<
  StartedProviderAppSetupResponse,
  { kind: "form-post" }
>;

describe.concurrent("GitHub App manifest setup start integration connections", () => {
  it("injects callback URLs and persists webhook trigger capabilities", async ({ env }) => {
    await seedGitHubCloudTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-github-app-manifest-start@example.com",
    });
    const connectionId = await createGitHubAppDraftConnection(env, {
      cookie: session.cookie,
      displayName: "Draft GitHub",
    });

    const response = await startGitHubAppManifestSetup(env, {
      cookie: session.cookie,
      connectionId,
      body: {
        manifest: manifestWithTriggerCapabilities(),
        ownerKind: "organization",
        organizationSlug: "mistle-labs",
      },
    });

    expect(response.status).toBe(200);
    const responseBody = await parseStartedProviderAppSetupFormPost(response);
    const submissionUrl = new URL(responseBody.submissionUrl);
    expect(submissionUrl.origin).toBe("https://github.com");
    expect(submissionUrl.pathname).toBe("/organizations/mistle-labs/settings/apps/new");
    await expectRedirectSession(env, {
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      state: resolveGitHubAppManifestSubmissionState(submissionUrl),
    });

    expect(responseBody.fields).not.toHaveProperty("state");
    expect(rewrittenManifest(responseBody)).toMatchObject({
      name: "Mistle GitHub App",
      redirect_url: expect.stringMatching(
        /^http:\/\/127\.0\.0\.1:\d+\/p\/integration\/callbacks\/setup\/github-app-manifest$/u,
      ),
      callback_urls: [
        expect.stringMatching(
          /^http:\/\/127\.0\.0\.1:\d+\/p\/identity-linking\/callbacks\/github$/u,
        ),
      ],
      setup_url: expect.stringMatching(
        /^http:\/\/127\.0\.0\.1:\d+\/p\/integration\/callbacks\/setup\/github-app-installation$/u,
      ),
      hook_attributes: {
        active: true,
        url: expect.stringMatching(
          /^http:\/\/127\.0\.0\.1:\d+\/p\/integration\/webhooks\/github-cloud\/[A-Za-z0-9_-]+$/u,
        ),
      },
      default_events: ["issues", "pull_request"],
      default_permissions: {
        issues: "read",
        pull_requests: "write",
      },
    });

    const webhookSource = await env.controlPlaneDb.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.integrationConnectionId, connectionId),
        ),
    });
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

  it("returns 400 without creating redirect state when trigger capabilities are missing", async ({
    env,
  }) => {
    await seedGitHubCloudTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-github-app-manifest-missing-capabilities@example.com",
    });
    const connectionId = await createGitHubAppDraftConnection(env, {
      cookie: session.cookie,
      displayName: "Draft GitHub",
    });

    const response = await startGitHubAppManifestSetup(env, {
      cookie: session.cookie,
      connectionId,
      body: {
        manifest: {
          name: "Mistle GitHub App",
        },
        ownerKind: "personal",
      },
    });

    expect(response.status).toBe(400);
    const responseBody = StartProviderAppSetupBadRequestResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("INVALID_GITHUB_APP_MANIFEST_START_INPUT");

    const redirectSessions =
      await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.targetKey, "github-cloud"),
          ),
      });
    expect(redirectSessions).toEqual([]);
  });

  it("returns 400 when manifest setup is requested for an API-key connection", async ({ env }) => {
    await seedGitHubCloudTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-github-app-manifest-api-key-start@example.com",
    });
    const connectionId = await createGitHubApiKeyConnection(env, {
      cookie: session.cookie,
      displayName: "GitHub API key",
    });

    const response = await startGitHubAppManifestSetup(env, {
      cookie: session.cookie,
      connectionId,
      body: {
        manifest: manifestWithTriggerCapabilities(),
        ownerKind: "personal",
      },
    });

    expect(response.status).toBe(400);
    const responseBody = StartProviderAppSetupBadRequestResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("GITHUB_APP_INSTALLATION_NOT_SUPPORTED");
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

async function createGitHubAppDraftConnection(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    displayName: string;
  },
): Promise<string> {
  const response = await env.controlPlaneApi.http.fetch(
    "/v1/integration/connections/github-cloud/github-app-installation/draft",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify(
        CreateDraftFormConnectionBodySchema.parse({
          displayName: input.displayName,
        }),
      ),
    },
  );

  expect(response.status).toBe(201);
  const createdConnection = IntegrationConnectionSchema.parse(await response.json());
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

async function startGitHubAppManifestSetup(
  env: IntegrationTestEnvironment,
  input: {
    cookie: string;
    connectionId: string;
    body: unknown;
  },
): Promise<Response> {
  return env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/setup/github-app/start`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify(input.body),
    },
  );
}

function manifestWithTriggerCapabilities(): Record<string, unknown> {
  return {
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
  };
}

async function parseStartedProviderAppSetupFormPost(
  response: Response,
): Promise<StartedProviderAppSetupFormPost> {
  const responseBody = StartedProviderAppSetupResponseSchema.parse(await response.json());
  if (responseBody.kind !== "form-post") {
    throw new Error("Expected provider app setup start to return a form post.");
  }

  return responseBody;
}

function resolveGitHubAppManifestSubmissionState(submissionUrl: URL): string {
  const state = submissionUrl.searchParams.get("state");
  if (state === null || state.length === 0) {
    throw new Error("GitHub App manifest submission URL must include state.");
  }

  return state;
}

function rewrittenManifest(response: StartedProviderAppSetupFormPost): Record<string, unknown> {
  const manifestField = response.fields["manifest"];
  if (manifestField === undefined) {
    throw new Error("Expected GitHub App manifest setup to return a manifest field.");
  }

  return z.record(z.string(), z.unknown()).parse(JSON.parse(manifestField));
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
