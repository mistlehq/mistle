import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { getSandboxInstance } from "../../../sandbox-instances/services/get-sandbox-instance.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const tables = ctx.get("resources").tables;
  const sandboxAdapter = ctx.get("resources").sandboxAdapter;
  const runtimeStateReader = ctx.get("resources").runtimeStateReader;
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  const response = await getSandboxInstance(
    {
      db,
      tables,
      sandboxAdapter,
      runtimeStateReader,
    },
    {
      organizationId: query.organizationId,
      instanceId: params.id,
    },
  );

  return ctx.json(response, 200);
};
