import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { pruneUnusedSandboxImages } from "../../../sandbox-images/services/prune-unused-sandbox-images.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const openWorkflow = ctx.get("resources").openWorkflow;
  const body = ctx.req.valid("json");

  const response = await pruneUnusedSandboxImages(
    {
      openWorkflow,
    },
    body,
  );

  return ctx.json(response, 202);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
