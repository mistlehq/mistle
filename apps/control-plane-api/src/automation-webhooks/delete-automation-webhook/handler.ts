import { z, type RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../types.js";
import { handleAutomationWebhookNotFoundError, requireSession } from "../route-helpers.js";
import { route } from "./route.js";
import { DeleteAutomationWebhookResponseSchema } from "./schema.js";
import { deleteAutomationWebhook } from "./service.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  try {
    const params = ctx.req.valid("param");
    const session = requireSession(ctx);
    await deleteAutomationWebhook(
      { db: ctx.get("db") },
      {
        automationId: params.automationId,
        organizationId: session.session.activeOrganizationId,
      },
    );

    const responseBody: z.infer<typeof DeleteAutomationWebhookResponseSchema> = {
      status: "deleted",
      automationId: params.automationId,
    };

    return ctx.json(responseBody, 200);
  } catch (error) {
    return handleAutomationWebhookNotFoundError(ctx, error);
  }
};
