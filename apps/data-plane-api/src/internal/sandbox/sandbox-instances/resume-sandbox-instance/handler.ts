import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { resumeSandboxInstance } from "../../../sandbox-instances/services/resume-sandbox-instance.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const openWorkflow = ctx.get("resources").openWorkflow;
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response = await resumeSandboxInstance(
    {
      openWorkflow,
    },
    {
      organizationId: body.organizationId,
      instanceId: params.id,
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    },
  );

  return ctx.json(response, 200);
};
