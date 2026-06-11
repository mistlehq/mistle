/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  createDisabledAssociatedResourceEventRouting,
  type AssociatedProviderResourceKind,
  type CompiledRuntimePlan,
} from "@mistle/integrations-core";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { INTERNAL_PROVIDER_RESOURCE_ASSOCIATIONS_ROUTE_BASE_PATH } from "../src/internal/provider-resource-associations/index.js";
import { InternalRegisterProviderResourceAssociationResponseSchema } from "../src/internal/provider-resource-associations/register-provider-resource-association/schema.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("internal provider resource association registration", () => {
  it("registers GitHub pull request associations idempotently for enabled sandbox runtime plans", async ({
    env,
  }) => {
    await seedConnection(env, {
      connectionId: "icn_provider_resource_register_001",
      organizationId: "org_provider_resource_register",
    });
    await seedSandboxInstance(env, {
      sandboxInstanceId: "sbi_provider_resource_register_001",
      organizationId: "org_provider_resource_register",
      associatedResourceEventRouting: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
            eventTypes: [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED],
          },
        ],
      },
    });

    const body = {
      integrationConnectionId: "icn_provider_resource_register_001",
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "987654",
      sandboxInstanceId: "sbi_provider_resource_register_001",
    };
    const firstResponse = await registerAssociation(env, body);
    expect(firstResponse.status).toBe(200);
    const firstBody = InternalRegisterProviderResourceAssociationResponseSchema.parse(
      await firstResponse.json(),
    );
    expect(firstBody.status).toBe("created");
    if (firstBody.status !== "created") {
      throw new Error("Expected first association registration to create a row.");
    }

    const secondResponse = await registerAssociation(env, body);
    expect(secondResponse.status).toBe(200);
    const secondBody = InternalRegisterProviderResourceAssociationResponseSchema.parse(
      await secondResponse.json(),
    );
    expect(secondBody).toEqual({
      status: "already_exists",
      associationId: firstBody.associationId,
    });

    const associations = await env.controlPlaneDb.query.providerResourceAssociations.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.integrationConnectionId, body.integrationConnectionId),
          eq(table.resourceKind, body.resourceKind),
          eq(table.providerResourceId, body.providerResourceId),
          eq(table.sandboxInstanceId, body.sandboxInstanceId),
        ),
    });
    expect(associations).toHaveLength(1);
  });

  it("keeps the first sandbox owner when another sandbox registers the same provider resource", async ({
    env,
  }) => {
    await seedConnection(env, {
      connectionId: "icn_provider_resource_owner_001",
      organizationId: "org_provider_resource_owner",
    });
    for (const sandboxInstanceId of [
      "sbi_provider_resource_owner_first",
      "sbi_provider_resource_owner_second",
    ]) {
      await seedSandboxInstance(env, {
        sandboxInstanceId,
        organizationId: "org_provider_resource_owner",
        associatedResourceEventRouting: {
          enabled: true,
          resources: [
            {
              resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
              eventTypes: [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED],
            },
          ],
        },
      });
    }

    const firstResponse = await registerAssociation(env, {
      integrationConnectionId: "icn_provider_resource_owner_001",
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "owner/repo#123",
      sandboxInstanceId: "sbi_provider_resource_owner_first",
    });
    expect(firstResponse.status).toBe(200);
    const firstBody = InternalRegisterProviderResourceAssociationResponseSchema.parse(
      await firstResponse.json(),
    );
    expect(firstBody.status).toBe("created");
    if (firstBody.status !== "created") {
      throw new Error("Expected first association registration to create a row.");
    }

    const secondResponse = await registerAssociation(env, {
      integrationConnectionId: "icn_provider_resource_owner_001",
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "owner/repo#123",
      sandboxInstanceId: "sbi_provider_resource_owner_second",
    });
    expect(secondResponse.status).toBe(200);
    await expect(secondResponse.json()).resolves.toEqual({
      status: "already_exists",
      associationId: firstBody.associationId,
    });

    const associations = await env.controlPlaneDb.query.providerResourceAssociations.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.integrationConnectionId, "icn_provider_resource_owner_001"),
          eq(table.resourceKind, AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST),
          eq(table.providerResourceId, "owner/repo#123"),
        ),
    });
    expect(associations).toHaveLength(1);
    expect(associations[0]).toMatchObject({
      id: firstBody.associationId,
      sandboxInstanceId: "sbi_provider_resource_owner_first",
    });
  });

  it("does not create an association when the captured runtime plan disables the resource kind", async ({
    env,
  }) => {
    await seedConnection(env, {
      connectionId: "icn_provider_resource_disabled_001",
      organizationId: "org_provider_resource_disabled",
    });
    await seedSandboxInstance(env, {
      sandboxInstanceId: "sbi_provider_resource_disabled_001",
      organizationId: "org_provider_resource_disabled",
      associatedResourceEventRouting: createDisabledAssociatedResourceEventRouting(),
    });

    const response = await registerAssociation(env, {
      integrationConnectionId: "icn_provider_resource_disabled_001",
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "123456",
      sandboxInstanceId: "sbi_provider_resource_disabled_001",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "not_applicable",
      reason: "resource_kind_not_enabled",
    });
    await expect(
      findAssociations(env, {
        integrationConnectionId: "icn_provider_resource_disabled_001",
        resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
        providerResourceId: "123456",
        sandboxInstanceId: "sbi_provider_resource_disabled_001",
      }),
    ).resolves.toEqual([]);
  });

  it("does not associate a sandbox instance from another organization", async ({ env }) => {
    await seedConnection(env, {
      connectionId: "icn_provider_resource_cross_org_001",
      organizationId: "org_provider_resource_cross_org_connection",
    });
    await seedSandboxInstance(env, {
      sandboxInstanceId: "sbi_provider_resource_cross_org_001",
      organizationId: "org_provider_resource_cross_org_sandbox",
      associatedResourceEventRouting: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
            eventTypes: [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED],
          },
        ],
      },
    });

    const response = await registerAssociation(env, {
      integrationConnectionId: "icn_provider_resource_cross_org_001",
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "456789",
      sandboxInstanceId: "sbi_provider_resource_cross_org_001",
    });

    expect(response.status).toBe(404);
    await expect(
      findAssociations(env, {
        integrationConnectionId: "icn_provider_resource_cross_org_001",
        resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
        providerResourceId: "456789",
        sandboxInstanceId: "sbi_provider_resource_cross_org_001",
      }),
    ).resolves.toEqual([]);
  });

  it("returns the validation error contract for invalid registration input", async ({ env }) => {
    const response = await registerAssociation(env, {
      integrationConnectionId: "icn_provider_resource_invalid_body_001",
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      sandboxInstanceId: "sbi_provider_resource_invalid_body_001",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });
});

async function findAssociations(
  env: IntegrationTestEnvironment,
  input: {
    integrationConnectionId: string;
    providerResourceId: string;
    resourceKind: AssociatedProviderResourceKind;
    sandboxInstanceId: string;
  },
) {
  return await env.controlPlaneDb.query.providerResourceAssociations.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.integrationConnectionId, input.integrationConnectionId),
        eq(table.resourceKind, input.resourceKind),
        eq(table.providerResourceId, input.providerResourceId),
        eq(table.sandboxInstanceId, input.sandboxInstanceId),
      ),
  });
}

async function registerAssociation(env: IntegrationTestEnvironment, body: Record<string, unknown>) {
  return await env.controlPlaneApi.http.fetch(
    `${INTERNAL_PROVIDER_RESOURCE_ASSOCIATIONS_ROUTE_BASE_PATH}/register`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
      },
      body: JSON.stringify(body),
    },
  );
}

async function seedConnection(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    organizationId: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationId,
    slug: input.organizationId,
  });
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey: `${input.connectionId}_target`,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoNothing();
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: `${input.connectionId}_target`,
    displayName: input.connectionId,
    status: IntegrationConnectionStatuses.ACTIVE,
  });
}

async function seedSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    associatedResourceEventRouting: CompiledRuntimePlan["associatedResourceEventRouting"];
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_provider_resource_association",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_provider_resource_association",
    source: "webhook",
  });

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: createRuntimePlan(input.associatedResourceEventRouting),
    compiledFromProfileId: "sbp_provider_resource_association",
    compiledFromProfileVersion: 1,
  });
}

function createRuntimePlan(
  associatedResourceEventRouting: CompiledRuntimePlan["associatedResourceEventRouting"],
): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_provider_resource_association",
    version: 1,
    image: {
      source: "base",
      imageRef: "sandbox-base",
    },
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [],
    associatedResourceEventRouting,
    runtimeClients: [],
    agentRuntimes: [],
  };
}
