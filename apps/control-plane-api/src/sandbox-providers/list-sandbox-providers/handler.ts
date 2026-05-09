import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../types.js";
import { listSandboxProviders } from "../services/list-sandbox-providers.js";
import { route } from "./route.js";

const routeHandler = async (ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0]) => {
  const result = listSandboxProviders({
    integrationRegistry: ctx.get("integrationRegistry"),
    sandboxConfig: ctx.get("sandboxConfig"),
  });

  return ctx.json(result, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
