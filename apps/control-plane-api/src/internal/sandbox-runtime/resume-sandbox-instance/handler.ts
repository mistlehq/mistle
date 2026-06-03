import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import { resumeSandboxInstanceForConnection } from "../services/resume-sandbox-instance-for-connection.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("db");
  const cache = ctx.get("cache");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const { integrations: integrationsConfig } = ctx.get("config");
  const body = ctx.req.valid("json");

  const response = await resumeSandboxInstanceForConnection(
    {
      db,
      cache,
      integrationsConfig,
      dataPlaneClient,
    },
    {
      organizationId: body.organizationId,
      instanceId: body.instanceId,
      ...(body.actingUserId === undefined ? {} : { actingUserId: body.actingUserId }),
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
