import { ProviderResourceAssociationDeliveryStatuses } from "@mistle/db/control-plane";
import { HandleProviderResourceAssociationDeliveryWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { shouldRethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";
import { trace } from "@opentelemetry/api";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import type { ExecuteConversationProviderDeliveryInput } from "../handle-trigger-conversation-delivery/types.js";
import { updateTriggerConversationExecution } from "../shared/update-conversation-execution.js";
import { acquireProviderResourceAssociationDeliveryConnection } from "./acquire-connection.js";
import {
  type ActiveProviderResourceAssociationDelivery,
  claimOrResumeProviderResourceAssociationDelivery,
  finalizeProviderResourceAssociationDelivery,
  markProviderResourceAssociationDeliveryDelivering,
  releaseProviderResourceAssociationDeliveryForRetry,
} from "./deliveries.js";
import { discoverOriginalRuntimeProviderResourceAssociationDeliveryRoute } from "./discover-original-runtime-route.js";
import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";
import {
  idleProviderResourceAssociationDeliveryProcessorIfEmpty,
  isProviderResourceAssociationDeliveryProcessorRunning,
} from "./processor.js";
import { resolveProviderResourceAssociationDeliveryRoute } from "./resolve-route.js";
import { submitCodexAssociatedResourceDelivery } from "./submit-codex-associated-resource-delivery.js";

const SingleAttemptDeliveryStepRetryPolicy = {
  maximumAttempts: 1,
} as const;

const IdempotentProviderDeliveryStepRetryPolicy = {
  maximumAttempts: 3,
} as const;

export const HandleProviderResourceAssociationDeliveryWorkflow = defineTracedControlPlaneWorkflow(
  HandleProviderResourceAssociationDeliveryWorkflowSpec,
  async ({ input, run, step }) => {
    const { controlPlaneInternalClient, dataPlaneClient, db } = await getWorkflowContext();
    const workflowRunId = run.id;
    let iteration = 0;

    while (true) {
      const isProcessorRunning = await step.run(
        { name: `check-provider-resource-association-delivery-processor:${String(iteration)}` },
        async () =>
          isProviderResourceAssociationDeliveryProcessorRunning(
            {
              db,
            },
            input,
          ),
      );
      if (!isProcessorRunning) {
        return {
          providerResourceAssociationId: input.providerResourceAssociationId,
          generation: input.generation,
        };
      }

      const activeDelivery = await step.run(
        { name: `claim-or-resume-provider-resource-association-delivery:${String(iteration)}` },
        async () =>
          claimOrResumeProviderResourceAssociationDelivery(
            {
              db,
            },
            input,
          ),
      );

      if (activeDelivery === null) {
        const didIdleProcessor = await step.run(
          { name: `idle-provider-resource-association-delivery-processor:${String(iteration)}` },
          async () =>
            idleProviderResourceAssociationDeliveryProcessorIfEmpty(
              {
                db,
              },
              input,
            ),
        );
        if (didIdleProcessor) {
          return {
            providerResourceAssociationId: input.providerResourceAssociationId,
            generation: input.generation,
          };
        }

        iteration += 1;
        continue;
      }

      let deliveryAttempt: Awaited<
        ReturnType<typeof deliverActiveProviderResourceAssociationDelivery>
      > | null = null;
      try {
        deliveryAttempt = await step.run(
          {
            name: `deliver-provider-resource-association-delivery:${activeDelivery.id}`,
            retryPolicy: IdempotentProviderDeliveryStepRetryPolicy,
          },
          async () =>
            deliverActiveProviderResourceAssociationDelivery(
              {
                controlPlaneInternalClient,
                dataPlaneClient,
                db,
              },
              {
                delivery: activeDelivery,
                generation: input.generation,
                workflowRunId,
              },
            ),
        );
      } catch (error) {
        if (shouldRethrowDurableStepErrorForRetry(error)) {
          throw error;
        }

        const failure = resolveProviderResourceAssociationDeliveryFailure(error);
        await step.run(
          {
            name: `finalize-provider-resource-association-delivery-failed:${activeDelivery.id}`,
            retryPolicy: SingleAttemptDeliveryStepRetryPolicy,
          },
          async () =>
            finalizeProviderResourceAssociationDelivery(
              {
                db,
              },
              {
                deliveryId: activeDelivery.id,
                generation: input.generation,
                status: ProviderResourceAssociationDeliveryStatuses.FAILED,
                failureCode: failure.code,
                failureMessage: failure.message,
              },
            ),
        );
      }

      if (deliveryAttempt === null || deliveryAttempt.status === "terminal_failed") {
        iteration += 1;
        continue;
      }

      try {
        await step.run(
          {
            name: `persist-provider-resource-association-delivery:${activeDelivery.id}`,
            retryPolicy: IdempotentProviderDeliveryStepRetryPolicy,
          },
          async () =>
            updateTriggerConversationExecution(
              {
                db,
              },
              {
                routeId: deliveryAttempt.routeId,
                providerExecutionId: deliveryAttempt.providerExecutionId,
                providerState: deliveryAttempt.providerState,
              },
            ),
        );

        await step.run(
          {
            name: `finalize-provider-resource-association-delivery-completed:${activeDelivery.id}`,
            retryPolicy: IdempotentProviderDeliveryStepRetryPolicy,
          },
          async () =>
            finalizeProviderResourceAssociationDelivery(
              {
                db,
              },
              {
                deliveryId: activeDelivery.id,
                generation: input.generation,
                status: ProviderResourceAssociationDeliveryStatuses.COMPLETED,
                failureCode: null,
                failureMessage: null,
              },
            ),
        );
      } catch (error) {
        if (shouldRethrowDurableStepErrorForRetry(error)) {
          throw error;
        }

        const failure = resolveProviderResourceAssociationDeliveryFailure(error);
        await releaseProviderResourceAssociationDeliveryForRetry(
          {
            db,
          },
          {
            deliveryId: activeDelivery.id,
            generation: input.generation,
            failureCode: failure.code,
            failureMessage: failure.message,
          },
        );
        iteration += 1;
        continue;
      }

      iteration += 1;
    }
  },
);

async function deliverActiveProviderResourceAssociationDelivery(
  ctx: Pick<
    Awaited<ReturnType<typeof getWorkflowContext>>,
    "controlPlaneInternalClient" | "dataPlaneClient" | "db"
  >,
  input: {
    delivery: ActiveProviderResourceAssociationDelivery;
    generation: number;
    workflowRunId: string;
  },
): Promise<
  | {
      status: "delivered";
      routeId: string;
      providerExecutionId: string | null;
      providerState?: unknown;
    }
  | {
      status: "terminal_failed";
    }
> {
  const stepSpan = trace.getActiveSpan();

  try {
    if (input.delivery.status === "claimed") {
      await markProviderResourceAssociationDeliveryDelivering(
        {
          db: ctx.db,
        },
        {
          deliveryId: input.delivery.id,
          generation: input.generation,
        },
      );
    }

    const route = await resolveProviderResourceAssociationDeliveryRoute(
      { dataPlaneClient: ctx.dataPlaneClient, db: ctx.db },
      { providerResourceAssociationId: input.delivery.providerResourceAssociationId },
    ).catch(async (error: unknown) => {
      if (!shouldDiscoverOriginalRuntimeRoute(error)) {
        throw error;
      }

      await discoverOriginalRuntimeProviderResourceAssociationDeliveryRoute(
        {
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
          dataPlaneClient: ctx.dataPlaneClient,
          db: ctx.db,
        },
        {
          deliveryId: input.delivery.id,
          providerResourceAssociationId: input.delivery.providerResourceAssociationId,
          sourceWebhookEventId: input.delivery.sourceWebhookEventId,
        },
      );

      return await resolveProviderResourceAssociationDeliveryRoute(
        { dataPlaneClient: ctx.dataPlaneClient, db: ctx.db },
        { providerResourceAssociationId: input.delivery.providerResourceAssociationId },
      );
    });
    const webhookEvent = await ctx.db.query.integrationWebhookEvents.findFirst({
      columns: {
        externalDeliveryId: true,
      },
      where: (table, { eq }) => eq(table.id, input.delivery.sourceWebhookEventId),
    });
    if (webhookEvent === undefined) {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.DELIVERY_NOT_FOUND,
        message: `Provider resource association delivery '${input.delivery.id}' references missing webhook event '${input.delivery.sourceWebhookEventId}'.`,
      });
    }

    const createProviderDeliveryInput =
      async (): Promise<ExecuteConversationProviderDeliveryInput> => {
        const connection = await acquireProviderResourceAssociationDeliveryConnection(
          {
            controlPlaneInternalClient: ctx.controlPlaneInternalClient,
          },
          {
            organizationId: route.organizationId,
            sandboxInstanceId: route.sandboxInstanceId,
            deliveryId: input.delivery.id,
            conversationId: route.conversationId,
            webhookEventId: input.delivery.sourceWebhookEventId,
            ...(webhookEvent.externalDeliveryId === null
              ? {}
              : { externalDeliveryId: webhookEvent.externalDeliveryId }),
          },
        );

        return {
          conversationId: route.conversationId,
          runtimeId: route.runtimeId,
          connectionUrl: connection.url,
          inputText: renderProviderResourceAssociationDeliveryInput(input.delivery.renderedInput),
          workingDirectory: route.workingDirectory,
          deliveryContext: {
            source: "provider_resource_association",
            webhookEventId: input.delivery.sourceWebhookEventId,
            deliveryTaskId: input.delivery.id,
            ...(webhookEvent.externalDeliveryId === null
              ? {}
              : { externalDeliveryId: webhookEvent.externalDeliveryId }),
            providerResourceAssociationId: route.providerResourceAssociationId,
            conversationId: route.conversationId,
            sandboxInstanceId: route.sandboxInstanceId,
            routeId: route.routeId,
          },
          providerConversationId: route.providerConversationId,
          providerExecutionId: route.providerExecutionId,
        };
      };

    const submittedProviderPayload = await submitCodexAssociatedResourceDelivery({
      deliveryInput: await createProviderDeliveryInput(),
      providerConversationId: route.providerConversationId,
    });

    const deliveryResult = {
      providerConversationId: route.providerConversationId,
      providerExecutionId: submittedProviderPayload.providerExecutionId,
    };

    if (deliveryResult.providerConversationId !== route.providerConversationId) {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
        message: `Provider resource association delivery '${input.delivery.id}' changed provider conversation from '${route.providerConversationId}' to '${deliveryResult.providerConversationId}'.`,
      });
    }

    stepSpan?.addEvent("provider_resource_association_delivery.completed", {
      "mistle.provider_resource_association.id": input.delivery.providerResourceAssociationId,
      "mistle.provider_resource_association.delivery_id": input.delivery.id,
      "mistle.workflow.run_id": input.workflowRunId,
    });
    return {
      status: "delivered",
      routeId: route.routeId,
      providerExecutionId: deliveryResult.providerExecutionId,
    };
  } catch (error) {
    if (!(error instanceof ProviderResourceAssociationDeliveryError)) {
      throw error;
    }

    const failure = resolveProviderResourceAssociationDeliveryFailure(error);
    await finalizeProviderResourceAssociationDelivery(
      {
        db: ctx.db,
      },
      {
        deliveryId: input.delivery.id,
        generation: input.generation,
        status: ProviderResourceAssociationDeliveryStatuses.FAILED,
        failureCode: failure.code,
        failureMessage: failure.message,
      },
    );
    stepSpan?.addEvent("provider_resource_association_delivery.failed", {
      "mistle.provider_resource_association.id": input.delivery.providerResourceAssociationId,
      "mistle.provider_resource_association.delivery_id": input.delivery.id,
      "mistle.provider_resource_association.failure_code": failure.code,
      "mistle.workflow.run_id": input.workflowRunId,
    });
    return {
      status: "terminal_failed",
    };
  }
}

function shouldDiscoverOriginalRuntimeRoute(error: unknown): boolean {
  return (
    error instanceof ProviderResourceAssociationDeliveryError &&
    (error.code ===
      ProviderResourceAssociationDeliveryFailureCodes.ROUTING_CONVERSATION_NOT_FOUND ||
      error.code === ProviderResourceAssociationDeliveryFailureCodes.ROUTING_CONVERSATION_UNBOUND)
  );
}

function resolveProviderResourceAssociationDeliveryFailure(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof ProviderResourceAssociationDeliveryError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  return {
    code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
    message:
      error instanceof Error ? error.message : "Provider resource association delivery failed.",
  };
}

function renderProviderResourceAssociationDeliveryInput(
  renderedInput: Record<string, unknown>,
): string {
  const text = renderedInput.text;
  if (typeof text === "string" && text.trim().length > 0) {
    return text;
  }

  throw new ProviderResourceAssociationDeliveryError({
    code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
    message: "Provider resource association delivery rendered input is missing text.",
  });
}
