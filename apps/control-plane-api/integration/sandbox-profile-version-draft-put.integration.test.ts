/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionDefaultPersistenceModes,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import {
  E2BSandboxRuntimeFamilyId,
  E2BSandboxRuntimeVariantId,
} from "@mistle/integrations-definitions";
import { SandboxProvider } from "@mistle/sandbox";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  PutSandboxProfileVersionDraftBadRequestResponseSchema,
  PutSandboxProfileVersionDraftConflictResponseSchema,
  PutSandboxProfileVersionDraftResponseSchema,
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

const EmptySandboxRuntimeConfig = {
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
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
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
          config: {
            runtime: {
              runtimeId: "codex",
              config: {},
            },
          },
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
          defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
          integrationBindings: {
            bindings: [
              {
                id: "ibd_draft_put_existing_001",
                connectionId: "icn_draft_put_002",
                kind: IntegrationBindingKinds.AGENT,
                config: {
                  runtime: {
                    runtimeId: "codex",
                    config: {},
                  },
                },
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
      defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
      ...EmptySandboxRuntimeConfig,
      integrationBindings: {
        bindings: [
          {
            id: "ibd_draft_put_existing_001",
            sandboxProfileId: "sbp_draft_put_001",
            sandboxProfileVersion: 1,
            connectionId: "icn_draft_put_002",
            kind: IntegrationBindingKinds.AGENT,
            config: {
              runtime: {
                runtimeId: "codex",
                config: {},
              },
            },
            createdAt: responseBody.integrationBindings.bindings[0]?.createdAt,
            updatedAt: responseBody.integrationBindings.bindings[0]?.updatedAt,
          },
        ],
      },
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
        defaultPersistenceMode: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_draft_put_001"), eq(table.version, 1)),
    });
    expect(persistedVersion).toEqual({
      setupScript: "pnpm install\npnpm dev:bootstrap",
      defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
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
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
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
          defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
          integrationBindings: {
            bindings: [
              {
                connectionId: "icn_draft_put_missing",
                kind: IntegrationBindingKinds.AGENT,
                config: {
                  runtime: {
                    runtimeId: "codex",
                    config: {},
                  },
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
    expect(responseBody.code).toBe("INVALID_BINDING_CONNECTION_REFERENCE");

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
        defaultPersistenceMode: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_draft_put_atomicity_001"), eq(table.version, 1)),
    });
    expect(persistedVersion).toEqual({
      setupScript: "pnpm install",
      defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
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
