import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { cleanupSkillsDiscoverySandboxInstance } from "../../../sandbox-instances/services/cleanup-skills-discovery-sandbox-instance.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const resources = ctx.get("resources");
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response = await cleanupSkillsDiscoverySandboxInstance(
    {
      db: resources.db,
      openWorkflow: resources.openWorkflow,
      tables: resources.tables,
    },
    {
      organizationId: body.organizationId,
      sandboxInstanceId: params.id,
      startWorkflowRunId: body.startWorkflowRunId,
      idempotencyKey: body.idempotencyKey,
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
