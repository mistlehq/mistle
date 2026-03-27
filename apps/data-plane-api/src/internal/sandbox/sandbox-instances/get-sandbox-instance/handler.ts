import type { RouteHandler } from "@hono/zod-openapi";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";

import type { AppContextBindings } from "../../../../types.js";
import { getSandboxInstanceByInspection } from "../../../sandbox-instances/services/get-sandbox-instance-by-inspection.js";
import { route } from "./route.js";
import { ConventionalSandboxInstanceStatuses } from "./schema.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("resources").db;
  const sandboxAdapter = ctx.get("resources").sandboxAdapter;
  const sandboxProvider = ctx.get("sandboxProvider");
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  const response = await getSandboxInstanceByInspection(
    {
      db,
      sandboxAdapter,
      sandboxProvider,
    },
    {
      organizationId: query.organizationId,
      instanceId: params.id,
    },
  );

  if (response === null) {
    return ctx.json(response, 200);
  }

  if (response.status === SandboxInstanceStatuses.STARTING && response.providerSandboxId === null) {
    return ctx.json(
      {
        id: response.id,
        status: ConventionalSandboxInstanceStatuses.PENDING,
        failureCode: response.failureCode,
        failureMessage: response.failureMessage,
      },
      200,
    );
  }

  return ctx.json(
    {
      id: response.id,
      status: response.status,
      failureCode: response.failureCode,
      failureMessage: response.failureMessage,
    },
    200,
  );
};
