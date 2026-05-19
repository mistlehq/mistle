import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { deleteSandboxInstance } from "../../../sandbox-instances/services/delete-sandbox-instance.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const openWorkflow = ctx.get("resources").openWorkflow;
  const tables = ctx.get("resources").tables;
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  const response = await deleteSandboxInstance(
    {
      db,
      openWorkflow,
      tables,
    },
    {
      organizationId: query.organizationId,
      sandboxInstanceId: params.id,
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
