import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { getSandboxInstanceMetadata } from "../../../sandbox-instances/services/get-sandbox-instance-metadata.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  const response = await getSandboxInstanceMetadata(
    {
      db,
    },
    {
      organizationId: query.organizationId,
      instanceId: params.id,
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
