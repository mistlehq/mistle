/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema,
  PutSandboxProfileVersionIntegrationBindingsConflictResponseSchema,
  PutSandboxProfileVersionIntegrationBindingsResponseSchema,
  SandboxProfileVersionNotFoundResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/index.js";
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

describe.concurrent("sandbox profile version put integration bindings integration", () => {
  it("replaces integration bindings for a draft profile version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-default-put-bindings-route",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_put_bindings_route_001",
        organizationId: session.organizationId,
        targetKey: "openai-default-put-bindings-route",
        displayName: "Route Connection A",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "api-key",
        },
      }),
      integrationConnectionRow({
        id: "icn_put_bindings_route_002",
        organizationId: session.organizationId,
        targetKey: "openai-default-put-bindings-route",
        displayName: "Route Connection B",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "api-key",
        },
      }),
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_bindings_route_001",
        organizationId: session.organizationId,
        displayName: "PUT Bindings Route Profile",
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_put_bindings_route_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_put_bindings_route_existing_001",
          sandboxProfileId: "sbp_put_bindings_route_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_put_bindings_route_001",
          kind: IntegrationBindingKinds.AGENT,
          config: {
            runtime: {
              runtimeId: "codex",
              config: {},
            },
          },
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_put_bindings_route_existing_002",
          sandboxProfileId: "sbp_put_bindings_route_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_put_bindings_route_001",
          kind: IntegrationBindingKinds.CONNECTOR,
          config: {
            connector: "legacy",
          },
        }),
      ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              id: "ibd_put_bindings_route_existing_001",
              connectionId: "icn_put_bindings_route_002",
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
              },
            },
            {
              connectionId: "icn_put_bindings_route_001",
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = PutSandboxProfileVersionIntegrationBindingsResponseSchema.parse(
      await response.json(),
    );
    expect(body.bindings).toHaveLength(2);

    const updatedBinding = body.bindings.find(
      (binding) => binding.id === "ibd_put_bindings_route_existing_001",
    );
    if (updatedBinding === undefined) {
      throw new Error("Expected existing binding to be returned after replacement.");
    }
    expect(updatedBinding.connectionId).toBe("icn_put_bindings_route_002");
    expect(updatedBinding.kind).toBe(IntegrationBindingKinds.AGENT);
    expect(updatedBinding.config).toEqual({
      runtime: {
        runtimeId: "codex",
        config: {},
      },
    });

    const deletedBinding =
      await env.controlPlaneDb.query.sandboxProfileVersionIntegrationBindings.findFirst({
        where: (table, { eq }) => eq(table.id, "ibd_put_bindings_route_existing_002"),
      });
    expect(deletedBinding).toBeUndefined();
  });

  it("returns 400 when a binding references a missing connection", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-missing-connection@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_bindings_route_invalid_connection_001",
        organizationId: session.organizationId,
        displayName: "Invalid Connection Profile",
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_put_bindings_route_invalid_connection_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_invalid_connection_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              connectionId: "icn_missing_for_route",
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(body.code).toBe("INVALID_BINDING_CONNECTION_REFERENCE");
  });

  it("returns 409 without changing bindings when the selected version is published", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-published@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-default-put-bindings-route-published",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_put_bindings_route_published_001",
        organizationId: session.organizationId,
        targetKey: "openai-default-put-bindings-route-published",
        displayName: "Published Route Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "api-key",
        },
      }),
    );

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_bindings_route_published_001",
        organizationId: session.organizationId,
        displayName: "Published Bindings Route Profile",
        activeVersion: 1,
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_put_bindings_route_published_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-03T00:01:00.000Z",
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_put_bindings_route_published_existing_001",
          sandboxProfileId: "sbp_put_bindings_route_published_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_put_bindings_route_published_001",
          kind: IntegrationBindingKinds.AGENT,
          config: {
            runtime: {
              runtimeId: "codex",
              config: {},
            },
          },
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_published_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              id: "ibd_put_bindings_route_published_existing_001",
              connectionId: "icn_put_bindings_route_published_001",
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(409);
    const body = PutSandboxProfileVersionIntegrationBindingsConflictResponseSchema.parse(
      await response.json(),
    );
    expect(body.code).toBe("PROFILE_VERSION_NOT_DRAFT");

    const persistedBinding =
      await env.controlPlaneDb.query.sandboxProfileVersionIntegrationBindings.findFirst({
        columns: {
          connectionId: true,
          kind: true,
          config: true,
        },
        where: (table, { eq }) => eq(table.id, "ibd_put_bindings_route_published_existing_001"),
      });
    expect(persistedBinding).toEqual({
      connectionId: "icn_put_bindings_route_published_001",
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: {
          runtimeId: "codex",
          config: {},
        },
      },
    });
  });

  it("returns 404 when the selected profile version does not exist", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-missing-version@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_bindings_route_missing_version_001",
        organizationId: session.organizationId,
        displayName: "Missing Version Profile",
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_missing_version_001/versions/3/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [],
        }),
      },
    );

    expect(response.status).toBe(404);
    const body = SandboxProfileVersionNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_VERSION_NOT_FOUND");
  });

  it("returns 400 when the request includes multiple bindings from the same git family", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-duplicate-git@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values([
      {
        targetKey: "github-cloud-put-bindings-route-duplicate-family-a",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
      {
        targetKey: "github-cloud-put-bindings-route-duplicate-family-b",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_put_bindings_route_duplicate_family_001",
        organizationId: session.organizationId,
        targetKey: "github-cloud-put-bindings-route-duplicate-family-a",
        displayName: "GitHub Route Family A",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "api-key",
        },
      }),
      integrationConnectionRow({
        id: "icn_put_bindings_route_duplicate_family_002",
        organizationId: session.organizationId,
        targetKey: "github-cloud-put-bindings-route-duplicate-family-b",
        displayName: "GitHub Route Family B",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "api-key",
        },
      }),
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_bindings_route_duplicate_family_001",
        organizationId: session.organizationId,
        displayName: "Duplicate Git Family Profile",
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_put_bindings_route_duplicate_family_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_duplicate_family_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              connectionId: "icn_put_bindings_route_duplicate_family_001",
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: ["mistlehq/mistle"],
              },
            },
            {
              clientRef: "duplicate-github-binding",
              connectionId: "icn_put_bindings_route_duplicate_family_002",
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: ["mistlehq/platform"],
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(body.code).toBe("INVALID_BINDING_CONFIG_REFERENCE");
    if (!("details" in body)) {
      throw new Error("Expected invalid binding config response details.");
    }
    expect(body.details).toEqual({
      issues: [
        {
          clientRef: "duplicate-github-binding",
          bindingIdOrDraftIndex: "draft:1",
          validatorCode: "system.duplicate_git_family_binding",
          field: "connectionId",
          safeMessage:
            "Only one binding from Git integration family 'github' may exist on a sandbox profile version.",
        },
      ],
    });
  });

  it("returns 400 when the request references a non-existent binding id", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-invalid-binding@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-default-put-bindings-route-invalid-binding-id",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_put_bindings_route_invalid_binding_id_001",
        organizationId: session.organizationId,
        targetKey: "openai-default-put-bindings-route-invalid-binding-id",
        displayName: "Invalid Binding Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "api-key",
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_bindings_route_invalid_binding_id_001",
        organizationId: session.organizationId,
        displayName: "Invalid Binding Id Profile",
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_put_bindings_route_invalid_binding_id_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_invalid_binding_id_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              id: "ibd_missing_for_route",
              connectionId: "icn_put_bindings_route_invalid_binding_id_001",
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: {
                  runtimeId: "codex",
                  config: {},
                },
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(body.code).toBe("INVALID_BINDING_REFERENCE");
  });

  it("defaults Jira connector binding tool selections to an empty array", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-jira@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values({
      targetKey: "jira-default-put-bindings-route",
      familyId: "jira",
      variantId: "jira-default",
      enabled: true,
      config: {},
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_put_bindings_route_jira_001",
      organizationId: session.organizationId,
      targetKey: "jira-default-put-bindings-route",
      displayName: "Jira Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "jira-personal-api-token",
        site_url: "https://mistle.atlassian.net",
        email: "user@example.com",
      },
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_bindings_route_jira_001",
        organizationId: session.organizationId,
        displayName: "Jira Binding Profile",
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_put_bindings_route_jira_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_jira_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              connectionId: "icn_put_bindings_route_jira_001",
              kind: IntegrationBindingKinds.CONNECTOR,
              config: {},
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = PutSandboxProfileVersionIntegrationBindingsResponseSchema.parse(
      await response.json(),
    );
    expect(body.bindings).toHaveLength(1);
    expect(body.bindings[0]?.config).toEqual({
      tools: [],
    });

    const persistedBinding =
      await env.controlPlaneDb.query.sandboxProfileVersionIntegrationBindings.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, "sbp_put_bindings_route_jira_001"),
            eq(table.sandboxProfileVersion, 1),
            eq(table.connectionId, "icn_put_bindings_route_jira_001"),
          ),
      });
    expect(persistedBinding?.config).toEqual({
      tools: [],
    });
  });

  it("accepts selected GitHub repositories from a ready resource snapshot", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-github-resources@example.com",
    });

    await insertGitHubBindingFixture({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_put_bindings_route_github_resources_001",
      connectionId: "icn_put_bindings_route_github_resources_001",
      targetKey: "github-cloud-put-bindings-route-resources",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values({
        connectionId: "icn_put_bindings_route_github_resources_001",
        familyId: "github",
        kind: "repository",
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: 2,
        lastSyncedAt: "2026-03-09T10:00:00.000Z",
      });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values([
      {
        id: "rsc_put_bindings_route_github_resources_001",
        connectionId: "icn_put_bindings_route_github_resources_001",
        familyId: "github",
        kind: "repository",
        handle: "mistlehq/mistle",
        displayName: "mistlehq/mistle",
        metadata: {
          visibility: "private",
        },
        lastSeenAt: "2026-03-09T10:00:00.000Z",
      },
      {
        id: "rsc_put_bindings_route_github_resources_002",
        connectionId: "icn_put_bindings_route_github_resources_001",
        familyId: "github",
        kind: "repository",
        handle: "mistlehq/platform",
        displayName: "mistlehq/platform",
        metadata: {
          visibility: "private",
        },
        lastSeenAt: "2026-03-09T10:00:00.000Z",
      },
    ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_github_resources_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              connectionId: "icn_put_bindings_route_github_resources_001",
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: ["mistlehq/mistle", "mistlehq/platform"],
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = PutSandboxProfileVersionIntegrationBindingsResponseSchema.parse(
      await response.json(),
    );
    expect(body.bindings).toHaveLength(1);
    expect(body.bindings[0]?.config).toEqual({
      repositories: ["mistlehq/mistle", "mistlehq/platform"],
      tools: [],
    });
  });

  it("accepts a GitHub binding without selected repositories", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-github-empty@example.com",
    });

    await insertGitHubBindingFixture({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_put_bindings_route_github_empty_001",
      connectionId: "icn_put_bindings_route_github_empty_001",
      targetKey: "github-cloud-put-bindings-route-empty",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_github_empty_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              connectionId: "icn_put_bindings_route_github_empty_001",
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: [],
                tools: ["github-cli"],
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = PutSandboxProfileVersionIntegrationBindingsResponseSchema.parse(
      await response.json(),
    );
    expect(body.bindings).toHaveLength(1);
    expect(body.bindings[0]?.config).toEqual({
      repositories: [],
      tools: ["github-cli"],
    });
  });

  it("returns 400 when selected GitHub repositories are not in the resource snapshot", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-github-unavailable@example.com",
    });

    await insertGitHubBindingFixture({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_put_bindings_route_github_unavailable_001",
      connectionId: "icn_put_bindings_route_github_unavailable_001",
      targetKey: "github-cloud-put-bindings-route-unavailable",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values({
        connectionId: "icn_put_bindings_route_github_unavailable_001",
        familyId: "github",
        kind: "repository",
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: 1,
        lastSyncedAt: "2026-03-09T10:00:00.000Z",
      });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values({
      id: "rsc_put_bindings_route_github_unavailable_001",
      connectionId: "icn_put_bindings_route_github_unavailable_001",
      familyId: "github",
      kind: "repository",
      handle: "mistlehq/mistle",
      displayName: "mistlehq/mistle",
      metadata: {
        visibility: "private",
      },
      lastSeenAt: "2026-03-09T10:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_github_unavailable_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              clientRef: "draft-github-binding",
              connectionId: "icn_put_bindings_route_github_unavailable_001",
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: ["mistlehq/private-repo"],
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(body.code).toBe("INVALID_BINDING_CONFIG_REFERENCE");
    if (!("details" in body)) {
      throw new Error("Expected invalid binding config response details.");
    }
    expect(body.details).toEqual({
      issues: [
        {
          clientRef: "draft-github-binding",
          bindingIdOrDraftIndex: "draft:0",
          validatorCode: "system.inaccessible_resource_reference",
          field: "repositories",
          safeMessage:
            "Selected repository 'mistlehq/private-repo' is no longer accessible for this connection.",
        },
      ],
    });
  });

  it("returns 400 when GitHub repository sync has not produced a usable snapshot", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-version-put-bindings-github-sync-required@example.com",
    });

    await insertGitHubBindingFixture({
      env,
      organizationId: session.organizationId,
      profileId: "sbp_put_bindings_route_github_sync_required_001",
      connectionId: "icn_put_bindings_route_github_sync_required_001",
      targetKey: "github-cloud-put-bindings-route-sync-required",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_github_sync_required_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              connectionId: "icn_put_bindings_route_github_sync_required_001",
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: ["mistlehq/mistle"],
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema.parse(
      await response.json(),
    );
    expect(body.code).toBe("INVALID_BINDING_CONFIG_REFERENCE");
    if (!("details" in body)) {
      throw new Error("Expected invalid binding config response details.");
    }
    expect(body.details).toEqual({
      issues: [
        {
          bindingIdOrDraftIndex: "draft:0",
          validatorCode: "system.resource_sync_required",
          field: "repositories",
          safeMessage:
            "Resource sync is required before repositories can be selected for this connection.",
        },
      ],
    });
  });

  it("returns 400 for invalid request payload shape", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-put-bindings-validation@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_put_bindings_route_validation_001",
        organizationId: session.organizationId,
        displayName: "Validation Profile",
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_put_bindings_route_validation_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_validation_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              connectionId: "",
              kind: IntegrationBindingKinds.AGENT,
              config: {},
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toBe("Invalid request.");
  });

  it("returns 401 when request is unauthenticated", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_put_bindings_route_unauthenticated/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          bindings: [],
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });
});

async function insertGitHubBindingFixture(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  profileId: string;
  connectionId: string;
  targetKey: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey: input.targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationConnections).values(
    integrationConnectionRow({
      id: input.connectionId,
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      displayName: "GitHub Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "api-key",
      },
    }),
  );
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values(
    sandboxProfileRow({
      id: input.profileId,
      organizationId: input.organizationId,
      displayName: "GitHub Binding Profile",
      createdAt: "2026-03-03T00:00:00.000Z",
    }),
  );
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfileVersions).values(
    sandboxProfileVersionRow({
      sandboxProfileId: input.profileId,
      version: 1,
      state: SandboxProfileVersionStates.DRAFT,
    }),
  );
}
