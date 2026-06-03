import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import { startProfileInstance } from "../services/start-profile-instance.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("db");
  const cache = ctx.get("cache");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const { integrations: integrationsConfig, mcp: mcpConfig } = ctx.get("config");
  const sandboxConfig = ctx.get("sandboxConfig");
  const body = ctx.req.valid("json");

  const startedSandboxInstance = await startProfileInstance(
    {
      db,
      cache,
      integrationsConfig,
      mcpConfig,
      dataPlaneClient,
      defaultBaseImage: sandboxConfig.defaultBaseImage,
    },
    {
      organizationId: body.organizationId,
      profileId: body.profileId,
      profileVersion: body.profileVersion,
      ...(body.primaryRepositoryId === undefined
        ? {}
        : { primaryRepositoryId: body.primaryRepositoryId }),
      startedBy: body.startedBy,
      ...(body.actingUser === undefined ? {} : { actingUser: body.actingUser }),
      source: body.source,
    },
  );

  return ctx.json(startedSandboxInstance, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
