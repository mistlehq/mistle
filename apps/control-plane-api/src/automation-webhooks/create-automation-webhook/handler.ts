import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../types.js";
import {
  handleAutomationWebhookBadRequestError,
  requireSession,
  toAutomationWebhookResponse,
} from "../route-helpers.js";
import { route } from "./route.js";
import { createAutomationWebhook } from "./service.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  try {
    const body = ctx.req.valid("json");
    const session = requireSession(ctx);
    const automationWebhook = await createAutomationWebhook(
      {
        db: ctx.get("db"),
        integrationRegistry: ctx.get("integrationRegistry"),
      },
      {
        name: body.name,
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        integrationConnectionId: body.integrationConnectionId,
        ...(body.eventTypes === undefined ? {} : { eventTypes: body.eventTypes }),
        ...(body.payloadFilter === undefined ? {} : { payloadFilter: body.payloadFilter }),
        inputTemplate: body.inputTemplate,
        conversationKeyTemplate: body.conversationKeyTemplate,
        ...(body.idempotencyKeyTemplate === undefined
          ? {}
          : { idempotencyKeyTemplate: body.idempotencyKeyTemplate }),
        target: {
          sandboxProfileId: body.target.sandboxProfileId,
          ...(body.target.sandboxProfileVersion === undefined
            ? {}
            : { sandboxProfileVersion: body.target.sandboxProfileVersion }),
        },
        organizationId: session.session.activeOrganizationId,
      },
    );

    return ctx.json(toAutomationWebhookResponse(automationWebhook), 201);
  } catch (error) {
    return handleAutomationWebhookBadRequestError(ctx, error);
  }
};
