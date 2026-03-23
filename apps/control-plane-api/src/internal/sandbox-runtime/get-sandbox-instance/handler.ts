import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import { getSandboxInstance } from "../services/get-sandbox-instance.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const body = ctx.req.valid("json");

  const sandboxInstance = await getSandboxInstance(
    {
      dataPlaneClient,
    },
    body,
  );

  return ctx.json(sandboxInstance, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
