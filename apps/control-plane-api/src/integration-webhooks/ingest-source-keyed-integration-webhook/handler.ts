import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { HandleIntegrationWebhookEventWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import type { AppContextBindings } from "../../types.js";
import { createImmediateWebhookResponse } from "../create-immediate-webhook-response.js";
import { receiveIntegrationWebhook } from "../services/receive-webhook.js";
import { logIntegrationWebhookEvent, withIntegrationWebhookSpan } from "../telemetry.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const openWorkflow = ctx.get("openWorkflow");
  const integrationsConfig = ctx.get("config").integrations;
  const { endpointKey, targetKey } = ctx.req.valid("param");
  const rawBody = new Uint8Array(await ctx.req.arrayBuffer());
  const headers = Object.fromEntries(ctx.req.raw.headers.entries());

  return await withIntegrationWebhookSpan(
    {
      name: "integration_webhook.receive",
      telemetryContext: {
        endpointKey,
        targetKey,
      },
    },
    async (span) => {
      logIntegrationWebhookEvent({
        eventName: "webhook.received",
        message: "Received inbound integration webhook request",
        telemetryContext: {
          endpointKey,
          targetKey,
        },
      });

      const receivedWebhook = await receiveIntegrationWebhook(
        {
          db,
          integrationRegistry,
          integrationsConfig,
        },
        {
          targetKey,
          endpointKey,
          headers,
          rawBody,
        },
      );

      if (receivedWebhook.kind === "response") {
        logIntegrationWebhookEvent({
          eventName: "webhook.immediate_response",
          message: "Returning immediate integration webhook response",
          telemetryContext: {
            endpointKey,
            targetKey,
          },
        });

        return createImmediateWebhookResponse(receivedWebhook.response);
      }

      const telemetryContext = {
        webhookEventId: receivedWebhook.webhookEventId,
        externalDeliveryId: receivedWebhook.externalDeliveryId ?? undefined,
        integrationConnectionId: receivedWebhook.integrationConnectionId,
        targetKey: receivedWebhook.targetKey,
      };

      span.setAttributes({
        "mistle.integration.connection_id": receivedWebhook.integrationConnectionId,
        ...(receivedWebhook.webhookEventId === undefined
          ? {}
          : { "mistle.webhook.event_id": receivedWebhook.webhookEventId }),
        ...(receivedWebhook.externalDeliveryId === null
          ? {}
          : { "mistle.webhook.external_delivery_id": receivedWebhook.externalDeliveryId }),
      });

      logIntegrationWebhookEvent({
        eventName: receivedWebhook.duplicate ? "webhook.duplicate" : "webhook.accepted",
        message: receivedWebhook.duplicate
          ? "Skipped duplicate inbound integration webhook event"
          : "Accepted inbound integration webhook event",
        telemetryContext,
      });

      if (!receivedWebhook.duplicate) {
        const { webhookEventId } = receivedWebhook;

        if (webhookEventId === undefined) {
          throw new Error("Expected webhook event id for a non-duplicate webhook.");
        }

        await withIntegrationWebhookSpan(
          {
            name: "integration_webhook.schedule_workflow",
            telemetryContext,
          },
          async () => {
            await openWorkflow.runWorkflow(
              HandleIntegrationWebhookEventWorkflowSpec,
              { webhookEventId },
              {
                idempotencyKey: webhookEventId,
              },
            );
          },
        );

        span.addEvent("integration_webhook.workflow_scheduled", {
          "mistle.webhook.event_id": webhookEventId,
        });

        logIntegrationWebhookEvent({
          eventName: "webhook.workflow_scheduled",
          message: "Scheduled integration webhook workflow",
          telemetryContext,
        });
      }

      return ctx.json(
        {
          status: receivedWebhook.duplicate ? "duplicate" : "received",
        },
        202,
      );
    },
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
