import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { startSandboxInstance } from "../../../sandbox-instances/services/start-sandbox-instance.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const tables = ctx.get("resources").tables;
  const openWorkflow = ctx.get("resources").openWorkflow;
  const body = ctx.req.valid("json");

  const response = await startSandboxInstance(
    {
      db,
      tables,
      openWorkflow,
    },
    body,
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
