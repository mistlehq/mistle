import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { startSandboxInstance } from "../../../sandbox-instances/services/start-sandbox-instance.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const openWorkflow = ctx.get("resources").openWorkflow;
  const workflowDbPool = ctx.get("resources").workflowDbPool;
  const workflowNamespaceId = ctx.get("config").workflow.namespaceId;
  const sandboxProvider = ctx.get("sandboxProvider");
  const body = ctx.req.valid("json");

  const response = await startSandboxInstance(
    {
      db,
      openWorkflow,
      workflowDbPool,
      workflowNamespaceId,
      sandboxProvider,
    },
    body,
  );

  return ctx.json(response, 200);
};
