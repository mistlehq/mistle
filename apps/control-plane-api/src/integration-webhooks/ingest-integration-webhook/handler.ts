import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { HandleIntegrationWebhookEventWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import type { AppContextBindings } from "../../types.js";
import { createImmediateWebhookResponse } from "../create-immediate-webhook-response.js";
import { receiveIntegrationWebhook } from "../services/receive-webhook.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const openWorkflow = ctx.get("openWorkflow");
  const integrationsConfig = ctx.get("config").integrations;
  const { targetKey } = ctx.req.valid("param");
  const rawBody = new Uint8Array(await ctx.req.arrayBuffer());
  const headers = Object.fromEntries(ctx.req.raw.headers.entries());

  const receivedWebhook = await receiveIntegrationWebhook(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      targetKey,
      headers,
      rawBody,
    },
  );

  if (receivedWebhook.kind === "response") {
    return createImmediateWebhookResponse(receivedWebhook.response);
  }

  if (!receivedWebhook.duplicate) {
    const { webhookEventId } = receivedWebhook;

    if (webhookEventId === undefined) {
      throw new Error("Expected webhook event id for a non-duplicate webhook.");
    }

    await openWorkflow.runWorkflow(
      HandleIntegrationWebhookEventWorkflowSpec,
      { webhookEventId },
      {
        idempotencyKey: webhookEventId,
      },
    );
  }

  return ctx.json(
    {
      status: receivedWebhook.duplicate ? "duplicate" : "received",
    },
    202,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
