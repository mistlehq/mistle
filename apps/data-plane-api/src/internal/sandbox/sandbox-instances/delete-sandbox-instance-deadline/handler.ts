import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { deleteSandboxInstanceDeadline } from "../../../sandbox-instances/services/delete-sandbox-instance-deadline.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const params = ctx.req.valid("param");

  const response = await deleteSandboxInstanceDeadline(
    {
      db,
    },
    {
      sandboxInstanceId: params.id,
      kind: params.kind,
    },
  );

  return ctx.json(response, 200);
};
