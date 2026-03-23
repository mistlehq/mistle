import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import { listSandboxInstances } from "../services/list-sandbox-instances.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const runtimeStateReader = ctx.get("resources").runtimeStateReader;
  const body = ctx.req.valid("json");

  const response = await listSandboxInstances(
    {
      db,
      runtimeStateReader,
    },
    body,
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
