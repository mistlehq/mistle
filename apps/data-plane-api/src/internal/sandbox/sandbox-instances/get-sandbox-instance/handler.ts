import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { getSandboxInstanceByInspection } from "../../../sandbox-instances/services/get-sandbox-instance-by-inspection.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const sandboxAdapter = ctx.get("resources").sandboxAdapter;
  const sandboxProvider = ctx.get("sandboxProvider");
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  const response = await getSandboxInstanceByInspection(
    {
      db,
      sandboxAdapter,
      sandboxProvider,
    },
    {
      organizationId: query.organizationId,
      instanceId: params.id,
    },
  );

  return ctx.json(response, 200);
};
