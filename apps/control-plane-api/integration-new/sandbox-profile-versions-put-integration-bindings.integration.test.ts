/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
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
