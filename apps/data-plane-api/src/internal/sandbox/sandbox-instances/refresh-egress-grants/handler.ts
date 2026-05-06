import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { refreshSandboxEgressGrants } from "../../../sandbox-instances/services/refresh-sandbox-egress-grants.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const config = ctx.get("config");
  const resources = ctx.get("resources");
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response = await refreshSandboxEgressGrants(
    {
      config,
      db: resources.db,
      tables: resources.tables,
      runtimeStateReader: resources.runtimeStateReader,
      sandboxRuntimeControl: resources.sandboxRuntimeControl,
    },
    {
      organizationId: body.organizationId,
      instanceId: params.id,
      ...(body.actingUserId === undefined ? {} : { actingUserId: body.actingUserId }),
    },
  );

  return ctx.json(response, 200);
};
