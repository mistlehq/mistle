import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { duplicateTriggerWebhook } from "../services/duplicate-trigger-webhook.js";
import { route } from "./route.js";

const TriggerWebhookResponseKinds = Object.freeze({
  WEBHOOK: "webhook",
});

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { triggerId } = ctx.req.valid("param");

  const triggerWebhook = await duplicateTriggerWebhook(
    {
      db,
      integrationRegistry,
    },
    {
      triggerId,
      organizationId: session.activeOrganizationId,
    },
  );

  return ctx.json(
    {
      ...triggerWebhook,
      kind: TriggerWebhookResponseKinds.WEBHOOK,
    },
    201,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
