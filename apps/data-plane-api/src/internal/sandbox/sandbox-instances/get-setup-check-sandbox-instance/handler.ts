import type { RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings } from "../../../../types.js";
import { getSetupCheckSandboxInstanceByInspection } from "../../../sandbox-instances/services/get-sandbox-instance-by-inspection.js";
import { route } from "./route.js";

export const handler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const resources = ctx.get("resources");
  const sandboxProvider = ctx.get("sandboxProvider");
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  const response = await getSetupCheckSandboxInstanceByInspection(
    {
      db: resources.db,
      sandboxAdapter: resources.sandboxAdapter,
      runtimeStateReader: resources.runtimeStateReader,
      sandboxProvider,
    },
    {
      organizationId: query.organizationId,
      instanceId: params.id,
      sandboxProfileId: query.sandboxProfileId,
      sandboxProfileVersion: query.sandboxProfileVersion,
    },
  );

  return ctx.json(response, 200);
};
