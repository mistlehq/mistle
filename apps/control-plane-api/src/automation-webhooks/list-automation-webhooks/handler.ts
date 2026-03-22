import { z, type RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../types.js";
import {
  handleAutomationWebhookBadRequestError,
  requireSession,
  toAutomationWebhookResponse,
} from "../route-helpers.js";
import { route } from "./route.js";
import { ListAutomationWebhooksResponseSchema } from "./schema.js";
import { listAutomationWebhooks } from "./service.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  try {
    const query = ctx.req.valid("query");
    const session = requireSession(ctx);
    const result = await listAutomationWebhooks(
      { db: ctx.get("db") },
      {
        ...query,
        organizationId: session.session.activeOrganizationId,
      },
    );
    const responseBody: z.infer<typeof ListAutomationWebhooksResponseSchema> = {
      ...result,
      items: result.items.map(toAutomationWebhookResponse),
    };

    return ctx.json(responseBody, 200);
  } catch (error) {
    return handleAutomationWebhookBadRequestError(ctx, error);
  }
};
