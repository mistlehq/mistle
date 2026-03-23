import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../types.js";
import { getSandboxInstance } from "../services/get-sandbox-instance.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const runtimeStateReader = ctx.get("resources").runtimeStateReader;
  const body = ctx.req.valid("json");

  const response = await getSandboxInstance(
    {
      db,
      runtimeStateReader,
    },
    body,
  );

  return ctx.json(response, 200);
};
