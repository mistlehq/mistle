import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../types.js";
import {
  handleAutomationWebhookError,
  requireSession,
  toAutomationWebhookResponse,
} from "../route-helpers.js";
import { route } from "./route.js";
import { updateAutomationWebhook } from "./service.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  try {
    const params = ctx.req.valid("param");
    const body = ctx.req.valid("json");
    const session = requireSession(ctx);
    const automationWebhook = await updateAutomationWebhook(
      {
        db: ctx.get("db"),
        integrationRegistry: ctx.get("integrationRegistry"),
      },
      {
        automationId: params.automationId,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(body.integrationConnectionId === undefined
          ? {}
          : { integrationConnectionId: body.integrationConnectionId }),
        ...(body.eventTypes === undefined ? {} : { eventTypes: body.eventTypes }),
        ...(body.payloadFilter === undefined ? {} : { payloadFilter: body.payloadFilter }),
        ...(body.inputTemplate === undefined ? {} : { inputTemplate: body.inputTemplate }),
        ...(body.conversationKeyTemplate === undefined
          ? {}
          : { conversationKeyTemplate: body.conversationKeyTemplate }),
        ...(body.idempotencyKeyTemplate === undefined
          ? {}
          : { idempotencyKeyTemplate: body.idempotencyKeyTemplate }),
        ...(body.target === undefined
          ? {}
          : {
              target: {
                ...(body.target.sandboxProfileId === undefined
                  ? {}
                  : { sandboxProfileId: body.target.sandboxProfileId }),
                ...(body.target.sandboxProfileVersion === undefined
                  ? {}
                  : { sandboxProfileVersion: body.target.sandboxProfileVersion }),
              },
            }),
        organizationId: session.session.activeOrganizationId,
      },
    );

    return ctx.json(toAutomationWebhookResponse(automationWebhook), 200);
  } catch (error) {
    return handleAutomationWebhookError(ctx, error);
  }
};
