import { OpenAPIHono } from "@hono/zod-openapi";
import type { IntegrationWebhookImmediateResponse } from "@mistle/integrations-core";
import { z } from "zod";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH } from "./constants.js";
import {
  IngestIntegrationWebhookResponseSchema,
  ingestIntegrationWebhookRoute,
  IntegrationWebhooksBadRequestResponseSchema,
  IntegrationWebhooksNotFoundResponseSchema,
} from "./contracts.js";
import {
  IntegrationWebhooksBadRequestError,
  IntegrationWebhooksNotFoundError,
} from "./services/errors.js";
import { receiveIntegrationWebhook } from "./services/receive-webhook.js";

export function createImmediateWebhookResponse(response: IntegrationWebhookImmediateResponse) {
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") ?? response.contentType;

  let body: BodyInit | null = null;
  if (response.body !== undefined) {
    if (typeof response.body === "string") {
      body = response.body;
    } else {
      body = JSON.stringify(response.body);
      if (contentType === undefined) {
        headers.set("content-type", "application/json");
      }
    }
  }

  if (response.contentType !== undefined && headers.get("content-type") === null) {
    headers.set("content-type", response.contentType);
  }

  return new Response(body, {
    status: response.status,
    headers,
  });
}

export function createIntegrationWebhooksApp(): AppRoutes<
  typeof INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(ingestIntegrationWebhookRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const rawBody = new Uint8Array(await ctx.req.arrayBuffer());
      const rawHeaders = Object.fromEntries(ctx.req.raw.headers.entries());

      const receivedWebhook = await receiveIntegrationWebhook(
        ctx.get("db"),
        ctx.get("integrationRegistry"),
        ctx.get("config").integrations,
        {
          targetKey: params.targetKey,
          headers: rawHeaders,
          rawBody,
        },
      );

      if (receivedWebhook.kind === "response") {
        return createImmediateWebhookResponse(receivedWebhook.response);
      }

      if (!receivedWebhook.duplicate) {
        const webhookEventId = receivedWebhook.webhookEventId;
        if (webhookEventId === undefined) {
          throw new Error("Expected webhook event id for a non-duplicate webhook.");
        }

        await ctx.get("services").integrationWebhooks.receiveWebhookEvent({
          webhookEventId,
        });
      }

      const responseBody: z.infer<typeof IngestIntegrationWebhookResponseSchema> = {
        status: receivedWebhook.duplicate ? "duplicate" : "received",
      };

      return ctx.json(responseBody, 202);
    } catch (error) {
      return handleIngestIntegrationWebhookError(ctx, error);
    }
  });

  return {
    basePath: INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH,
    routes,
  };
}

function handleIngestIntegrationWebhookError(ctx: AppContext, error: unknown) {
  if (error instanceof IntegrationWebhooksBadRequestError) {
    const responseBody: z.infer<typeof IntegrationWebhooksBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  if (error instanceof IntegrationWebhooksNotFoundError) {
    const responseBody: z.infer<typeof IntegrationWebhooksNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}
