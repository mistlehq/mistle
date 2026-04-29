import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../../types.js";
import { findStartedSandboxInstanceByIdempotencyKey } from "../../../sandbox-instances/services/start-sandbox-instance.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const resources = ctx.get("resources");
  const workflowNamespaceId = ctx.get("config").workflow.namespaceId;
  const query = ctx.req.valid("query");

  const response = await findStartedSandboxInstanceByIdempotencyKey(
    {
      workflowDbPool: resources.workflowDbPool,
      workflowNamespaceId,
    },
    {
      organizationId: query.organizationId,
      sandboxProfileId: query.sandboxProfileId,
      sandboxProfileVersion: query.sandboxProfileVersion,
      purpose: query.purpose,
      source: query.source,
      idempotencyKey: query.idempotencyKey,
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
