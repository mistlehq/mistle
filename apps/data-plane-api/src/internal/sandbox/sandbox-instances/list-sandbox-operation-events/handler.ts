import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { listSandboxOperationEvents } from "../../../sandbox-instances/services/list-sandbox-operation-events.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const tables = ctx.get("resources").tables;
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  const response = await listSandboxOperationEvents(
    {
      db,
      tables,
    },
    {
      sandboxInstanceId: params.id,
      organizationId: query.organizationId,
      operationId: query.operationId,
      ...(query.afterSequence === undefined ? {} : { afterSequence: query.afterSequence }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
