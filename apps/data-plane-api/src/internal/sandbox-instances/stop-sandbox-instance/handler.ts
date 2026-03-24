import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../types.js";
import { stopSandboxInstance } from "../services/stop-sandbox-instance.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const openWorkflow = ctx.get("resources").openWorkflow;
  const body = ctx.req.valid("json");

  const response = await stopSandboxInstance(
    {
      openWorkflow,
    },
    body,
  );

  return ctx.json(response, 200);
};
