import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { stopSandboxInstance } from "../../../sandbox-instances/services/stop-sandbox-instance.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const tables = ctx.get("resources").tables;
  const openWorkflow = ctx.get("resources").openWorkflow;
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response = await stopSandboxInstance(
    {
      db,
      tables,
      openWorkflow,
    },
    body.stopReason === "idle"
      ? {
          sandboxInstanceId: params.id,
          stopReason: body.stopReason,
          expectedOwnerLeaseId: body.expectedOwnerLeaseId,
          idempotencyKey: body.idempotencyKey,
        }
      : {
          sandboxInstanceId: params.id,
          stopReason: body.stopReason,
          organizationId: body.organizationId,
          idempotencyKey: body.idempotencyKey,
        },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
