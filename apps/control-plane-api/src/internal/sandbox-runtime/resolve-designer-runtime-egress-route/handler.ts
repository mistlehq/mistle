import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { resolveDesignerRuntimeEgressRoute } from "../../../designer/services/designer-runtime-provider-mcp.js";
import type { AppContextBindings } from "../../../types.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const body = ctx.req.valid("json");

  return ctx.json(
    await resolveDesignerRuntimeEgressRoute(
      {
        db: ctx.get("db"),
        integrationRegistry: ctx.get("integrationRegistry"),
        integrationsConfig: ctx.get("config").integrations,
      },
      {
        organizationId: body.organizationId,
        sandboxInstanceId: body.sandboxInstanceId,
        integrationConnectionId: body.integrationConnectionId,
        providerToolIds: body.providerToolIds,
        targetUrl: body.targetUrl,
        method: body.method,
        transport: body.transport,
      },
    ),
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
