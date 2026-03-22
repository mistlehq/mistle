import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../types.js";
import {
  handleAutomationWebhookNotFoundError,
  requireSession,
  toAutomationWebhookResponse,
} from "../route-helpers.js";
import { route } from "./route.js";
import { getAutomationWebhook } from "./service.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  try {
    const params = ctx.req.valid("param");
    const session = requireSession(ctx);
    const automationWebhook = await getAutomationWebhook(
      { db: ctx.get("db") },
      {
        automationId: params.automationId,
        organizationId: session.session.activeOrganizationId,
      },
    );

    return ctx.json(toAutomationWebhookResponse(automationWebhook), 200);
  } catch (error) {
    return handleAutomationWebhookNotFoundError(ctx, error);
  }
};
