import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { patchSandboxInstanceTitle } from "../../../sandbox-instances/services/patch-sandbox-instance-title.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response = await patchSandboxInstanceTitle(
    {
      db,
    },
    {
      organizationId: body.organizationId,
      instanceId: params.id,
      title: body.title,
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
