import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import { resolveSandboxRuntimeCredentials } from "../services/resolve-sandbox-runtime-credentials.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const body = ctx.req.valid("json");

  return ctx.json(
    await resolveSandboxRuntimeCredentials(
      {
        db: ctx.get("db"),
        integrationRegistry: ctx.get("integrationRegistry"),
        integrationsConfig: ctx.get("config").integrations,
        sandboxConfig: ctx.get("sandboxConfig"),
      },
      {
        organizationId: body.organizationId,
        provider: body.provider,
        ...(body.connectionId === undefined ? {} : { connectionId: body.connectionId }),
      },
    ),
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
