import { z } from "@hono/zod-openapi";

import type { AppContext } from "../types.js";
import { AutomationWebhooksBadRequestError, AutomationWebhooksNotFoundError } from "./errors.js";
import {
  AutomationWebhookSchema,
  AutomationWebhooksBadRequestResponseSchema,
  AutomationWebhooksNotFoundResponseSchema,
} from "./shared-schemas.js";
import type { AutomationWebhookAggregate } from "./types.js";

export function requireSession(ctx: AppContext) {
  const session = ctx.get("session");

  if (session === null) {
    throw new Error("Expected authenticated session to be available.");
  }

  return session;
}

export function toAutomationWebhookResponse(
  automationWebhook: AutomationWebhookAggregate,
): z.infer<typeof AutomationWebhookSchema> {
  return {
    ...automationWebhook,
    ...(automationWebhook.eventTypes === null
      ? { eventTypes: null }
      : { eventTypes: [...automationWebhook.eventTypes] }),
    kind: "webhook",
  };
}

export function handleAutomationWebhookBadRequestError(ctx: AppContext, error: unknown) {
  if (error instanceof AutomationWebhooksBadRequestError) {
    const responseBody: z.infer<typeof AutomationWebhooksBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  throw error;
}

export function handleAutomationWebhookNotFoundError(ctx: AppContext, error: unknown) {
  if (error instanceof AutomationWebhooksNotFoundError) {
    const responseBody: z.infer<typeof AutomationWebhooksNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}

export function handleAutomationWebhookError(ctx: AppContext, error: unknown) {
  if (error instanceof AutomationWebhooksBadRequestError) {
    const responseBody: z.infer<typeof AutomationWebhooksBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  if (error instanceof AutomationWebhooksNotFoundError) {
    const responseBody: z.infer<typeof AutomationWebhooksNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}
