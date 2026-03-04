import {
  integrationConnections,
  integrationTargets,
  IntegrationBindingKinds,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { describe, expect } from "vitest";

import {
  PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema,
  PutSandboxProfileVersionIntegrationBindingsResponseSchema,
  SandboxProfileVersionNotFoundResponseSchema,
  ValidationErrorResponseSchema,
} from "../src/sandbox-profiles/contracts.js";
import { it } from "./test-context.js";

describe("sandbox profile version put integration bindings integration", () => {
  it("replaces integration bindings for the selected sandbox profile version", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-route@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-put-bindings-route",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });

    const [connectionA, connectionB] = await fixture.db
      .insert(integrationConnections)
      .values([
        {
          id: "icn_put_bindings_route_001",
          organizationId: authenticatedSession.organizationId,
          targetKey: "openai-default-put-bindings-route",
          config: {
            auth_scheme: "api-key",
          },
        },
        {
          id: "icn_put_bindings_route_002",
          organizationId: authenticatedSession.organizationId,
          targetKey: "openai-default-put-bindings-route",
          config: {
            auth_scheme: "api-key",
          },
        },
      ])
      .returning();

    if (connectionA === undefined || connectionB === undefined) {
      throw new Error("Expected integration connections to be inserted.");
    }

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_route_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "PUT Bindings Route Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_put_bindings_route_001",
      version: 1,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        id: "ibd_put_bindings_route_existing_001",
        sandboxProfileId: "sbp_put_bindings_route_001",
        sandboxProfileVersion: 1,
        connectionId: connectionA.id,
        kind: IntegrationBindingKinds.AGENT,
        config: {
          runtime: "codex-cli",
          defaultModel: "gpt-4.1",
        },
      },
      {
        id: "ibd_put_bindings_route_existing_002",
        sandboxProfileId: "sbp_put_bindings_route_001",
        sandboxProfileVersion: 1,
        connectionId: connectionA.id,
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {
          connector: "legacy",
        },
      },
    ]);

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_bindings_route_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              id: "ibd_put_bindings_route_existing_001",
              connectionId: connectionB.id,
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: "codex-cli",
                defaultModel: "gpt-5",
              },
            },
            {
              connectionId: connectionA.id,
              kind: IntegrationBindingKinds.GIT,
              config: {
                repositories: ["mistlehq/mistle"],
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PutSandboxProfileVersionIntegrationBindingsResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.bindings).toHaveLength(2);

    const updatedBinding = responseBody.bindings.find(
      (binding) => binding.id === "ibd_put_bindings_route_existing_001",
    );
    expect(updatedBinding).toBeDefined();
    expect(updatedBinding?.connectionId).toBe(connectionB.id);
    expect(updatedBinding?.kind).toBe(IntegrationBindingKinds.AGENT);
    expect(updatedBinding?.config).toEqual({
      runtime: "codex-cli",
      defaultModel: "gpt-5",
    });

    const deletedBinding =
      await fixture.db.query.sandboxProfileVersionIntegrationBindings.findFirst({
        where: (table, { eq }) => eq(table.id, "ibd_put_bindings_route_existing_002"),
      });
    expect(deletedBinding).toBeUndefined();
  }, 60_000);

  it("returns 400 when binding references a missing or inaccessible connection", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email:
        "integration-sandbox-profile-version-put-bindings-route-invalid-connection@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_route_invalid_connection_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Invalid Connection Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_put_bindings_route_invalid_connection_001",
      version: 1,
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_bindings_route_invalid_connection_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              connectionId: "icn_missing_for_route",
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: "codex-cli",
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema.parse(
      await response.json(),
    );
    if (!("code" in responseBody)) {
      throw new Error("Expected integration bindings bad-request error response.");
    }
    expect(responseBody.code).toBe("INVALID_BINDING_CONNECTION_REFERENCE");
  }, 60_000);

  it("returns 404 when sandbox profile version is missing", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-route-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_route_missing_version_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Missing Version Profile",
      status: "active",
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_bindings_route_missing_version_001/versions/3/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          bindings: [],
        }),
      },
    );

    expect(response.status).toBe(404);
    const responseBody = SandboxProfileVersionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  }, 60_000);

  it("returns 400 when request references a non-existent binding id", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email:
        "integration-sandbox-profile-version-put-bindings-route-invalid-binding-id@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-put-bindings-route-invalid-binding-id",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_route_invalid_binding_id_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Invalid Binding Id Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_put_bindings_route_invalid_binding_id_001",
      version: 1,
    });

    const [connection] = await fixture.db
      .insert(integrationConnections)
      .values({
        id: "icn_put_bindings_route_invalid_binding_id_001",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default-put-bindings-route-invalid-binding-id",
        config: {
          auth_scheme: "api-key",
        },
      })
      .returning();

    if (connection === undefined) {
      throw new Error("Expected integration connection to be inserted.");
    }

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_bindings_route_invalid_binding_id_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              id: "ibd_missing_for_route",
              connectionId: connection.id,
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: "codex-cli",
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema.parse(
      await response.json(),
    );
    if (!("code" in responseBody)) {
      throw new Error("Expected integration bindings bad-request error response.");
    }
    expect(responseBody.code).toBe("INVALID_BINDING_REFERENCE");
  }, 60_000);

  it("returns 400 for invalid request payload shape", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-route-validation@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_route_validation_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Validation Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_put_bindings_route_validation_001",
      version: 1,
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_bindings_route_validation_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
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
    const responseBody = ValidationErrorResponseSchema.parse(await response.json());
    expect(responseBody.success).toBe(false);
    expect(responseBody.error.name).toBe("ZodError");
  }, 60_000);

  it("returns INVALID_BINDING_CONFIG_REFERENCE with issue details for unsupported model", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-invalid-model@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-put-bindings-invalid-model",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_invalid_model_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Invalid Model Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_put_bindings_invalid_model_001",
      version: 1,
    });

    const [connection] = await fixture.db
      .insert(integrationConnections)
      .values({
        id: "icn_put_bindings_invalid_model_001",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default-put-bindings-invalid-model",
        config: {
          auth_scheme: "api-key",
        },
      })
      .returning();
    if (connection === undefined) {
      throw new Error("Expected integration connection to be inserted.");
    }

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_bindings_invalid_model_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              clientRef: "row-1",
              connectionId: connection.id,
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: "codex-cli",
                defaultModel: "gpt-4.1",
                reasoningEffort: "medium",
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema.parse(
      await response.json(),
    );
    if (!("code" in responseBody)) {
      throw new Error("Expected integration bindings bad-request error response.");
    }
    expect(responseBody.code).toBe("INVALID_BINDING_CONFIG_REFERENCE");
    if (responseBody.code !== "INVALID_BINDING_CONFIG_REFERENCE") {
      throw new Error("Expected invalid binding config reference response.");
    }
    expect(responseBody.details.issues[0]?.clientRef).toBe("row-1");
    expect(responseBody.details.issues[0]?.validatorCode).toBe(
      "system.invalid_binding_config_shape",
    );
  }, 60_000);

  it("returns INVALID_BINDING_CONFIG_REFERENCE for unsupported reasoning per model", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-put-bindings-invalid-reasoning@example.com",
    });

    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-default-put-bindings-invalid-reasoning",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
      },
    });
    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_put_bindings_invalid_reasoning_001",
      organizationId: authenticatedSession.organizationId,
      displayName: "Invalid Reasoning Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_put_bindings_invalid_reasoning_001",
      version: 1,
    });

    const [connection] = await fixture.db
      .insert(integrationConnections)
      .values({
        id: "icn_put_bindings_invalid_reasoning_001",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-default-put-bindings-invalid-reasoning",
        config: {
          auth_scheme: "api-key",
        },
      })
      .returning();
    if (connection === undefined) {
      throw new Error("Expected integration connection to be inserted.");
    }

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_put_bindings_invalid_reasoning_001/versions/1/integration-bindings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          bindings: [
            {
              clientRef: "row-2",
              connectionId: connection.id,
              kind: IntegrationBindingKinds.AGENT,
              config: {
                runtime: "codex-cli",
                defaultModel: "gpt-5.1-codex-mini",
                reasoningEffort: "low",
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const responseBody = PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema.parse(
      await response.json(),
    );
    if (!("code" in responseBody)) {
      throw new Error("Expected integration bindings bad-request error response.");
    }
    expect(responseBody.code).toBe("INVALID_BINDING_CONFIG_REFERENCE");
    if (responseBody.code !== "INVALID_BINDING_CONFIG_REFERENCE") {
      throw new Error("Expected invalid binding config reference response.");
    }
    expect(responseBody.details.issues[0]?.validatorCode).toBe(
      "openai.unsupported_reasoning_for_model",
    );
  }, 60_000);

  it("returns 401 when request is unauthenticated", async ({ fixture }) => {
    const response = await fixture.request(
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
  }, 60_000);
});
