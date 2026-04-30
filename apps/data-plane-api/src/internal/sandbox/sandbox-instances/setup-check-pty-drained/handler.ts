import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { handleSetupCheckPtyDrained } from "../../../sandbox-instances/services/setup-check-pty-drained.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const resources = ctx.get("resources");
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response = await handleSetupCheckPtyDrained(
    {
      db: resources.db,
      openWorkflow: resources.openWorkflow,
    },
    {
      sandboxInstanceId: params.id,
      ownerLeaseId: body.ownerLeaseId,
    },
  );

  return ctx.json(response, 200);
};
