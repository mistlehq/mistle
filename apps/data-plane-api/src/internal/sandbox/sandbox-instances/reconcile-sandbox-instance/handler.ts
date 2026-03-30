import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { reconcileSandboxInstance } from "../../../sandbox-instances/services/reconcile-sandbox-instance.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const openWorkflow = ctx.get("resources").openWorkflow;
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response = await reconcileSandboxInstance(
    {
      openWorkflow,
    },
    {
      sandboxInstanceId: params.id,
      reason: body.reason,
      expectedOwnerLeaseId: body.expectedOwnerLeaseId,
      idempotencyKey: body.idempotencyKey,
    },
  );

  return ctx.json(response, 200);
};
