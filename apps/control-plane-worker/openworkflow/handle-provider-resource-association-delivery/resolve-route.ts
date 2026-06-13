import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type {
  AgentRuntimeReader,
  AssociatedResourceWebhookObservation,
  CompiledAgentRuntime,
  CompiledRuntimePlan,
  IntegrationRegistry,
} from "@mistle/integrations-core";
import { supportsAssociatedResourceDeliveryRuntime } from "@mistle/integrations-core";

import { supportsAssociatedResourceEvent } from "../shared/associated-resource-routing.js";
import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";

export type ResolvedProviderResourceAssociationDeliveryTarget = {
  organizationId: string;
  providerResourceAssociationId: string;
  sandboxInstanceId: string;
  runtimeId: string;
};

export async function resolveProviderResourceAssociationDeliveryTarget(
  ctx: {
    agentRuntimeRegistry: AgentRuntimeReader;
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
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
      integrationRegistry: ctx.integrationRegistry,
      sourceWebhookEventId: input.sourceWebhookEventId,
      targetKey: integrationConnection.targetKey,
    });

    if (
      !(await supportsAssociatedResourceEvent({
        capability: observedEvent.capability,
        eventType: observedEvent.eventType,
        payload: observedEvent.payload,
        resourceKind: association.resourceKind,
        routing: sandboxInstance.runtimePlan.associatedResourceEventRouting,
        sourceWebhookEventType: observedEvent.sourceWebhookEventType,
      }))
    ) {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_EVENT_NOT_ENABLED,
        message: `Provider resource association '${association.id}' is not configured to receive '${observedEvent.eventType}' events for '${association.resourceKind}'.`,
      });
    }
  }

  const runtimeContext = resolveAssociationRuntimeContext({
    agentRuntimeRegistry: ctx.agentRuntimeRegistry,
    runtimePlan: sandboxInstance.runtimePlan,
  });

  return {
    organizationId: integrationConnection.organizationId,
    providerResourceAssociationId: association.id,
    sandboxInstanceId: association.sandboxInstanceId,
    runtimeId: runtimeContext.runtimeId,
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
    integrationRegistry: IntegrationRegistry;
    sourceWebhookEventId: string;
    targetKey: string;
  },
): Promise<
  AssociatedResourceWebhookObservation & {
    capability: NonNullable<
      ReturnType<IntegrationRegistry["getDefinition"]>
    >["associatedResourceEvents"];
    payload: Record<string, unknown>;
    sourceWebhookEventType: string;
  }
> {
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
      variantId: true,
    },
    where: (table, { eq }) => eq(table.targetKey, webhookEvent.targetKey),
  });
  const definition =
    target === undefined
      ? undefined
      : input.integrationRegistry.getDefinition({
          familyId: target.familyId,
          variantId: target.variantId,
        });
  const observedEvent =
    (await definition?.associatedResourceEvents?.observeWebhookEvent({
      eventType: webhookEvent.eventType,
      payload: webhookEvent.payload,
    })) ?? null;

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
    ...observedEvent,
    capability: definition?.associatedResourceEvents,
    payload: webhookEvent.payload,
    sourceWebhookEventType: webhookEvent.eventType,
  };
}

function resolveAssociationRuntimeContext(input: {
  agentRuntimeRegistry: AgentRuntimeReader;
  runtimePlan: CompiledRuntimePlan;
}): {
  runtimeId: string;
} {
  const supportedAgentRuntimes = input.runtimePlan.agentRuntimes.filter((candidate) =>
    supportsAssociationDeliveryRuntime({
      agentRuntime: candidate,
      agentRuntimeRegistry: input.agentRuntimeRegistry,
    }),
  );
  const agentRuntime = supportedAgentRuntimes[0];
  if (agentRuntime === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_AGENT_RUNTIME_NOT_FOUND,
      message:
        "Associated sandbox runtime plan does not define an agent runtime that supports association delivery.",
    });
  }
  if (supportedAgentRuntimes.length > 1) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_AGENT_RUNTIME_NOT_FOUND,
      message:
        "Associated sandbox runtime plan defines multiple agent runtimes that support association delivery.",
    });
  }

  return {
    runtimeId: agentRuntime.runtimeId,
  };
}

function supportsAssociationDeliveryRuntime(input: {
  agentRuntime: CompiledAgentRuntime;
  agentRuntimeRegistry: AgentRuntimeReader;
}): boolean {
  if (supportsAssociatedResourceDeliveryRuntime(input.agentRuntime)) {
    return true;
  }
  if (input.agentRuntime.capabilities !== undefined) {
    return false;
  }

  const runtimeDefinition = input.agentRuntimeRegistry.getRuntime({
    runtimeId: input.agentRuntime.runtimeId,
  });
  return runtimeDefinition === undefined
    ? false
    : supportsAssociatedResourceDeliveryRuntime(runtimeDefinition);
}
