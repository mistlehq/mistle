/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  OrganizationIdentityLinkProviderConfigStatus,
  SandboxProfileVersionAgentRuntimeIds,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  E2BSandboxRuntimeFamilyId,
  E2BSandboxRuntimeVariantId,
} from "@mistle/integrations-definitions";
import { SandboxProvider } from "@mistle/sandbox";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  PutSandboxProfileVersionDraftBadRequestResponseSchema,
  PutSandboxProfileVersionDraftConflictResponseSchema,
  PutSandboxProfileVersionDraftResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { createApiKeyCredential, createApiKeyToken } from "./helpers/api-keys.js";
import {
  seedIdentityConnection,
  seedIdentityProviderConfig,
  upsertGitHubIdentityTarget,
} from "./helpers/identity-linking.js";
import {
  integrationConnectionRow,
  integrationTargetRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const itManagedE2BDeployment = createIntegrationTest({
  services: ["control-plane-api"],
  __serviceOptions: {
    sandbox: {
      provider: "e2b",
      e2b: {
        apiKey: "integration-managed-e2b-api-key",
      },
    },
  },
});

const EmptySandboxRuntimeConfig = {
  gitCommitSigningIntegrationConnectionId: null,
  mistleMcpEnabled: false,
  mistleMcpApiKeyId: null,
  sandboxConnectionId: null,
  sandboxProvider: SandboxProvider.DOCKER,
  sandboxResources: null,
};

describe.concurrent("sandbox profile version draft put integration", () => {
  it("updates setup script, persistence mode, and integration bindings atomically", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-default-draft-put",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_draft_put_001",
        organizationId: session.organizationId,
        targetKey: "openai-default-draft-put",
        displayName: "Draft Put Connection A",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "api-key",
        },
      }),
      integrationConnectionRow({
        id: "icn_draft_put_002",
        organizationId: session.organizationId,
        targetKey: "openai-default-draft-put",
        displayName: "Draft Put Connection B",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "api-key",
        },
      }),
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_001",
        organizationId: session.organizationId,
        displayName: "Draft Put Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "pnpm install",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_put_existing_001",
          sandboxProfileId: "sbp_draft_put_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_draft_put_001",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "pnpm install\npnpm dev:bootstrap",
          agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
          integrationBindings: {
            bindings: [
              {
                id: "ibd_draft_put_existing_001",
                connectionId: "icn_draft_put_002",
                kind: IntegrationBindingKinds.AGENT,
                config: {},
              },
            ],
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionDraftResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      sandboxProfileId: "sbp_draft_put_001",
      version: 1,
      setupScript: "pnpm install\npnpm dev:bootstrap",
      agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
      ...EmptySandboxRuntimeConfig,
      integrationBindings: {
        bindings: [
          {
            id: "ibd_draft_put_existing_001",
            sandboxProfileId: "sbp_draft_put_001",
            sandboxProfileVersion: 1,
            connectionId: "icn_draft_put_002",
            kind: IntegrationBindingKinds.AGENT,
            config: {},
            createdAt: responseBody.integrationBindings.bindings[0]?.createdAt,
            updatedAt: responseBody.integrationBindings.bindings[0]?.updatedAt,
          },
        ],
      },
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
        agentRuntimeId: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_draft_put_001"), eq(table.version, 1)),
    });
    expect(persistedVersion).toEqual({
      setupScript: "pnpm install\npnpm dev:bootstrap",
      agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
    });
  });

  it("rejects unsupported sandbox runtime provider updates", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-invalid-provider@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_invalid_provider_001",
        organizationId: session.organizationId,
        displayName: "Draft Put Invalid Provider Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_invalid_provider_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_invalid_provider_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sandboxProvider: "unknown-provider",
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionDraftBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_SANDBOX_RUNTIME_CONFIG");
    expect(responseBody.message).toBe("Sandbox provider 'unknown-provider' is not supported.");
  });

  it("updates the GitHub commit signing connection selector", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-git-signing-selector@example.com",
    });

    await upsertGitHubIdentityTarget(env, {
      targetKey: "github-draft-put-signing-selector",
    });
    await seedIdentityConnection(env, {
      connectionId: "icn_draft_put_git_signing_selector",
      displayName: "GitHub Signing Selector",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      organizationId: session.organizationId,
      targetKey: "github-draft-put-signing-selector",
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_draft_put_git_signing_selector",
      connectionId: "icn_draft_put_git_signing_selector",
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      targetKey: "github-draft-put-signing-selector",
      userId: session.userId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_git_signing_selector",
        organizationId: session.organizationId,
        displayName: "Draft Put Git Signing Selector Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_git_signing_selector",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_git_signing_selector/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          gitCommitSigningIntegrationConnectionId: "icn_draft_put_git_signing_selector",
          integrationBindings: {
            bindings: [
              {
                connectionId: "icn_draft_put_git_signing_selector",
                kind: IntegrationBindingKinds.GIT,
                config: {
                  repositories: [],
                },
              },
            ],
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionDraftResponseSchema.parse(await response.json());
    expect(responseBody.gitCommitSigningIntegrationConnectionId).toBe(
      "icn_draft_put_git_signing_selector",
    );

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        gitCommitSigningIntegrationConnectionId: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_draft_put_git_signing_selector"), eq(table.version, 1)),
    });
    expect(persistedVersion).toEqual({
      gitCommitSigningIntegrationConnectionId: "icn_draft_put_git_signing_selector",
    });
  });

  it("rejects commit signing without a matching Git binding", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-git-signing-without-binding@example.com",
    });

    await upsertGitHubIdentityTarget(env, {
      targetKey: "github-draft-put-signing-without-binding",
    });
    await seedIdentityConnection(env, {
      connectionId: "icn_draft_put_git_signing_without_binding",
      displayName: "GitHub Signing Without Binding",
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      organizationId: session.organizationId,
      targetKey: "github-draft-put-signing-without-binding",
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_draft_put_git_signing_without_binding",
      connectionId: "icn_draft_put_git_signing_without_binding",
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      targetKey: "github-draft-put-signing-without-binding",
      userId: session.userId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_git_signing_without_binding",
        organizationId: session.organizationId,
        displayName: "Draft Put Git Signing Without Binding Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_git_signing_without_binding",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_git_signing_without_binding/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          gitCommitSigningIntegrationConnectionId: "icn_draft_put_git_signing_without_binding",
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionDraftBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      code: "INVALID_GIT_SIGNING_CONFIG",
      message: "Commit signing requires a GitHub Git connection binding on the sandbox profile.",
    });
  });

  it("rejects commit signing when the Git binding uses a different connection", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-git-signing-mismatch@example.com",
    });

    await upsertGitHubIdentityTarget(env, {
      targetKey: "github-draft-put-signing-mismatch",
    });
    await seedIdentityConnection(env, {
      connectionId: "icn_draft_put_git_signing_mismatch_a",
      displayName: "GitHub Signing Mismatch A",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      organizationId: session.organizationId,
      targetKey: "github-draft-put-signing-mismatch",
    });
    await seedIdentityConnection(env, {
      connectionId: "icn_draft_put_git_signing_mismatch_b",
      displayName: "GitHub Signing Mismatch B",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      organizationId: session.organizationId,
      targetKey: "github-draft-put-signing-mismatch",
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_draft_put_git_signing_mismatch_a",
      connectionId: "icn_draft_put_git_signing_mismatch_a",
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      targetKey: "github-draft-put-signing-mismatch",
      userId: session.userId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_git_signing_mismatch",
        organizationId: session.organizationId,
        displayName: "Draft Put Git Signing Mismatch Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_git_signing_mismatch",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_git_signing_mismatch/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          gitCommitSigningIntegrationConnectionId: "icn_draft_put_git_signing_mismatch_a",
          integrationBindings: {
            bindings: [
              {
                connectionId: "icn_draft_put_git_signing_mismatch_b",
                kind: IntegrationBindingKinds.GIT,
                config: {
                  repositories: [],
                },
              },
            ],
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionDraftBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      code: "INVALID_GIT_SIGNING_CONFIG",
      message:
        "Commit signing must use the same GitHub connection as the sandbox profile Git binding.",
    });
  });

  it("keeps commit signing disabled when a draft does not select a signing connection", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-git-signing-ambiguous@example.com",
    });

    await upsertGitHubIdentityTarget(env, {
      targetKey: "github-draft-put-signing-ambiguous",
    });
    await seedIdentityConnection(env, {
      connectionId: "icn_draft_put_git_signing_ambiguous_a",
      displayName: "GitHub Signing Ambiguous A",
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      organizationId: session.organizationId,
      targetKey: "github-draft-put-signing-ambiguous",
    });
    await seedIdentityConnection(env, {
      connectionId: "icn_draft_put_git_signing_ambiguous_b",
      displayName: "GitHub Signing Ambiguous B",
      methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      organizationId: session.organizationId,
      targetKey: "github-draft-put-signing-ambiguous",
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_draft_put_git_signing_ambiguous_a",
      connectionId: "icn_draft_put_git_signing_ambiguous_a",
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      targetKey: "github-draft-put-signing-ambiguous",
      userId: session.userId,
    });
    await seedIdentityProviderConfig(env, {
      configId: "ilp_draft_put_git_signing_ambiguous_b",
      connectionId: "icn_draft_put_git_signing_ambiguous_b",
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      targetKey: "github-draft-put-signing-ambiguous",
      userId: session.userId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_git_signing_ambiguous",
        organizationId: session.organizationId,
        displayName: "Draft Put Git Signing Ambiguous Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_git_signing_ambiguous",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_git_signing_ambiguous/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "echo ambiguous",
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionDraftResponseSchema.parse(await response.json());
    expect(responseBody.gitCommitSigningIntegrationConnectionId).toBeNull();
  });

  it("updates a draft with an API key that has update permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-api-key@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile draft updater",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_UPDATE],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_api_key_001",
        organizationId: session.organizationId,
        displayName: "API Key Draft Put Profile",
        createdAt: "2026-05-09T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_api_key_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "pnpm install",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_api_key_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "pnpm install\npnpm test",
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionDraftResponseSchema.parse(await response.json());
    expect(responseBody).toMatchObject({
      sandboxProfileId: "sbp_draft_put_api_key_001",
      version: 1,
      setupScript: "pnpm install\npnpm test",
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_draft_put_api_key_001"), eq(table.version, 1)),
    });
    expect(persistedVersion).toEqual({
      setupScript: "pnpm install\npnpm test",
    });
  });

  it("updates Mistle MCP access settings with an active organization API key", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-mistle-mcp@example.com",
    });
    const mcpCredential = await createApiKeyCredential({
      env,
      cookie: session.cookie,
      name: "Mistle MCP profile key",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_mistle_mcp_001",
        organizationId: session.organizationId,
        displayName: "Mistle MCP Draft Put Profile",
        createdAt: "2026-05-09T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_mistle_mcp_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_mistle_mcp_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mistleMcpEnabled: true,
          mistleMcpApiKeyId: mcpCredential.apiKey.id,
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionDraftResponseSchema.parse(await response.json());
    expect(responseBody.mistleMcpEnabled).toBe(true);
    expect(responseBody.mistleMcpApiKeyId).toBe(mcpCredential.apiKey.id);

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        mistleMcpEnabled: true,
        mistleMcpApiKeyId: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_draft_put_mistle_mcp_001"), eq(table.version, 1)),
    });
    expect(persistedVersion).toEqual({
      mistleMcpEnabled: true,
      mistleMcpApiKeyId: mcpCredential.apiKey.id,
    });
  });

  it("rejects enabling Mistle MCP without an API key", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-mistle-mcp-missing-key@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_mistle_mcp_missing_key_001",
        organizationId: session.organizationId,
        displayName: "Mistle MCP Missing Key Draft Put Profile",
        createdAt: "2026-05-09T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_mistle_mcp_missing_key_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_mistle_mcp_missing_key_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mistleMcpEnabled: true,
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionDraftBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      code: "INVALID_MISTLE_MCP_CONFIG",
      message: "Select an API key before allowing the agent to interact with Mistle resources.",
    });
  });

  it("returns 403 when an API key does not have update permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-api-key-forbidden@example.com",
    });
    const apiKeyToken = await createApiKeyToken({
      env,
      cookie: session.cookie,
      name: "Profile draft reader",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_api_key_forbidden/versions/1/draft",
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "should not update",
        }),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("accepts an organization-owned E2B sandbox runtime connection with valid resources", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-e2b@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "e2b-default-draft-put",
        familyId: E2BSandboxRuntimeFamilyId,
        variantId: E2BSandboxRuntimeVariantId,
        enabled: true,
        config: {},
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_draft_put_e2b_001",
        organizationId: session.organizationId,
        targetKey: "e2b-default-draft-put",
        displayName: "Draft Put E2B Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {},
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_e2b_001",
        organizationId: session.organizationId,
        displayName: "Draft Put E2B Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_e2b_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_e2b_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sandboxProvider: SandboxProvider.E2B,
          sandboxConnectionId: "icn_draft_put_e2b_001",
          sandboxResources: {
            vcpuCount: 2,
            memoryMb: 4096,
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionDraftResponseSchema.parse(await response.json());
    expect(responseBody.sandboxProvider).toBe(SandboxProvider.E2B);
    expect(responseBody.sandboxConnectionId).toBe("icn_draft_put_e2b_001");
    expect(responseBody.sandboxResources).toEqual({
      vcpuCount: 2,
      memoryMb: 4096,
    });
  });

  itManagedE2BDeployment(
    "updates integration bindings on a managed E2B profile version",
    async ({ env }) => {
      const session = await env.auth.createSession({
        email: "integration-sandbox-profile-draft-put-managed-e2b@example.com",
      });

      await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
        integrationTargetRow({
          targetKey: "openai-default-draft-put-managed-e2b",
          variantId: "openai-default",
          enabled: true,
        }),
      );
      await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
        integrationConnectionRow({
          id: "icn_draft_put_managed_e2b_agent_001",
          organizationId: session.organizationId,
          targetKey: "openai-default-draft-put-managed-e2b",
          displayName: "Draft Put Managed E2B Agent Connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          config: {
            connection_method: "api-key",
          },
        }),
      );
      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
        sandboxProfileRow({
          id: "sbp_draft_put_managed_e2b_001",
          organizationId: session.organizationId,
          displayName: "Draft Put Managed E2B Profile",
          createdAt: "2026-05-08T00:00:00.000Z",
        }),
      );
      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
        sandboxProfileVersionRow({
          sandboxProfileId: "sbp_draft_put_managed_e2b_001",
          version: 1,
          state: SandboxProfileVersionStates.DRAFT,
          sandboxProvider: SandboxProvider.E2B,
          sandboxConnectionId: null,
          sandboxVcpuCount: 2,
          sandboxMemoryMb: 4096,
        }),
      );

      const response = await env.controlPlaneApi.http.fetch(
        "/v1/sandbox/profiles/sbp_draft_put_managed_e2b_001/versions/1/draft",
        {
          method: "PUT",
          headers: {
            cookie: session.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            integrationBindings: {
              bindings: [
                {
                  connectionId: "icn_draft_put_managed_e2b_agent_001",
                  kind: IntegrationBindingKinds.AGENT,
                  config: {},
                },
              ],
            },
          }),
        },
      );

      if (response.status !== 200) {
        throw new Error(
          `Expected status 200, got ${String(response.status)}: ${await response.text()}`,
        );
      }
      const responseBody = PutSandboxProfileVersionDraftResponseSchema.parse(await response.json());
      expect(responseBody.sandboxProvider).toBe(SandboxProvider.E2B);
      expect(responseBody.sandboxConnectionId).toBeNull();
      expect(responseBody.sandboxResources).toEqual({
        vcpuCount: 2,
        memoryMb: 4096,
      });
      expect(responseBody.integrationBindings.bindings).toHaveLength(1);
      expect(responseBody.integrationBindings.bindings[0]).toMatchObject({
        sandboxProfileId: "sbp_draft_put_managed_e2b_001",
        sandboxProfileVersion: 1,
        connectionId: "icn_draft_put_managed_e2b_agent_001",
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      });
    },
  );

  it("clears sandbox runtime resources when switching to Docker", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-docker-resource-clear@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "e2b-default-draft-put-resource-clear",
        familyId: E2BSandboxRuntimeFamilyId,
        variantId: E2BSandboxRuntimeVariantId,
        enabled: true,
        config: {},
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_draft_put_resource_clear_001",
        organizationId: session.organizationId,
        targetKey: "e2b-default-draft-put-resource-clear",
        displayName: "Draft Put Resource Clear E2B Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {},
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_resource_clear_001",
        organizationId: session.organizationId,
        displayName: "Draft Put Resource Clear Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_resource_clear_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.E2B,
        sandboxConnectionId: "icn_draft_put_resource_clear_001",
        sandboxVcpuCount: 2,
        sandboxMemoryMb: 4096,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_resource_clear_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sandboxProvider: SandboxProvider.DOCKER,
          sandboxConnectionId: null,
          sandboxResources: null,
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionDraftResponseSchema.parse(await response.json());
    expect(responseBody.sandboxProvider).toBe(SandboxProvider.DOCKER);
    expect(responseBody.sandboxConnectionId).toBeNull();
    expect(responseBody.sandboxResources).toBeNull();

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        sandboxConnectionId: true,
        sandboxProvider: true,
        sandboxVcpuCount: true,
        sandboxMemoryMb: true,
        sandboxStorageMb: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_draft_put_resource_clear_001"), eq(table.version, 1)),
    });
    expect(persistedVersion).toEqual({
      sandboxProvider: SandboxProvider.DOCKER,
      sandboxConnectionId: null,
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxStorageMb: null,
    });
  });

  it("rejects unsupported E2B storage resource updates", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-e2b-storage@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "e2b-default-draft-put-storage",
        familyId: E2BSandboxRuntimeFamilyId,
        variantId: E2BSandboxRuntimeVariantId,
        enabled: true,
        config: {},
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_draft_put_e2b_storage_001",
        organizationId: session.organizationId,
        targetKey: "e2b-default-draft-put-storage",
        displayName: "Draft Put E2B Storage Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {},
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_e2b_storage_001",
        organizationId: session.organizationId,
        displayName: "Draft Put E2B Storage Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_e2b_storage_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_e2b_storage_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sandboxProvider: SandboxProvider.E2B,
          sandboxConnectionId: "icn_draft_put_e2b_storage_001",
          sandboxResources: {
            vcpuCount: 2,
            memoryMb: 4096,
            storageMb: 1024,
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionDraftBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      code: "INVALID_SANDBOX_RUNTIME_CONFIG",
      message: "Sandbox provider 'e2b' does not support configurable storage.",
    });
  });

  it("does not persist any draft section when one supplied section is invalid", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-atomicity@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_atomicity_001",
        organizationId: session.organizationId,
        displayName: "Draft Put Atomicity Profile",
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_atomicity_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "pnpm install",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_atomicity_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "pnpm install\npnpm dev:bootstrap",
          integrationBindings: {
            bindings: [
              {
                connectionId: "icn_draft_put_missing",
                kind: IntegrationBindingKinds.AGENT,
                config: {},
              },
            ],
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionDraftBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("INVALID_BINDING_CONNECTION_REFERENCE");

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_draft_put_atomicity_001"), eq(table.version, 1)),
    });
    expect(persistedVersion).toEqual({
      setupScript: "pnpm install",
    });

    const persistedBindings =
      await env.controlPlaneDb.query.sandboxProfileVersionIntegrationBindings.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, "sbp_draft_put_atomicity_001"),
            eq(table.sandboxProfileVersion, 1),
          ),
      });
    expect(persistedBindings).toEqual([]);
  });

  it("returns 409 without changing a published version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-sandbox-profile-draft-put-published@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_draft_put_published_001",
        organizationId: session.organizationId,
        displayName: "Draft Put Published Profile",
        activeVersion: 1,
        createdAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_put_published_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        setupScript: "pnpm install",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_put_published_001/versions/1/draft",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          setupScript: "pnpm install\npnpm dev:bootstrap",
        }),
      },
    );

    expect(response.status).toBe(409);
    const responseBody = PutSandboxProfileVersionDraftConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_DRAFT");

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_draft_put_published_001"), eq(table.version, 1)),
    });
    expect(persistedVersion?.setupScript).toBe("pnpm install");
  });
});
