import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import { route } from "./route.js";
import type { InvalidateCredentialCacheResponse } from "./schema.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const params = ctx.req.valid("param");
  const result = await ctx
    .get("resources")
    .credentialCacheInvalidator.invalidateIntegrationConnection({
      connectionId: params.connectionId,
    });

  const responseBody: InvalidateCredentialCacheResponse = {
    status: "ok",
    deletedEntryCount: result.deletedEntryCount,
  };

  return ctx.json(responseBody, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
