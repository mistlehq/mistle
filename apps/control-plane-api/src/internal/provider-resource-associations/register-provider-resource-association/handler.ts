import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import { registerProviderResourceAssociation } from "../services/register-provider-resource-association.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const result = await registerProviderResourceAssociation(
    {
      dataPlaneClient: ctx.get("dataPlaneClient"),
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
    },
    ctx.req.valid("json"),
  );

  return ctx.json(result, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
