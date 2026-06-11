import { ProviderResourceAssociationDeliveryStatuses } from "@mistle/db/control-plane";
import { HandleProviderResourceAssociationDeliveryWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { shouldRethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";
import { trace } from "@opentelemetry/api";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { acquireProviderResourceAssociationDeliveryConnection } from "./acquire-connection.js";
import {
  type ActiveProviderResourceAssociationDelivery,
  claimOrResumeProviderResourceAssociationDelivery,
  finalizeProviderResourceAssociationDelivery,
  markProviderResourceAssociationDeliveryDelivering,
} from "./deliveries.js";
import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";
import {
  idleProviderResourceAssociationDeliveryProcessorIfEmpty,
  isProviderResourceAssociationDeliveryProcessorRunning,
} from "./processor.js";
import { resolveProviderResourceAssociationDeliveryTarget } from "./resolve-route.js";
import { submitAssociatedResourceDelivery } from "./submit-associated-resource-delivery.js";

const SingleAttemptDeliveryStepRetryPolicy = {
  maximumAttempts: 1,
} as const;

const IdempotentProviderDeliveryStepRetryPolicy = {
  maximumAttempts: 3,
} as const;

export const HandleProviderResourceAssociationDeliveryWorkflow = defineTracedControlPlaneWorkflow(
  HandleProviderResourceAssociationDeliveryWorkflowSpec,
  async ({ input, run, step }) => {
    const {
      agentRuntimeRegistry,
      controlPlaneInternalClient,
      dataPlaneClient,
      db,
      integrationRegistry,
    } = await getWorkflowContext();
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
                agentRuntimeRegistry,
                controlPlaneInternalClient,
                dataPlaneClient,
                db,
                integrationRegistry,
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

      iteration += 1;
    }
  },
);

async function deliverActiveProviderResourceAssociationDelivery(
  ctx: Pick<
    Awaited<ReturnType<typeof getWorkflowContext>>,
    | "agentRuntimeRegistry"
    | "controlPlaneInternalClient"
    | "dataPlaneClient"
    | "db"
    | "integrationRegistry"
  >,
  input: {
    delivery: ActiveProviderResourceAssociationDelivery;
    generation: number;
    workflowRunId: string;
  },
): Promise<
  | {
      status: "delivered";
      providerConversationId: string;
      providerExecutionId: string;
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

    const target = await resolveProviderResourceAssociationDeliveryTarget(
      {
        agentRuntimeRegistry: ctx.agentRuntimeRegistry,
        dataPlaneClient: ctx.dataPlaneClient,
        db: ctx.db,
        integrationRegistry: ctx.integrationRegistry,
      },
      {
        providerResourceAssociationId: input.delivery.providerResourceAssociationId,
        sourceWebhookEventId: input.delivery.sourceWebhookEventId,
      },
    );
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

    const connection = await acquireProviderResourceAssociationDeliveryConnection(
      {
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
      },
      {
        organizationId: target.organizationId,
        sandboxInstanceId: target.sandboxInstanceId,
        deliveryId: input.delivery.id,
        webhookEventId: input.delivery.sourceWebhookEventId,
        ...(webhookEvent.externalDeliveryId === null
          ? {}
          : { externalDeliveryId: webhookEvent.externalDeliveryId }),
      },
    );

    // Association delivery resolves the original runtime conversation for the
    // sandbox session, not the earliest conversation in a working directory.
    const submittedProviderPayload = await submitAssociatedResourceDelivery({
      deliveryInput: {
        runtimeId: target.runtimeId,
        connectionUrl: connection.url,
        inputText: input.delivery.renderedInput,
        deliveryId: input.delivery.id,
        providerResourceAssociationId: target.providerResourceAssociationId,
        sandboxInstanceId: target.sandboxInstanceId,
        sourceWebhookEventId: input.delivery.sourceWebhookEventId,
        ...(webhookEvent.externalDeliveryId === null
          ? {}
          : { externalDeliveryId: webhookEvent.externalDeliveryId }),
      },
    });

    stepSpan?.addEvent("provider_resource_association_delivery.completed", {
      "mistle.provider_resource_association.id": input.delivery.providerResourceAssociationId,
      "mistle.provider_resource_association.delivery_id": input.delivery.id,
      "mistle.provider_conversation.id": submittedProviderPayload.providerConversationId,
      "mistle.provider_execution.id": submittedProviderPayload.providerExecutionId,
      "mistle.workflow.run_id": input.workflowRunId,
    });
    return {
      status: "delivered",
      providerConversationId: submittedProviderPayload.providerConversationId,
      providerExecutionId: submittedProviderPayload.providerExecutionId,
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
