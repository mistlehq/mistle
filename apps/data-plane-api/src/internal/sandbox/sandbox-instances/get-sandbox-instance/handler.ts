import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { getSandboxInstance } from "../../../sandbox-instances/services/get-sandbox-instance.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const config = ctx.get("config");
  const db = ctx.get("resources").db;
  const tables = ctx.get("resources").tables;
  const controlPlaneInternalClient = ctx.get("resources").controlPlaneInternalClient;
  const runtimeStateReader = ctx.get("resources").runtimeStateReader;
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  const response = await getSandboxInstance(
    {
      config: { app: config },
      controlPlaneInternalClient,
      db,
      tables,
      runtimeStateReader,
    },
    {
      organizationId: query.organizationId,
      instanceId: params.id,
    },
  );

  return ctx.json(response, 200);
};
