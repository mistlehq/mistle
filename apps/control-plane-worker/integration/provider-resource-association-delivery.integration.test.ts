/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  ProviderResourceAssociationDeliveryProcessorStatuses,
  ProviderResourceAssociationDeliveryStatuses,
  SandboxProfileStatuses,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createDisabledAssociatedResourceEventRouting } from "@mistle/integrations-core";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  claimOrResumeProviderResourceAssociationDelivery,
  finalizeProviderResourceAssociationDelivery,
  releaseProviderResourceAssociationDeliveryForRetry,
} from "../openworkflow/handle-provider-resource-association-delivery/deliveries.js";
import { ProviderResourceAssociationDeliveryFailureCodes } from "../openworkflow/handle-provider-resource-association-delivery/errors.js";
import {
  ensureProviderResourceAssociationDeliveryProcessor,
  idleProviderResourceAssociationDeliveryProcessorIfEmpty,
} from "../openworkflow/handle-provider-resource-association-delivery/processor.js";
import { resolveProviderResourceAssociationDeliveryTarget } from "../openworkflow/handle-provider-resource-association-delivery/resolve-route.js";

const it = createIntegrationTest({
  services: ["control-plane-worker", "data-plane-api"],
});

const InternalServiceToken = "integration-new-internal-service-token";
const TestEnvironmentIdHeader = "x-mistle-test-environment-id";

describe.concurrent("provider resource association delivery", () => {
  it("claims queued deliveries for one association in source order", async ({ env }) => {
    const scope = await seedAssociationDeliveryScope({
      env,
      suffix: createSuffix("claim_order"),
    });
    await insertAssociationDelivery({
      env,
      scope,
      deliveryId: "prd_claim_order_later",
      webhookEventId: "iwe_claim_order_later",
      sourceOrderKey: "2026-03-09T00:00:00Z#0002",
    });
    await insertAssociationDelivery({
      env,
      scope,
      deliveryId: "prd_claim_order_earlier",
      webhookEventId: "iwe_claim_order_earlier",
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });

    const processor = await ensureProviderResourceAssociationDeliveryProcessor(
      { db: env.controlPlaneDb },
      {
        providerResourceAssociationId: scope.providerResourceAssociationId,
      },
    );

    const firstClaim = await claimOrResumeProviderResourceAssociationDelivery(
      { db: env.controlPlaneDb },
      {
        providerResourceAssociationId: scope.providerResourceAssociationId,
        generation: processor.generation,
      },
    );

    expect(firstClaim?.id).toBe("prd_claim_order_earlier");
    expect(firstClaim?.sourceOrderKey).toBe("2026-03-09T00:00:00Z#0001");
    expect(firstClaim?.processorGeneration).toBe(processor.generation);

    await finalizeProviderResourceAssociationDelivery(
      { db: env.controlPlaneDb },
      {
        deliveryId: "prd_claim_order_earlier",
        generation: processor.generation,
        status: ProviderResourceAssociationDeliveryStatuses.COMPLETED,
      },
    );

    const secondClaim = await claimOrResumeProviderResourceAssociationDelivery(
      { db: env.controlPlaneDb },
      {
        providerResourceAssociationId: scope.providerResourceAssociationId,
        generation: processor.generation,
      },
    );

    expect(secondClaim?.id).toBe("prd_claim_order_later");
    expect(secondClaim?.sourceOrderKey).toBe("2026-03-09T00:00:00Z#0002");
    expect(secondClaim?.processorGeneration).toBe(processor.generation);
  });

  it("reuses a running association delivery processor until it idles", async ({ env }) => {
    const scope = await seedAssociationDeliveryScope({
      env,
      suffix: createSuffix("processor"),
    });

    const firstEnsure = await ensureProviderResourceAssociationDeliveryProcessor(
      { db: env.controlPlaneDb },
      {
        providerResourceAssociationId: scope.providerResourceAssociationId,
      },
    );
    const secondEnsure = await ensureProviderResourceAssociationDeliveryProcessor(
      { db: env.controlPlaneDb },
      {
        providerResourceAssociationId: scope.providerResourceAssociationId,
      },
    );

    expect(firstEnsure).toEqual({
      providerResourceAssociationId: scope.providerResourceAssociationId,
      generation: 1,
      shouldStart: true,
    });
    expect(secondEnsure).toEqual({
      providerResourceAssociationId: scope.providerResourceAssociationId,
      generation: 1,
      shouldStart: false,
    });

    expect(
      await idleProviderResourceAssociationDeliveryProcessorIfEmpty(
        { db: env.controlPlaneDb },
        {
          providerResourceAssociationId: scope.providerResourceAssociationId,
          generation: 1,
        },
      ),
    ).toBe(true);

    const processor =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveryProcessors.findFirst({
        where: (table, { eq }) =>
          eq(table.providerResourceAssociationId, scope.providerResourceAssociationId),
      });
    expect(processor).toEqual(
      expect.objectContaining({
        providerResourceAssociationId: scope.providerResourceAssociationId,
        status: ProviderResourceAssociationDeliveryProcessorStatuses.IDLE,
        generation: 1,
      }),
    );
  });

  it("keeps a processor running when a delivery is released for retry", async ({ env }) => {
    const scope = await seedAssociationDeliveryScope({
      env,
      suffix: createSuffix("release_retry"),
    });
    await insertAssociationDelivery({
      env,
      scope,
      deliveryId: "prd_release_retry",
      webhookEventId: "iwe_release_retry",
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });
    const processor = await ensureProviderResourceAssociationDeliveryProcessor(
      { db: env.controlPlaneDb },
      {
        providerResourceAssociationId: scope.providerResourceAssociationId,
      },
    );
    const claimedDelivery = await claimOrResumeProviderResourceAssociationDelivery(
      { db: env.controlPlaneDb },
      {
        providerResourceAssociationId: scope.providerResourceAssociationId,
        generation: processor.generation,
      },
    );
    expect(claimedDelivery?.id).toBe("prd_release_retry");

    await releaseProviderResourceAssociationDeliveryForRetry(
      { db: env.controlPlaneDb },
      {
        deliveryId: "prd_release_retry",
        generation: processor.generation,
        failureCode: "provider_state_persist_failed",
        failureMessage: "Provider state persist failed.",
      },
    );

    const persistedProcessor =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveryProcessors.findFirst({
        where: (table, { eq }) =>
          eq(table.providerResourceAssociationId, scope.providerResourceAssociationId),
      });
    expect(persistedProcessor).toEqual(
      expect.objectContaining({
        providerResourceAssociationId: scope.providerResourceAssociationId,
        status: ProviderResourceAssociationDeliveryProcessorStatuses.RUNNING,
        generation: processor.generation,
      }),
    );

    const retriedDelivery = await claimOrResumeProviderResourceAssociationDelivery(
      { db: env.controlPlaneDb },
      {
        providerResourceAssociationId: scope.providerResourceAssociationId,
        generation: processor.generation,
      },
    );
    expect(retriedDelivery).toEqual(
      expect.objectContaining({
        id: "prd_release_retry",
        processorGeneration: processor.generation,
        status: ProviderResourceAssociationDeliveryStatuses.CLAIMED,
      }),
    );
  });

  it("resolves the associated sandbox Codex runtime target without a trigger conversation route", async ({
    env,
  }) => {
    const scope = await seedAssociationDeliveryScope({
      env,
      suffix: createSuffix("route"),
    });
    await insertSandboxInstance(env, scope);

    const resolvedTarget = await resolveProviderResourceAssociationDeliveryTarget(
      {
        dataPlaneClient: createDataPlaneClient(env),
        db: env.controlPlaneDb,
      },
      {
        providerResourceAssociationId: scope.providerResourceAssociationId,
      },
    );

    expect(resolvedTarget).toMatchObject({
      organizationId: scope.organizationId,
      providerResourceAssociationId: scope.providerResourceAssociationId,
      sandboxInstanceId: scope.sandboxInstanceId,
      runtimeId: "codex",
      workingDirectory: "/root/repo",
    });
  });

  it("fails explicitly when the associated sandbox has no Codex runtime", async ({ env }) => {
    const scope = await seedAssociationDeliveryScope({
      env,
      suffix: createSuffix("missing_route"),
    });
    await insertSandboxInstance(env, scope, { includeCodexRuntime: false });

    await expect(
      resolveProviderResourceAssociationDeliveryTarget(
        {
          dataPlaneClient: createDataPlaneClient(env),
          db: env.controlPlaneDb,
        },
        {
          providerResourceAssociationId: scope.providerResourceAssociationId,
        },
      ),
    ).rejects.toMatchObject({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_AGENT_RUNTIME_NOT_FOUND,
    });
  });
});

type AssociationDeliveryScope = {
  organizationId: string;
  sandboxProfileId: string;
  integrationConnectionId: string;
  targetKey: string;
  sandboxInstanceId: string;
  providerResourceAssociationId: string;
};

function createSuffix(label: string): string {
  return `${label}_${randomUUID().replaceAll("-", "_")}`;
}

function createDataPlaneClient(env: IntegrationTestEnvironment) {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

async function seedAssociationDeliveryScope(input: {
  env: IntegrationTestEnvironment;
  suffix: string;
}): Promise<AssociationDeliveryScope> {
  const organizationId = `org_pra_delivery_${input.suffix}`;
  const sandboxProfileId = `sbp_pra_delivery_${input.suffix}`;
  const targetKey = `github_cloud_pra_delivery_${input.suffix}`;
  const integrationConnectionId = `icn_pra_delivery_${input.suffix}`;
  const sandboxInstanceId = `sbi_pra_delivery_${input.suffix}`;
  const providerResourceAssociationId = `pra_delivery_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Provider Resource Association Delivery ${input.suffix}`,
    slug: `pra-delivery-${input.suffix}`,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Provider Resource Association Delivery ${input.suffix}`,
    status: SandboxProfileStatuses.ACTIVE,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {},
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values({
      id: integrationConnectionId,
      organizationId,
      targetKey,
      displayName: `Provider Resource Association Delivery ${input.suffix}`,
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: `subject-${input.suffix}`,
      config: {},
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.providerResourceAssociations)
    .values({
      id: providerResourceAssociationId,
      integrationConnectionId,
      resourceKind: "github_pull_request",
      providerResourceId: "mistlehq/mistle#2782",
      sandboxInstanceId,
    });

  return {
    organizationId,
    sandboxProfileId,
    integrationConnectionId,
    targetKey,
    sandboxInstanceId,
    providerResourceAssociationId,
  };
}

async function insertAssociationDelivery(input: {
  env: IntegrationTestEnvironment;
  scope: AssociationDeliveryScope;
  deliveryId: string;
  webhookEventId: string;
  sourceOrderKey: string;
}): Promise<void> {
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationWebhookSources)
    .values({
      id: `iws_${input.webhookEventId}`,
      organizationId: input.scope.organizationId,
      integrationConnectionId: input.scope.integrationConnectionId,
      targetKey: input.scope.targetKey,
      endpointKey: `endpoint-${input.webhookEventId}`,
      status: "active",
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationWebhookEvents)
    .values({
      id: input.webhookEventId,
      organizationId: input.scope.organizationId,
      integrationConnectionId: input.scope.integrationConnectionId,
      integrationWebhookSourceId: `iws_${input.webhookEventId}`,
      targetKey: input.scope.targetKey,
      externalEventId: `event-${input.webhookEventId}`,
      externalDeliveryId: `delivery-${input.webhookEventId}`,
      providerEventType: "issue_comment",
      eventType: "github.issue_comment.created",
      payload: {},
      sourceOccurredAt: "2026-03-09T00:00:00.000Z",
      sourceOrderKey: input.sourceOrderKey,
      status: "processed",
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.providerResourceAssociationDeliveries)
    .values({
      id: input.deliveryId,
      providerResourceAssociationId: input.scope.providerResourceAssociationId,
      sourceWebhookEventId: input.webhookEventId,
      sourceOrderKey: input.sourceOrderKey,
      renderedInput: {
        text: `delivery ${input.deliveryId}`,
      },
      status: ProviderResourceAssociationDeliveryStatuses.QUEUED,
    });
}

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: AssociationDeliveryScope,
  options: {
    includeCodexRuntime?: boolean;
  } = {},
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    title: "Associated PR session",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: null,
    status: SandboxInstanceStatuses.PENDING,
    startedByKind: "user",
    startedById: "usr_pra_delivery",
    source: "dashboard",
  });
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: createRuntimePlan(input, {
      includeCodexRuntime: options.includeCodexRuntime ?? true,
    }),
    compiledFromProfileId: input.sandboxProfileId,
    compiledFromProfileVersion: 1,
  });
}

function createRuntimePlan(
  input: AssociationDeliveryScope,
  options: {
    includeCodexRuntime: boolean;
  },
) {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: 1,
    image: {
      source: "base",
      imageRef: "registry:runtime-context",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    associatedResourceEventRouting: createDisabledAssociatedResourceEventRouting(),
    workspaceSources: [],
    agentRuntimes: [
      {
        runtimeId: "opencode",
        runtimeKey: "opencode-app-server",
        clientId: "opencode-cli",
        endpointKey: "app-server",
        ptyLaunch: {
          runtimeId: "opencode",
          displayName: "OpenCode",
          newLaunch: {
            ptySessionId: "opencode-cli",
            cols: 120,
            rows: 32,
            cwd: "/root/wrong-runtime",
            command: "opencode",
            args: [],
          },
          resumeLaunch: {
            ptySessionId: "opencode-cli",
            cols: 120,
            rows: 32,
            cwd: "/root/wrong-runtime",
            command: "opencode",
            args: [],
          },
        },
      },
      ...(options.includeCodexRuntime
        ? [
            {
              runtimeId: "codex",
              runtimeKey: "codex-app-server",
              clientId: "codex-cli",
              endpointKey: "app-server",
              ptyLaunch: {
                runtimeId: "codex",
                displayName: "Codex",
                newLaunch: {
                  ptySessionId: "cli",
                  cols: 120,
                  rows: 32,
                  cwd: "/root/repo",
                  command: "codex",
                  args: [],
                },
                resumeLaunch: {
                  ptySessionId: "cli",
                  cols: 120,
                  rows: 32,
                  cwd: "/root/repo",
                  command: "codex",
                  args: [],
                },
              },
            },
          ]
        : []),
    ],
  };
}
