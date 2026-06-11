import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type {
  AssociatedResourceEventRouting,
  CompiledRuntimePlan,
} from "@mistle/integrations-core";
import {
  GitHubFamilyId,
  observeGitHubAssociatedResourceFromWebhookEvent,
} from "@mistle/integrations-definitions/server";

import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";

export type ResolvedProviderResourceAssociationDeliveryTarget = {
  organizationId: string;
  providerResourceAssociationId: string;
  sandboxInstanceId: string;
  runtimeId: string;
  workingDirectory: string;
};

export async function resolveProviderResourceAssociationDeliveryTarget(
  ctx: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
    db: ControlPlaneDatabase;
  },
  input: {
    providerResourceAssociationId: string;
    sourceWebhookEventId?: string;
  },
): Promise<ResolvedProviderResourceAssociationDeliveryTarget> {
  const association = await ctx.db.query.providerResourceAssociations.findFirst({
    columns: {
      id: true,
      integrationConnectionId: true,
      providerResourceId: true,
      resourceKind: true,
      sandboxInstanceId: true,
    },
    where: (table, { eq }) => eq(table.id, input.providerResourceAssociationId),
  });
  if (association === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ASSOCIATION_NOT_FOUND,
      message: `Provider resource association '${input.providerResourceAssociationId}' was not found.`,
    });
  }

  const integrationConnection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      organizationId: true,
      targetKey: true,
    },
    where: (table, { eq }) => eq(table.id, association.integrationConnectionId),
  });
  if (integrationConnection === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ASSOCIATION_NOT_FOUND,
      message: `Provider resource association '${association.id}' references missing integration connection '${association.integrationConnectionId}'.`,
    });
  }

  const sandboxInstance = await ctx.dataPlaneClient.getSandboxInstance({
    organizationId: integrationConnection.organizationId,
    instanceId: association.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.SANDBOX_NOT_FOUND,
      message: `Provider resource association '${association.id}' references missing sandbox instance '${association.sandboxInstanceId}'.`,
    });
  }
  if (sandboxInstance.runtimePlan === null) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_NOT_FOUND,
      message: `Sandbox instance '${association.sandboxInstanceId}' does not have a persisted runtime plan.`,
    });
  }

  if (input.sourceWebhookEventId !== undefined) {
    const observedEvent = await resolveAssociatedResourceEventFromWebhook(ctx.db, {
      association,
      sourceWebhookEventId: input.sourceWebhookEventId,
      targetKey: integrationConnection.targetKey,
    });

    if (
      !supportsAssociatedResourceEvent({
        eventType: observedEvent.eventType,
        resourceKind: association.resourceKind,
        routing: sandboxInstance.runtimePlan.associatedResourceEventRouting,
      })
    ) {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_EVENT_NOT_ENABLED,
        message: `Provider resource association '${association.id}' is not configured to receive '${observedEvent.eventType}' events for '${association.resourceKind}'.`,
      });
    }
  }

  const runtimeContext = resolveAssociationRuntimeContext(sandboxInstance.runtimePlan);

  return {
    organizationId: integrationConnection.organizationId,
    providerResourceAssociationId: association.id,
    sandboxInstanceId: association.sandboxInstanceId,
    runtimeId: runtimeContext.runtimeId,
    workingDirectory: runtimeContext.workingDirectory,
  };
}

async function resolveAssociatedResourceEventFromWebhook(
  db: ControlPlaneDatabase,
  input: {
    association: {
      id: string;
      providerResourceId: string;
      resourceKind: string;
    };
    sourceWebhookEventId: string;
    targetKey: string;
  },
): Promise<{
  eventType: string;
}> {
  const webhookEvent = await db.query.integrationWebhookEvents.findFirst({
    columns: {
      eventType: true,
      payload: true,
      targetKey: true,
    },
    where: (table, { eq }) => eq(table.id, input.sourceWebhookEventId),
  });
  if (webhookEvent === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.DELIVERY_NOT_FOUND,
      message: `Provider resource association '${input.association.id}' references missing webhook event '${input.sourceWebhookEventId}'.`,
    });
  }
  if (webhookEvent.targetKey !== input.targetKey) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_EVENT_NOT_ENABLED,
      message: `Provider resource association '${input.association.id}' references webhook event '${input.sourceWebhookEventId}' for a different integration target.`,
    });
  }

  const target = await db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
    },
    where: (table, { eq }) => eq(table.targetKey, webhookEvent.targetKey),
  });
  const observedEvent =
    target?.familyId === GitHubFamilyId
      ? observeGitHubAssociatedResourceFromWebhookEvent({
          eventType: webhookEvent.eventType,
          payload: webhookEvent.payload,
        })
      : null;

  if (
    observedEvent === null ||
    observedEvent.resourceKind !== input.association.resourceKind ||
    observedEvent.providerResourceId !== input.association.providerResourceId
  ) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_EVENT_NOT_ENABLED,
      message: `Provider resource association '${input.association.id}' references webhook event '${input.sourceWebhookEventId}' that does not match the associated provider resource.`,
    });
  }

  return {
    eventType: observedEvent.eventType,
  };
}

function supportsAssociatedResourceEvent(input: {
  eventType: string;
  resourceKind: string;
  routing: AssociatedResourceEventRouting | null;
}): boolean {
  if (input.routing === null || !input.routing.enabled) {
    return false;
  }

  return input.routing.resources.some(
    (resource) =>
      resource.resourceKind === input.resourceKind &&
      resource.eventTypes.some((eventType) => eventType === input.eventType),
  );
}

function resolveAssociationRuntimeContext(runtimePlan: CompiledRuntimePlan): {
  runtimeId: string;
  workingDirectory: string;
} {
  const agentRuntime = runtimePlan.agentRuntimes.find(
    (candidate) => candidate.runtimeId === "codex",
  );
  if (agentRuntime === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_AGENT_RUNTIME_NOT_FOUND,
      message: "Associated sandbox runtime plan does not define a Codex agent runtime.",
    });
  }

  const workingDirectory =
    agentRuntime.ptyLaunch.newLaunch.cwd ?? agentRuntime.ptyLaunch.resumeLaunch.cwd;
  if (workingDirectory === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_WORKING_DIRECTORY_NOT_FOUND,
      message: `Associated sandbox runtime '${agentRuntime.runtimeId}' does not define a working directory.`,
    });
  }

  return {
    runtimeId: agentRuntime.runtimeId,
    workingDirectory,
  };
}
