import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { stopSandboxInstance } from "../../../sandbox-instances/services/stop-sandbox-instance.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const openWorkflow = ctx.get("resources").openWorkflow;
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const stopInput =
    body.stopReason === "idle"
      ? {
          sandboxInstanceId: params.id,
          stopReason: body.stopReason,
          expectedOwnerLeaseId: body.expectedOwnerLeaseId,
          idempotencyKey: body.idempotencyKey,
          ...(body.expectedPurpose === undefined ? {} : { expectedPurpose: body.expectedPurpose }),
        }
      : {
          sandboxInstanceId: params.id,
          stopReason: body.stopReason,
          idempotencyKey: body.idempotencyKey,
          expectedPurpose: body.expectedPurpose,
        };

  const response = await stopSandboxInstance(
    {
      db: ctx.get("resources").db,
      openWorkflow,
    },
    stopInput,
  );

  return ctx.json(response, 200);
};
