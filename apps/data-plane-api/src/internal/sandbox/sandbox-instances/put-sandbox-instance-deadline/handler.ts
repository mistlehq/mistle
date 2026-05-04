import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { putSandboxInstanceDeadline } from "../../../sandbox-instances/services/put-sandbox-instance-deadline.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const resources = ctx.get("resources");
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response = await putSandboxInstanceDeadline(
    {
      db: resources.db,
      tables: resources.tables,
      openWorkflow: resources.openWorkflow,
    },
    {
      sandboxInstanceId: params.id,
      kind: params.kind,
      ownerLeaseId: body.ownerLeaseId,
      dueAt: body.dueAt,
    },
  );

  return ctx.json(response, 200);
};
